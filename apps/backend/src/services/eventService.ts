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
