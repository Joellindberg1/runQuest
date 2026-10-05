// 📅 Event Service
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';
import { getLevelFromXP } from './levelService.js';
import { toStockholmDate } from '../utils/dateUtils.js';
import { recordActivities, recordActivity, recordLevelUps } from './activityLog.js';
import { buildEventClosedDraft, buildEventOpenDraft, type ActivityDraft, type EventActivityRow } from '@runquest/shared';

// ─── Pack News-hjälpare (ADR 008) ─────────────────────────────────────────────
// Loggen skrivs EFTER den underliggande skrivningen och är icke-kastande (activityLog).

type EventTemplateJoin = { name: string; icon: string | null; reward_xp: number | null; reward_xp_1st?: number | null } | null;

/** supabase-js kan typa en inbäddad relation som objekt eller (vid gissad kardinalitet) lista. */
function asTemplate(raw: unknown): EventTemplateJoin {
  const t = Array.isArray(raw) ? raw[0] : raw;
  return (t as EventTemplateJoin) ?? null;
}

/** Antal användare i gruppen — "4 of 6 finished it". Null om det inte gick att läsa. */
async function countGroupMembers(groupId: string): Promise<number | null> {
  const { count, error } = await getSupabaseClient()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  return error ? null : (count ?? 0);
}

function toActivityEvent(
  e: { id: string; group_id: string; type: string; starts_at: string; ends_at: string },
  template: EventTemplateJoin,
): EventActivityRow | null {
  if (!template || (e.type !== 'participation' && e.type !== 'competition')) return null;
  return {
    id: e.id, group_id: e.group_id, type: e.type, starts_at: e.starts_at, ends_at: e.ends_at,
    template: { name: template.name, icon: template.icon, reward_xp: template.reward_xp, reward_xp_1st: template.reward_xp_1st ?? null },
  };
}

// ─── maybeCreateEvent ─────────────────────────────────────────────────────────

/**
 * Skapar ett event för en grupp om det inte redan finns ett aktivt/schemalagt
 * event från samma template inom det angivna tidsfönstret.
 * Returnerar true om ett nytt event skapades.
 */
export async function maybeCreateEvent(
  templateName: string,
  groupId: string,
  startsAt: Date,
  endsAt: Date
): Promise<boolean> {
  const supabase = getSupabaseClient();

  // Hämta template
  const { data: template, error: tErr } = await supabase
    .from('event_templates')
    .select('id, type, metric, icon, reward_xp, reward_xp_1st')
    .eq('name', templateName)
    .eq('active', true)
    .single();

  if (tErr || !template) {
    logger.warn(`⚠️ [EventService] Template "${templateName}" not found or inactive`);
    return false;
  }

  // Participation-events: kolla att inget annat participation-event (oavsett template)
  // redan täcker samma dag. Förhindrar att Morgonrunda + Hangover Run + 5K Friday
  // hamnar på samma dag.
  // Competition-events: kolla bara duplikat på samma template.
  let dupQuery = supabase
    .from('events')
    .select('id, event_templates(name)')
    .eq('group_id', groupId)
    .in('status', ['scheduled', 'active'])
    .gte('ends_at', startsAt.toISOString())
    .lte('starts_at', endsAt.toISOString())
    .limit(1);

  if ((template as any).type === 'participation') {
    dupQuery = dupQuery.eq('type', 'participation');
  } else {
    dupQuery = dupQuery.eq('template_id', template.id);
  }

  const { data: existing } = await dupQuery;

  if (existing && existing.length > 0) {
    const existingName = (existing[0] as any).event_templates?.name ?? 'unknown';
    logger.info(`ℹ️ [EventService] Participation event "${existingName}" already covers this window for group ${groupId}, skipping "${templateName}"`);
    return false;
  }

  // Skapa nytt event
  const status = startsAt <= new Date() ? 'active' : 'scheduled';
  const { data: created, error: insertErr } = await supabase
    .from('events')
    .insert({
      template_id: template.id,
      group_id: groupId,
      type: template.type,
      metric: template.metric ?? null,
      status,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select('id')
    .single();

  if (insertErr) {
    logger.error(`❌ [EventService] Failed to create "${templateName}" for group ${groupId}:`, insertErr);
    return false;
  }

  // Pack News: bara ett event som skapas direkt som 'active' loggas här; 'scheduled' loggas av
  // activateScheduledEvents när det faktiskt aktiveras (occurred_at = starts_at).
  if (status === 'active' && created?.id) {
    const row = toActivityEvent(
      { id: created.id, group_id: groupId, type: template.type, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() },
      { name: templateName, icon: (template as any).icon ?? null, reward_xp: (template as any).reward_xp ?? null, reward_xp_1st: (template as any).reward_xp_1st ?? null },
    );
    if (row) await recordActivity(buildEventOpenDraft(row));
  }

  logger.info(`✅ [EventService] Created "${templateName}" for group ${groupId} (${startsAt.toISOString()} → ${endsAt.toISOString()})`);
  return true;
}

// ─── hasActiveParticipationEventOnDate ───────────────────────────────────────

/**
 * Returnerar en map { eventId → templateName } för alla aktiva participation-events
 * för gruppen som är öppna på någon av de givna datumen (ISO "YYYY-MM-DD").
 * Används av run logging för att avgöra om ett pass kvalificerar sig.
 */
export async function getActiveParticipationEventsOnDates(
  groupId: string,
  dates: string[]   // ["YYYY-MM-DD", ...]
): Promise<Array<{ eventId: string; templateName: string; minKm: number; endsAt: string }>> {
  if (!dates.length) return [];

  const supabase = getSupabaseClient();

  // Vi kontrollerar om events.starts_at <= sista datumet och events.ends_at >= första datumet
  const earliest = dates[0] + 'T00:00:00Z';
  const latest   = dates[dates.length - 1] + 'T23:59:59Z';

  const { data, error } = await supabase
    .from('events')
    .select(`
      id,
      starts_at,
      ends_at,
      event_templates ( name, min_km )
    `)
    .eq('group_id', groupId)
    .eq('type', 'participation')
    .in('status', ['active', 'scheduled'])
    .lte('starts_at', latest)
    .gte('ends_at', earliest);

  if (error) {
    logger.error('❌ [EventService] getActiveParticipationEventsOnDates error:', error);
    return [];
  }

  return (data ?? []).map((e: any) => ({
    eventId: e.id,
    templateName: e.event_templates.name,
    minKm: Number(e.event_templates.min_km ?? 0),
    endsAt: e.ends_at,
  }));
}

// ─── checkEventQualification ─────────────────────────────────────────────────

/**
 * Kallas efter att ett pass sparats (manuellt eller via Strava).
 * Kontrollerar aktiva events för gruppen och skapar event_entries vid kvalificering.
 *
 * Participation: distans >= min_km, passet faller inom events tidsfönster → ny entry med run_id.
 * Competition:   passet faller inom tävlingsperioden → upsert entry (total_value fylls vid settlement).
 */
export async function checkEventQualification(params: {
  userId: string;
  runId: string;
  runDate: string;    // "YYYY-MM-DD"
  distanceKm: number;
  isTreadmill?: boolean;
  groupId?: string;   // om ej känt hämtas det från users-tabellen
  /**
   * Kräv att rundans datum (Stockholm-dag) ligger inom eventets dagar [starts_at, ends_at]. Default false:
   * POST/Strava beter sig oförändrat (frågan kräver bara ends_at >= rundans datum). PUT /runs sätter den,
   * så att en redigering av en GAMMAL runda inte kvalificerar ett event som pågår just nu.
   */
  enforceRunDateWindow?: boolean;
}): Promise<void> {
  const supabase = getSupabaseClient();

  // Hämta groupId om det inte skickades med
  let groupId = params.groupId;
  if (!groupId) {
    const { data: userData } = await supabase
      .from('users')
      .select('group_id')
      .eq('id', params.userId)
      .single();
    groupId = userData?.group_id;
  }
  if (!groupId) return;

  const now = new Date().toISOString();

  // Hämta alla aktiva/schemalagda events för gruppen som passet faller inom.
  // 'scheduled' inkluderas eftersom events inte övergår till 'active' automatiskt —
  // vi behandlar ett startat scheduled-event som aktivt.
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      type,
      metric,
      starts_at,
      ends_at,
      event_templates ( min_km, reward_xp )
    `)
    .eq('group_id', groupId)
    .in('status', ['active', 'scheduled'])
    .lte('starts_at', now)
    .gte('ends_at', `${params.runDate}T00:00:00Z`);

  if (error || !events?.length) return;

  for (const event of events) {
    try {
      if (params.enforceRunDateWindow) {
        const startDay = toStockholmDate(event.starts_at);
        const endDay = toStockholmDate(event.ends_at);
        if (params.runDate < startDay || params.runDate > endDay) continue;
      }

      if (event.type === 'participation') {
        const minKm = Number(event.event_templates?.min_km ?? 0);
        if (params.distanceKm < minKm) {
          logger.info(`ℹ️ [EventQual] ${params.userId} did not meet min_km (${params.distanceKm.toFixed(1)} < ${minKm}) for event ${event.id}`);
          continue;
        }
        const rewardXp = Number(event.event_templates?.reward_xp ?? 0);
        // Skapa entry — UNIQUE(event_id, user_id) förhindrar dubbletter
        const { error: insertErr } = await supabase
          .from('event_entries')
          .insert({
            event_id: event.id,
            user_id: params.userId,
            run_id: params.runId,
            qualified_at: now,
            xp_awarded: rewardXp,
          });
        if (insertErr && insertErr.code !== '23505') { // 23505 = unique_violation
          logger.error(`❌ [EventQual] Failed to insert participation entry:`, insertErr);
        } else if (!insertErr) {
          // Lägg till XP (ökar både event_xp och total_xp via RPC)
          await supabase.rpc('increment_event_xp', { p_user_id: params.userId, p_xp: rewardXp });

          // Räkna om level baserat på ny total_xp
          // current_level/group_id i samma select = föregående nivå för level_up-loggen (ADR 008).
          const { data: userData } = await supabase
            .from('users').select('total_xp, current_level, group_id').eq('id', params.userId).single();
          if (userData) {
            const prevLevel = userData.current_level;
            const newLevel = await getLevelFromXP(userData.total_xp);
            await supabase.from('users').update({ current_level: newLevel }).eq('id', params.userId);
            await recordLevelUps(params.userId, prevLevel, newLevel, userData.group_id ?? null);
          }

          logger.info(`✅ [EventQual] User ${params.userId} qualified for participation event ${event.id} (+${rewardXp} XP)`);
        }

      } else if (event.type === 'competition') {
        // Löpbandsrundor kvalificerar inte för höjdmeter-tävlingar
        if (params.isTreadmill && event.metric === 'elevation') {
          logger.info(`ℹ️ [EventQual] Treadmill run skipped for elevation competition ${event.id}`);
          continue;
        }

        // Upsert — samma unika constraint, om entry redan finns gör ingenting
        const { error: upsertErr } = await supabase
          .from('event_entries')
          .upsert(
            {
              event_id: event.id,
              user_id: params.userId,
              qualified_at: now,
            },
            { onConflict: 'event_id,user_id', ignoreDuplicates: true }
          );
        if (upsertErr) {
          logger.error(`❌ [EventQual] Failed to upsert competition entry:`, upsertErr);
        } else {
          logger.info(`✅ [EventQual] User ${params.userId} registered for competition event ${event.id}`);
        }
      }
    } catch (e) {
      logger.error(`❌ [EventQual] Unexpected error for event ${event.id}:`, e);
    }
  }
}

// ─── settleCompetitionEvents ──────────────────────────────────────────────────

/**
 * Körs söndag 23:55. Hittar alla aktiva competition-events vars ends_at har passerat,
 * rankar deltagarna efter total_value (km eller höjdmeter), delar ut XP från poolen
 * och markerar eventet som settled.
 *
 * Pool: reward_xp från template. Distribution: 50% / 30% / 20% för plats 1–3.
 * Restpott om < 3 deltagare fördelas till vinnaren.
 */
export async function settleCompetitionEvents(): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      group_id,
      metric,
      starts_at,
      ends_at,
      event_templates ( name, icon, reward_xp, reward_xp_1st, reward_xp_2nd, reward_xp_3rd )
    `)
    .eq('type', 'competition')
    .eq('status', 'active')
    .lte('ends_at', now);

  if (error) {
    logger.error('❌ [Settlement] Fetch competition events error:', error);
    return;
  }
  if (!events?.length) {
    logger.info('ℹ️ [Settlement] No competition events to settle');
    return;
  }

  for (const event of events) {
    try {
      // Idempotens (bugg #6): claima eventet FÖRE utbetalning — vid
      // överlappande instanser (t.ex. deploy-överlapp) vinner exakt en.
      // Krasch efter claim ger ett settlat event utan utbetalning, vilket
      // syns i loggen — hellre det än dubbel XP till användarna.
      const { data: claimed } = await supabase
        .from('events')
        .update({ status: 'settled', settled_at: now })
        .eq('id', event.id)
        .eq('status', 'active')
        .select('id');

      if (!claimed?.length) {
        logger.info(`↷ [Settlement] Event ${event.id} already claimed by another instance`);
        continue;
      }

      const tmpl = event.event_templates as any;
      const xpPerRank = [
        Number(tmpl?.reward_xp_1st ?? 0),
        Number(tmpl?.reward_xp_2nd ?? 0),
        Number(tmpl?.reward_xp_3rd ?? 0),
      ];

      // Hämta entries
      const { data: entries, error: entryErr } = await supabase
        .from('event_entries')
        .select('id, user_id')
        .eq('event_id', event.id);

      if (entryErr) {
        logger.error(`❌ [Settlement] Fetch entries for event ${event.id}:`, entryErr);
        continue;
      }

      const participants = entries ?? [];
      const activityEvent = toActivityEvent({ ...event, type: 'competition' }, asTemplate(event.event_templates));
      if (!participants.length) {
        // redan markerat settled i claimen ovan. Ingen event_closed-rad: ett event utan deltagare är inte
        // en nyhet ("0 of 6 finished it" varje dag vore brus; Lead-beslut).
        continue;
      }

      // Beräkna total_value per användare utifrån faktiska runs under eventet
      const isKm = event.metric === 'km';
      const scored: Array<{ entryId: string; userId: string; totalValue: number }> = [];

      for (const entry of participants) {
        let runsQuery = supabase
          .from('runs')
          .select(isKm ? 'distance' : 'total_elevation_gain')
          .eq('user_id', entry.user_id)
          .gte('date', toStockholmDate(event.starts_at))
          .lte('date', toStockholmDate(event.ends_at));

        if (!isKm) runsQuery = runsQuery.eq('is_treadmill', false);

        const { data: runs } = await runsQuery;

        const totalValue = (runs ?? []).reduce((sum: number, r: any) => {
          return sum + Number(isKm ? r.distance : r.total_elevation_gain ?? 0);
        }, 0);

        scored.push({ entryId: entry.id, userId: entry.user_id, totalValue });
      }

      // Sortera fallande
      scored.sort((a, b) => b.totalValue - a.totalValue);

      // Dela ut XP per placering
      for (let i = 0; i < scored.length; i++) {
        const { entryId, userId, totalValue } = scored[i];
        const xp = i < xpPerRank.length ? xpPerRank[i] : 0;
        const rank = i + 1;

        await supabase
          .from('event_entries')
          .update({ rank, xp_awarded: xp, total_value: totalValue })
          .eq('id', entryId);

        if (xp > 0) {
          await supabase.rpc('increment_event_xp', { p_user_id: userId, p_xp: xp });
          // Räkna om level baserat på ny total_xp
          const { data: userData } = await supabase
            .from('users').select('total_xp, current_level, group_id').eq('id', userId).single();
          if (userData) {
            const prevLevel = userData.current_level;
            const newLevel = await getLevelFromXP(userData.total_xp);
            await supabase.from('users').update({ current_level: newLevel }).eq('id', userId);
            await recordLevelUps(userId, prevLevel, newLevel, userData.group_id ?? null);
          }
          logger.info(`✅ [Settlement] User ${userId} rank ${rank} for event ${event.id} (+${xp} XP, ${totalValue.toFixed(1)} ${event.metric})`);
        }
      }

      // Pack News: efter utbetalningen. Topp 3 med faktiskt utdelad XP; event_closed:<id> ger exakt en rad.
      if (activityEvent) {
        const members = await countGroupMembers(event.group_id);
        await recordActivity(buildEventClosedDraft(
          activityEvent,
          {
            participants: scored.length,
            members: members ?? scored.length,
            top: scored.slice(0, 3).map((s, i) => ({ user_id: s.userId, rank: i + 1, xp: xpPerRank[i] ?? 0 })),
          },
          now,
        ));
      }

      logger.info(`✅ [Settlement] Competition event ${event.id} settled (${scored.length} participants)`);
    } catch (e) {
      logger.error(`❌ [Settlement] Unexpected error settling event ${event.id}:`, e);
    }
  }
}

// ─── activateScheduledEvents ──────────────────────────────────────────────────

/**
 * Körs var 5:e minut. Övergår events från scheduled → active när starts_at har passerat.
 * Utan detta stannar events i "scheduled" för alltid.
 */
export async function activateScheduledEvents(): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data: events, error } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'scheduled')
    .lte('starts_at', now);

  if (error) {
    logger.error('❌ [Activation] Fetch scheduled events error:', error);
    return;
  }
  if (!events?.length) return;

  const ids = events.map((e: any) => e.id);
  // Statusvakt + returnering: bara events som FAKTISKT gick scheduled → active loggas (Pack News, ADR 008),
  // så att två överlappande instanser aldrig loggar samma aktivering två gånger (event_open:<id> skyddar också).
  const { data: activated, error: updateErr } = await supabase
    .from('events')
    .update({ status: 'active' })
    .in('id', ids)
    .eq('status', 'scheduled')
    .select('id, group_id, type, starts_at, ends_at, event_templates ( name, icon, reward_xp, reward_xp_1st )');

  if (updateErr) {
    logger.error('❌ [Activation] Failed to activate events:', updateErr);
    return;
  }

  logger.info(`✅ [Activation] Activated ${(activated ?? []).length} event(s)`);

  const drafts: ActivityDraft[] = [];
  for (const e of activated ?? []) {
    const row = toActivityEvent(e, asTemplate(e.event_templates));
    if (row) drafts.push(buildEventOpenDraft(row));
  }
  await recordActivities(drafts);
}

// ─── settleExpiredParticipationEvents ─────────────────────────────────────────

/**
 * Körs var 5:e minut. Markerar participation-events vars ends_at har passerat
 * som settled (XP delades redan ut vid kvalificering).
 */
export async function settleExpiredParticipationEvents(): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const { data: events, error } = await supabase
    .from('events')
    .select('id')
    .eq('type', 'participation')
    .in('status', ['active', 'scheduled'])
    .lte('ends_at', now);

  if (error) {
    logger.error('❌ [Settlement] Fetch expired participation events error:', error);
    return;
  }
  if (!events?.length) return;

  const ids = events.map((e: any) => e.id);
  // Statusvakt + returnering (ADR 008): bara events som faktiskt stängdes loggas; ingen settled_at sätts
  // (oförändrat beteende — participation-XP delades redan ut vid kvalificeringen).
  const { data: closed, error: updateErr } = await supabase
    .from('events')
    .update({ status: 'settled' })
    .in('id', ids)
    .in('status', ['active', 'scheduled'])
    .select('id, group_id, type, starts_at, ends_at, event_templates ( name, icon, reward_xp, reward_xp_1st )');

  if (updateErr) {
    logger.error('❌ [Settlement] Failed to settle participation events:', updateErr);
    return;
  }

  logger.info(`✅ [Settlement] Settled ${(closed ?? []).length} expired participation event(s)`);

  try {
    const closedIds = (closed ?? []).map((e: any) => e.id);
    if (closedIds.length === 0) return;

    // participants = antal event_entries per event; members = gruppstorlek (en count per grupp)
    const { data: entries, error: entriesErr } = await supabase
      .from('event_entries')
      .select('event_id')
      .in('event_id', closedIds);
    if (entriesErr) throw entriesErr;
    const participantsByEvent = new Map<string, number>();
    for (const en of entries ?? []) participantsByEvent.set(en.event_id, (participantsByEvent.get(en.event_id) ?? 0) + 1);

    const membersByGroup = new Map<string, number | null>();
    for (const groupId of new Set<string>((closed ?? []).map((e: any) => e.group_id as string))) {
      membersByGroup.set(groupId, await countGroupMembers(groupId));
    }

    const drafts: ActivityDraft[] = [];
    for (const e of closed ?? []) {
      const row = toActivityEvent(e, asTemplate(e.event_templates));
      if (!row) continue;
      const participants = participantsByEvent.get(e.id) ?? 0;
      if (participants === 0) continue; // inga deltagare → ingen nyhet (Lead-beslut)
      drafts.push(buildEventClosedDraft(
        row,
        { participants, members: membersByGroup.get(e.group_id) ?? participants },
        row.ends_at, // participation avslutas av klockan; settled_at sätts inte här
      ));
    }
    await recordActivities(drafts);
  } catch (e) {
    logger.error('❌ [Settlement] Failed to record event_closed news:', e);
  }
}

// ─── checkStormChaserForecast ─────────────────────────────────────────────────

// Stockholm som default-koordinater (appen är primärt för svenska grupper)
const STOCKHOLM_LAT = 59.33;
const STOCKHOLM_LNG = 18.07;

/**
 * WMO-koder som räknas som "dåligt väder" för Storm Chaser:
 * 51-67  = duggregn / regn
 * 71-77  = snöfall / frysande dimma
 * 80-86  = regnskurar / snöskurar
 * 95-99  = åska
 */
function isStormyCode(code: number): boolean {
  return (code >= 51 && code <= 67) ||
         (code >= 71 && code <= 77) ||
         (code >= 80 && code <= 86) ||
         (code >= 95 && code <= 99);
}

/**
 * Kollar imorgondagens timprognos för Stockholm via Open-Meteo (gratis, ingen API-nyckel).
 * Returnerar true om minst 3 timmar av dagen förväntas ha dåligt väder (regn/åska)
 * ELLER om det finns timgustar >= 12 m/s under 3+ timmar.
 */
export async function checkStormChaserForecast(): Promise<boolean> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${STOCKHOLM_LAT}&longitude=${STOCKHOLM_LNG}` +
      `&hourly=weather_code,wind_gusts_10m` +
      `&forecast_days=2` +
      `&timezone=Europe%2FStockholm`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'RunQuest/1.0 (storm chaser event check)' },
    });

    if (!res.ok) {
      logger.warn(`⚠️ [StormChaser] Open-Meteo responded ${res.status}`);
      return false;
    }

    const json = await res.json() as any;
    const times: string[] = json?.hourly?.time ?? [];
    const codes: number[] = json?.hourly?.weather_code ?? [];
    const gusts: number[] = json?.hourly?.wind_gusts_10m ?? [];

    // Hitta imorgondatumets timmar (index 24–47 vid 2-dagars forecast)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10); // "YYYY-MM-DD"

    let stormyHours = 0;
    let gustyHours = 0;

    for (let i = 0; i < times.length; i++) {
      if (!times[i].startsWith(tomorrowStr)) continue;
      // Open-Meteo returns Stockholm local time — only count daytime hours (6:00–21:00)
      const hour = parseInt(times[i].slice(11, 13), 10);
      if (hour < 6 || hour > 21) continue;
      if (isStormyCode(codes[i])) stormyHours++;
      if ((gusts[i] ?? 0) >= 15) gustyHours++; // Raised from 12 → 15 m/s
    }

    // Require 4+ gusty hours (raised from 3) — 15 m/s gusts for 4h is genuinely rough
    const qualifies = stormyHours >= 3 || gustyHours >= 4;
    logger.info(`🌩️ [StormChaser] Tomorrow ${tomorrowStr}: ${stormyHours} stormy hours (≥3?), ${gustyHours} gusty hours ≥15m/s (≥4?) → ${qualifies ? 'TRIGGER' : 'no event'}`);
    return qualifies;
  } catch (err) {
    logger.error('❌ [StormChaser] Forecast check failed:', err);
    return false;
  }
}

// ─── getAllGroups ─────────────────────────────────────────────────────────────

/** Returnerar alla grupp-id:n (används av schedulern för att skapa events per grupp). */
export async function getAllGroupIds(): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('groups').select('id');
  if (error) {
    logger.error('❌ [EventService] getAllGroupIds error:', error);
    return [];
  }
  return (data ?? []).map((g: any) => g.id);
}

// ─── getEventPool ─────────────────────────────────────────────────────────────

export interface PoolMember {
  name: string;
  weight: number;
  startHour: number;
  endHour: number;
  endMinute: number;
  endDayOffset: number;
  condition: string | null;
}

export interface EventPool {
  triggerChance: number;
  members: PoolMember[];
}

/**
 * Hämtar en pool med alla dess members från DB.
 * Schedulern filtrerar bort members med condition='weather' om väder inte kvalificerar.
 *
 * Hierarki: Pool (trigger_chance) → Members (weight) → Events
 */
export async function getEventPool(poolName: string): Promise<EventPool | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('event_pool_members')
    .select(`
      weight,
      condition,
      event_pools!inner ( trigger_chance ),
      event_templates!inner ( name, start_hour, end_hour, end_minute, end_day_offset, active )
    `)
    .eq('event_pools.name', poolName)
    .eq('event_templates.active', true);

  if (error) {
    logger.error(`❌ [EventService] getEventPool(${poolName}) error:`, error);
    return null;
  }
  if (!data?.length) return null;

  const triggerChance = Number((data[0] as any).event_pools.trigger_chance);

  const members: PoolMember[] = data.map((row: any) => ({
    name: row.event_templates.name,
    weight: Number(row.weight),
    startHour: Number(row.event_templates.start_hour),
    endHour: Number(row.event_templates.end_hour),
    endMinute: Number(row.event_templates.end_minute),
    endDayOffset: Number(row.event_templates.end_day_offset ?? 0),
    condition: row.condition ?? null,
  }));

  return { triggerChance, members };
}
