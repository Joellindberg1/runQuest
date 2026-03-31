// 📅 Event Service
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';

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
    .select('id, type, metric')
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
  const { error: insertErr } = await supabase
    .from('events')
    .insert({
      template_id: template.id,
      group_id: groupId,
      type: template.type,
      metric: template.metric ?? null,
      status: startsAt <= new Date() ? 'active' : 'scheduled',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    });

  if (insertErr) {
    logger.error(`❌ [EventService] Failed to create "${templateName}" for group ${groupId}:`, insertErr);
    return false;
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
  groupId?: string;   // om ej känt hämtas det från users-tabellen
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
          // Lägg till XP direkt på användaren
          await supabase.rpc('increment_event_xp', { p_user_id: params.userId, p_xp: rewardXp });
          logger.info(`✅ [EventQual] User ${params.userId} qualified for participation event ${event.id} (+${rewardXp} XP)`);
        }

      } else if (event.type === 'competition') {
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
      metric,
      starts_at,
      ends_at,
      event_templates ( reward_xp_1st, reward_xp_2nd, reward_xp_3rd )
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
      if (!participants.length) {
        await supabase.from('events').update({ status: 'settled' }).eq('id', event.id);
        continue;
      }

      // Beräkna total_value per användare utifrån faktiska runs under eventet
      const isKm = event.metric === 'km';
      const scored: Array<{ entryId: string; userId: string; totalValue: number }> = [];

      for (const entry of participants) {
        const { data: runs } = await supabase
          .from('runs')
          .select(isKm ? 'distance' : 'total_elevation_gain')
          .eq('user_id', entry.user_id)
          .gte('date', event.starts_at.slice(0, 10))
          .lte('date', event.ends_at.slice(0, 10));

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
          logger.info(`✅ [Settlement] User ${userId} rank ${rank} for event ${event.id} (+${xp} XP, ${totalValue.toFixed(1)} ${event.metric})`);
        }
      }

      // Markera eventet som settled
      await supabase.from('events').update({ status: 'settled' }).eq('id', event.id);
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
  const { error: updateErr } = await supabase
    .from('events')
    .update({ status: 'active' })
    .in('id', ids);

  if (updateErr) {
    logger.error('❌ [Activation] Failed to activate events:', updateErr);
  } else {
    logger.info(`✅ [Activation] Activated ${ids.length} event(s)`);
  }
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
  const { error: updateErr } = await supabase
    .from('events')
    .update({ status: 'settled' })
    .in('id', ids);

  if (updateErr) {
    logger.error('❌ [Settlement] Failed to settle participation events:', updateErr);
  } else {
    logger.info(`✅ [Settlement] Settled ${ids.length} expired participation event(s)`);
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

// ─── getDailyPoolTemplates ─────────────────────────────────────────────────────

export interface DailyPoolTemplate {
  name: string;
  spawnChance: number;
  startHour: number;
  endHour: number;
  endMinute: number;
  requiresWeather: string | null;
}

/**
 * Hämtar templates som ingår i den dagliga 19:00-poolen.
 * (Morgonrunda, Kvällsrunda, Storm Chaser)
 * Tidsfönster och vikter hämtas från DB.
 */
export async function getDailyPoolTemplates(): Promise<DailyPoolTemplate[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('event_templates')
    .select('name, spawn_chance, start_hour, end_hour, end_minute, requires_weather')
    .in('name', ['Morgonrunda', 'Kvällsrunda', 'Storm Chaser'])
    .eq('active', true);

  if (error) {
    logger.error('❌ [EventService] getDailyPoolTemplates error:', error);
    return [];
  }

  return (data ?? []).map((t: any) => ({
    name: t.name,
    spawnChance: Number(t.spawn_chance),
    startHour: Number(t.start_hour),
    endHour: Number(t.end_hour),
    endMinute: Number(t.end_minute),
    requiresWeather: t.requires_weather ?? null,
  }));
}

// ─── getTemplateTimeWindow ────────────────────────────────────────────────────

export interface TemplateTimeWindow {
  startHour: number;
  endHour: number;
  endMinute: number;
  spawnChance: number;
}

/**
 * Hämtar tidsfönster och spawn_chance för ett enskilt template.
 */
export async function getTemplateTimeWindow(name: string): Promise<TemplateTimeWindow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('event_templates')
    .select('spawn_chance, start_hour, end_hour, end_minute')
    .eq('name', name)
    .single();

  if (error || !data) return null;
  return {
    spawnChance: Number(data.spawn_chance),
    startHour: Number(data.start_hour),
    endHour: Number(data.end_hour),
    endMinute: Number(data.end_minute),
  };
}
