// 📰 Händelseloggen (activity_log, ADR 008) — den ENDA skrivmodulen för Pack News.
//
// Loggen OBSERVERAR spelet och är härledd visningsdata: alla funktioner här är ICKE-KASTANDE.
// Fel loggas på error-nivå och sväljs — en misslyckad loggrad får aldrig fälla XP-/titel-/
// utmaningskedjan (STATE zon 1). Anropare skriver loggen EFTER att den underliggande skrivningen lyckats.
//
// Idempotens: varje rad har en deterministisk dedupe_key (shared/activityKeys) och skrivs med
// upsert(onConflict: 'dedupe_key', ignoreDuplicates: true) = INSERT … ON CONFLICT DO NOTHING.
// Omkörning, överlappande instanser och omräkning kan därför aldrig ge en dubblett.
//
// Realtid (ADR 008 beslut 11): hit kopplas en framtida intern händelsebuss efter lyckad insert.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import {
  activityKeys,
  buildChallengeReceivedDraft,
  buildChallengeSettledDraft,
  buildLevelUpDrafts,
  buildRunMilestoneDrafts,
  type ActivityDraft,
  type ChallengeActivityRow,
} from '@runquest/shared';

export const ACTIVITY_LOG_TABLE = 'activity_log';

/** Kolumnerna som skrivs (id och created_at sätts av databasen). Explicit pick — inget extra läcker in. */
export function toActivityRow(d: ActivityDraft) {
  return {
    group_id: d.group_id,
    type: d.type,
    actor_user_id: d.actor_user_id,
    target_user_id: d.target_user_id,
    payload: d.payload,
    payload_version: d.payload_version,
    dedupe_key: d.dedupe_key,
    is_backfill: d.is_backfill,
    occurred_at: d.occurred_at,
  };
}

/** Skriver rader; dubbletter (samma dedupe_key) ignoreras tyst. Kastar aldrig. */
export async function recordActivities(entries: ReadonlyArray<ActivityDraft>): Promise<void> {
  if (entries.length === 0) return;
  try {
    const { error } = await getSupabaseClient()
      .from(ACTIVITY_LOG_TABLE)
      .upsert(entries.map(toActivityRow), { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (error) {
      logger.error('❌ [ActivityLog] Failed to write activity rows:', { error, types: entries.map((e) => e.type) });
    }
  } catch (e) {
    logger.error('❌ [ActivityLog] Unexpected error writing activity rows:', e);
  }
}

export async function recordActivity(entry: ActivityDraft): Promise<void> {
  await recordActivities([entry]);
}

/** Tar bort en rad via nyckeln (challenge_received när utmaningen återkallas/avböjs). Kastar aldrig. */
export async function retractActivity(dedupeKey: string): Promise<void> {
  try {
    const { error } = await getSupabaseClient().from(ACTIVITY_LOG_TABLE).delete().eq('dedupe_key', dedupeKey);
    if (error) logger.error('❌ [ActivityLog] Failed to retract activity row:', { error, dedupeKey });
  } catch (e) {
    logger.error('❌ [ActivityLog] Unexpected error retracting activity row:', e);
  }
}

// ─── Utmaningar ──────────────────────────────────────────────────────────────

/** challenge_received — anropas efter insert + token-markering i POST /challenges/send. */
export async function recordChallengeReceived(challenge: ChallengeActivityRow, occurredAt: string = new Date().toISOString()): Promise<void> {
  try {
    await recordActivity(buildChallengeReceivedDraft(challenge, occurredAt));
  } catch (e) {
    logger.error('❌ [ActivityLog] recordChallengeReceived failed:', e);
  }
}

/** Utmaningen raderas (återkallad/avböjd/auto-avböjd) → flödet ska inte visa en utmaning som inte finns. */
export async function retractChallengeReceived(challengeId: string): Promise<void> {
  await retractActivity(activityKeys.challengeReceived(challengeId));
}

/** challenge_won/challenge_draw — anropas av settleChallenge efter claim + W/D/L. Nyckeln ger exakt en rad. */
export async function recordChallengeSettled(challenge: ChallengeActivityRow, occurredAt: string = new Date().toISOString()): Promise<void> {
  try {
    const draft = buildChallengeSettledDraft(challenge, occurredAt);
    if (draft) await recordActivity(draft);
  } catch (e) {
    logger.error('❌ [ActivityLog] recordChallengeSettled failed:', e);
  }
}

// ─── Level och milstolpar ────────────────────────────────────────────────────

/** Gruppen läses ur users.group_id, aldrig ur funktionsparametrar (Strava-importen saknar groupId). */
async function lookupGroupId(userId: string): Promise<string | null> {
  const { data } = await getSupabaseClient().from('users').select('group_id').eq('id', userId).single();
  return data?.group_id ?? null;
}

/**
 * level_up: en rad per uppnådd nivå i (prev, new]. `groupId` kan skickas med om anroparen redan läst
 * users.group_id (undefined → slås upp; null → ingen grupp, ingen rad). Ingen rad om prev saknas.
 */
export async function recordLevelUps(
  userId: string, prevLevel: number | null | undefined, newLevel: number | null | undefined,
  groupId?: string | null,
): Promise<void> {
  try {
    if (!(typeof prevLevel === 'number' && typeof newLevel === 'number' && newLevel > prevLevel)) return;
    const group = groupId === undefined ? await lookupGroupId(userId) : groupId;
    if (!group) return;
    await recordActivities(buildLevelUpDrafts(userId, group, prevLevel, newLevel, new Date().toISOString()));
  } catch (e) {
    logger.error('❌ [ActivityLog] recordLevelUps failed:', e);
  }
}

/** run_milestone: prevTotalKm < tröskel ≤ nytt totalKm. */
export async function recordRunMilestones(
  userId: string, prevKm: number | null | undefined, newKm: number | null | undefined,
  groupId?: string | null,
): Promise<void> {
  try {
    if (!(typeof prevKm === 'number' && typeof newKm === 'number' && newKm > prevKm)) return;
    const group = groupId === undefined ? await lookupGroupId(userId) : groupId;
    if (!group) return;
    await recordActivities(buildRunMilestoneDrafts(userId, group, prevKm, newKm, new Date().toISOString()));
  } catch (e) {
    logger.error('❌ [ActivityLog] recordRunMilestones failed:', e);
  }
}
