// Strava import: the shared rules and row shape, so polling and the webhook worker write identical rows (ADR 010 decision 7).
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { getSupabaseClient } from '../config/database.js';
import { isTreadmillActivity, stravaKm, stravaRunDay } from '../utils/stravaActivity.js';
import { fetchDetailedActivityResult } from './stravaClient.js';
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

/** A sport field Strava really named: a non-empty string. Anything else (missing, null, '', a number) counts as absent. */
export function isNamedSport(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Returns true for any Strava activity we want to import as a run. */
export function isRunningActivity(activity: any): boolean {
  // Prefer sport_type (newer field); fall back to type for older data
  if (isNamedSport(activity.sport_type)) return RUNNING_SPORT_TYPES.has(activity.sport_type);
  return activity.type === STRAVA_LEGACY_RUN_TYPE;
}

/** The distance rule: a run is imported only when it is longer than the limit in shared/rules.ts. `distance` is in metres. */
export function exceedsImportDistance(activity: { distance: number }): boolean {
  return stravaKm(activity.distance) > STRAVA_DISTANCE_MUST_EXCEED_KM;
}

/**
 * Compute pace standard deviation (sec/km) from Strava splits_metric.
 * Returns null if there are fewer than 2 complete splits.
 */
export function computePaceStdDev(splits?: Array<{ distance: number; moving_time: number }>): number | null {
  if (!splits || splits.length < 2) return null;
  const paces = splits
    .filter(s => s.distance > 0)
    .map(s => s.moving_time / stravaKm(s.distance));
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
    date: stravaRunDay(activity),
    distance: stravaKm(activity.distance),
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

/** `exists` carries no row: a caller that needs it reads (user_id, external_id) again (the webhook handler does, through RunStore.findRun). */
export type InsertResult = { status: 'imported'; run: ImportedRun } | { status: 'exists' };

/**
 * What the polling's import (importStravaActivity) reports: an InsertResult, or `skipped_gone` when its detail call answered 404 and
 * nothing was inserted. Neither a new run nor a failure. insertStravaRun never makes that call, so the webhook handlers, which only
 * insert, get the narrower InsertResult and need no case for it: they treat a 404 themselves, from the fetch they made (decideAction).
 */
export type ImportResult = InsertResult | { status: 'skipped_gone' };

/** The unique index on runs (user_id, external_id) (migration 033). Only a violation of this one means "already imported". */
export const RUNS_EXTERNAL_ID_INDEX = 'idx_runs_external_id';

/** True when the insert failed because the run is already there: 23505 on the external id index, not on any other unique index. */
function isExternalIdConflict(error: { code?: string; message?: string; details?: string | null } | null): boolean {
  return error?.code === '23505' && `${error.message ?? ''} ${error.details ?? ''}`.includes(RUNS_EXTERNAL_ID_INDEX);
}

/**
 * Insert one Strava run for the user from an activity the caller already has. `detailed` is the detail response, when there is one
 * (null/undefined = the summary alone supplies the extended fields). Makes NO Strava call: the webhook handler has fetched the
 * detail itself, and the polling goes through importStravaActivity. A run that already exists for (user_id, external_id) is not an
 * error (unique index idx_runs_external_id, code 23505): polling and the webhook worker can race on the same activity. Any other
 * database error, a 23505 on another index included, is logged and rethrown.
 */
export async function insertStravaRun(userId: string, activity: any, detailed?: any): Promise<InsertResult> {
  const row = buildStravaRunRow(userId, activity, detailed);
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .insert(row)
    .select('id, external_id, start_lat, start_lng, start_time, moving_time, is_treadmill')
    .single();
  if (isExternalIdConflict(error)) return { status: 'exists' };
  if (error) {
    // Our user id and the error code only (ADR 010 8.6): no Strava id, no coordinates or heart rate, and not the message, which
    // can carry the values of the row (a unique violation prints its key).
    logger.error(`❌ Failed to insert a Strava run for user ${userId} (${errorCode(error)})`);
    throw error;
  }
  return { status: 'imported', run: data as ImportedRun };
}

/**
 * Import one Strava activity as a run for the user, with the detail call for splits_metric (the polling's path: it lists summaries).
 * The insert, and what a duplicate means, is insertStravaRun.
 *
 * A 404 on the detail call means the activity is deleted or private (ADR 010 7.3): it is skipped, never built from the summary. The
 * list the polling works from can be stale, and a run the webhook has just deleted must stay deleted; a private activity is not
 * imported either. Any other failure of the detail call keeps the old fallback: the summary supplies the row.
 */
export async function importStravaActivity(userId: string, activity: any, accessToken: string): Promise<ImportResult> {
  const detail = await fetchDetailedActivityResult(activity.id, accessToken);
  if (detail.kind === 'gone') {
    logger.info(`ℹ️ Skipped a Strava activity for user ${userId}: the detail call answered HTTP 404 (deleted or private)`);
    return { status: 'skipped_gone' };
  }
  return insertStravaRun(userId, activity, detail.kind === 'ok' ? detail.activity : null);
}
