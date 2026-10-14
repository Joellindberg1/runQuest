// Strava import: the shared rules and row shape, so polling and the webhook worker write identical rows (ADR 010 decision 7).
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';
import { isTreadmillActivity } from '../utils/stravaActivity.js';
import { fetchDetailedActivity } from './stravaClient.js';
import {
  STRAVA_DISTANCE_MUST_EXCEED_KM,
  STRAVA_LEGACY_RUN_TYPE,
  STRAVA_RUN_SPORT_TYPES,
} from '@runquest/shared';

const RUNNING_SPORT_TYPES = new Set<string>(STRAVA_RUN_SPORT_TYPES);

/** Returns the sport_type if it's a valid running type, otherwise null. */
export function normalizeSportType(sportType?: string): string | null {
  if (sportType && RUNNING_SPORT_TYPES.has(sportType)) return sportType;
  return null;
}

/** Returns true for any Strava activity we want to import as a run. */
export function isRunningActivity(activity: any): boolean {
  // Prefer sport_type (newer field); fall back to type for older data
  if (activity.sport_type) return RUNNING_SPORT_TYPES.has(activity.sport_type);
  return activity.type === STRAVA_LEGACY_RUN_TYPE;
}

/** The distance rule: a run is imported only when it is longer than the limit in shared/rules.ts. `distance` is in metres. */
export function exceedsImportDistance(activity: { distance: number }): boolean {
  return activity.distance / 1000 > STRAVA_DISTANCE_MUST_EXCEED_KM;
}

/**
 * Compute pace standard deviation (sec/km) from Strava splits_metric.
 * Returns null if there are fewer than 2 complete splits.
 */
export function computePaceStdDev(splits?: Array<{ distance: number; moving_time: number }>): number | null {
  if (!splits || splits.length < 2) return null;
  const paces = splits
    .filter(s => s.distance > 0)
    .map(s => s.moving_time / (s.distance / 1000));
  if (paces.length < 2) return null;
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const variance = paces.reduce((sum, p) => sum + (p - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance);
}

/** Build the extended-data fields from a Strava activity object. */
export function extractExtendedFields(activity: any) {
  return {
    start_time:     activity.start_date_local ?? null,
    moving_time:    activity.moving_time       ?? null,
    total_elevation_gain: activity.total_elevation_gain ?? null,
    sport_type:     normalizeSportType(activity.sport_type),
    avg_heartrate:  activity.average_heartrate ?? null,
    max_heartrate:  activity.max_heartrate     ?? null,
    suffer_score:   activity.suffer_score      ?? null,
    start_lat:      activity.start_latlng?.[0] ?? null,
    start_lng:      activity.start_latlng?.[1] ?? null,
    pace_std_dev:   computePaceStdDev(activity.splits_metric),
    is_treadmill:   isTreadmillActivity(activity),
  };
}

/** XP is recalculated by reprocessRunsFromDate after the import; the row starts with these placeholders. */
export const STRAVA_XP_PLACEHOLDERS = {
  base_xp: 0,
  km_xp: 0,
  distance_bonus: 0,
  streak_bonus: 0,
  multiplier: 1.0,
  streak_day: 1,
  xp_gained: 0,
} as const;

/**
 * The runs row for a Strava activity. `activity` supplies identity, date and distance (the list summary is enough);
 * `detailed` is the detail response, when there is one, and supplies the extended fields (it alone carries splits_metric).
 */
export function buildStravaRunRow(userId: string, activity: any, detailed?: any) {
  return {
    user_id: userId,
    date: activity.start_date_local.split('T')[0] as string,
    distance: activity.distance / 1000,
    source: 'strava' as const,
    external_id: activity.id.toString() as string,
    ...extractExtendedFields(detailed ?? activity),
    ...STRAVA_XP_PLACEHOLDERS,
    created_at: new Date().toISOString(),
  };
}

export interface ImportedRun {
  id: string;
  external_id: string;
  start_lat: number | null;
  start_lng: number | null;
  start_time: string | null;
  moving_time: number | null;
  is_treadmill: boolean;
}

export type ImportResult = { status: 'imported'; run: ImportedRun } | { status: 'exists' };

/**
 * Import one Strava activity as a run for the user, with the detail call for splits_metric. A run that already exists for
 * (user_id, external_id) is not an error (unique index, code 23505): polling and the webhook worker can race on the same activity.
 * Any other database error is logged and rethrown.
 */
export async function importStravaActivity(userId: string, activity: any, accessToken: string): Promise<ImportResult> {
  const detailed = await fetchDetailedActivity(activity.id, accessToken);
  const row = buildStravaRunRow(userId, activity, detailed);
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .insert(row)
    .select('id, external_id, start_lat, start_lng, start_time, moving_time, is_treadmill')
    .single();
  if (error?.code === '23505') return { status: 'exists' };
  if (error) {
    logger.error(`❌ Failed to insert run (activity ${activity.id}): ${error.message}`, { fields: extractExtendedFields(detailed ?? activity) });
    throw error;
  }
  return { status: 'imported', run: data as ImportedRun };
}
