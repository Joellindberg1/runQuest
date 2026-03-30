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

  // Kolla om det redan finns ett event från samma template för denna grupp
  // som överlappar med det önskade fönstret
  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('template_id', template.id)
    .eq('group_id', groupId)
    .in('status', ['scheduled', 'active'])
    .gte('ends_at', startsAt.toISOString())
    .lte('starts_at', endsAt.toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    logger.info(`ℹ️ [EventService] "${templateName}" already exists for group ${groupId}, skipping`);
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
    .eq('status', 'active')
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

  // Hämta alla aktiva events för gruppen som passet faller inom
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      type,
      starts_at,
      ends_at,
      event_templates ( min_km )
    `)
    .eq('group_id', groupId)
    .eq('status', 'active')
    .lte('starts_at', `${params.runDate}T23:59:59Z`)
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
        // Skapa entry — UNIQUE(event_id, user_id) förhindrar dubbletter
        const { error: insertErr } = await supabase
          .from('event_entries')
          .insert({
            event_id: event.id,
            user_id: params.userId,
            run_id: params.runId,
            qualified_at: now,
          });
        if (insertErr && insertErr.code !== '23505') { // 23505 = unique_violation
          logger.error(`❌ [EventQual] Failed to insert participation entry:`, insertErr);
        } else if (!insertErr) {
          logger.info(`✅ [EventQual] User ${params.userId} qualified for participation event ${event.id}`);
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
