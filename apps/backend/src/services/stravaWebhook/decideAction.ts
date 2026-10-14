// The decision function of the Strava webhook worker (ADR 010 decisions 1, 7.1 and 7.6): Strava's state plus the database's state
// in, one action out. Pure: no database, no network, no logger, no clock. The handlers (create, update, delete) share this one table
// and do the I/O the action asks for.
//
// Two steps, because a paused user's `create` must not cost a Strava call (ADR 010 7.5.3):
//   1. decideBeforeFetch({ aspect_type, paused })  ->  'skip' (finish with the outcome) or 'fetch'
//   2. decideAction({ ...the Strava answer, the existing run, attempts })  ->  what to do with the database
import { exceedsImportDistance, extractExtendedFields, isRunningActivity } from '../stravaImport.js';
import { WEBHOOK_BACKOFF_MINUTES, type WebhookAspectType } from './constants.js';

/** The detail response of GET /activities/:id; only the fields the decision reads are named. */
export interface StravaActivityDetail {
  id: number | string;
  sport_type?: string;
  type?: string;
  private?: boolean;
  distance: number;
  start_date_local: string;
  [field: string]: unknown;
}

/** What came back from Strava: an HTTP answer (status, plus the activity on 200) or no answer at all. */
export type StravaResponse =
  | { kind: 'http'; status: number; activity?: StravaActivityDetail | null }
  | { kind: 'network_error' };

/**
 * The run row as the database returns it for (user_id, external_id). Only the columns the comparison reads.
 * `distance` is numeric(6,2), so it comes back rounded to two decimals; `start_time` is a timestamptz string.
 */
export interface ExistingRun {
  source: string;
  date: string;
  distance: number;
  start_time: string | null;
  moving_time: number | null;
  total_elevation_gain: number | null;
  sport_type: string | null;
  avg_heartrate: number | null;
  max_heartrate: number | null;
  suffer_score: number | null;
  start_lat: number | null;
  start_lng: number | null;
  pace_std_dev: number | null;
  is_treadmill: boolean | null;
}

type ExtendedFields = ReturnType<typeof extractExtendedFields>;
/** Columns an update writes: only the ones that differ. Never the XP columns. */
export type RunChanges = Partial<{ date: string; distance: number } & ExtendedFields>;

export interface DecideInput {
  aspect_type: WebhookAspectType;
  paused: boolean;
  response: StravaResponse;
  /** The run with this (user_id, external_id), whatever its source; null when there is none. */
  existingRun: ExistingRun | null;
  /** Failed attempts so far (the event's `attempts` column, before this try). */
  attempts: number;
  /** True once the handler has refreshed the token for this event and fetched again. */
  tokenRefreshed: boolean;
}

export type RetryReason = 'unauthorized' | 'server_error' | 'network_error' | 'unexpected_status' | 'invalid_response';

interface Effects {
  /** The earliest date reprocessRunsFromDate must start from; null = no recalculation. */
  recalculateFrom: string | null;
  /** Delete the run's run_weather row so backfillMissingWeather fetches it again. */
  clearWeather: boolean;
}

export type ActionDecision =
  | ({ action: 'insert'; outcome: 'imported' } & Effects)
  | ({ action: 'update'; outcome: 'updated'; changes: RunChanges } & Effects)
  | ({ action: 'remove'; outcome: 'deleted' | 'removed_private' | 'removed_not_running' } & Effects)
  | ({ action: 'none'; outcome: 'noop' | 'not_a_run' | 'ignored_paused' | 'ignored_not_confirmed' } & Effects)
  // The Strava answer says nothing about the database yet: the handler acts and the event is not finished.
  | { action: 'refresh_token'; outcome: null; countsAsFailedAttempt: false }
  | { action: 'wait'; outcome: null; countsAsFailedAttempt: false }
  | { action: 'retry'; outcome: null; countsAsFailedAttempt: true; reason: RetryReason; retryAfterMinutes: number };

export type FetchPlan = { action: 'skip'; outcome: 'ignored_paused' } | { action: 'fetch' };

/** Step 1: does this event need Strava's state at all? Only `create` for a paused user does not (ADR 010 7.5.3). */
export function decideBeforeFetch(input: { aspect_type: WebhookAspectType; paused: boolean }): FetchPlan {
  if (input.paused && input.aspect_type === 'create') return { action: 'skip', outcome: 'ignored_paused' };
  return { action: 'fetch' };
}

/** Dates are 'YYYY-MM-DD', so the string order is the date order. */
function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function none(outcome: Extract<ActionDecision, { action: 'none' }>['outcome'], recalculateFrom: string | null = null): ActionDecision {
  return { action: 'none', outcome, recalculateFrom, clearWeather: false };
}

function retry(reason: RetryReason, attempts: number): ActionDecision {
  // `attempts` counts the failures before this one; ADR 010 decision 6 indexes the list with min(attempts_after - 1, 3).
  const index = Math.min(Math.max(attempts, 0), WEBHOOK_BACKOFF_MINUTES.length - 1);
  return { action: 'retry', outcome: null, countsAsFailedAttempt: true, reason, retryAfterMinutes: WEBHOOK_BACKOFF_MINUTES[index] };
}

function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return Math.abs(a - b) < 1e-9;
}

/** Timestamps compare as instants: the database writes `+00:00` where Strava writes `Z`. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  return Number.isNaN(timeA) || Number.isNaN(timeB) ? a === b : timeA === timeB;
}

/** The columns where Strava differs from the run, with Strava's values. Empty = nothing to write. */
function diffRun(existing: ExistingRun, activity: StravaActivityDetail): RunChanges {
  const changes: RunChanges = {};
  const date = activity.start_date_local.split('T')[0];
  const distanceKm = activity.distance / 1000;
  if (existing.date !== date) changes.date = date;
  // numeric(6,2) rounds on write: compare the rounded value or a run like 5.2345 km would differ forever.
  if (!sameNumber(existing.distance, Math.round(distanceKm * 100) / 100)) changes.distance = distanceKm;

  const fresh = extractExtendedFields(activity);
  if (!sameInstant(existing.start_time, fresh.start_time)) changes.start_time = fresh.start_time;
  if (!sameNumber(existing.moving_time, fresh.moving_time)) changes.moving_time = fresh.moving_time;
  if (!sameNumber(existing.total_elevation_gain, fresh.total_elevation_gain)) changes.total_elevation_gain = fresh.total_elevation_gain;
  if ((existing.sport_type ?? null) !== fresh.sport_type) changes.sport_type = fresh.sport_type;
  if (!sameNumber(existing.avg_heartrate, fresh.avg_heartrate)) changes.avg_heartrate = fresh.avg_heartrate;
  if (!sameNumber(existing.max_heartrate, fresh.max_heartrate)) changes.max_heartrate = fresh.max_heartrate;
  if (!sameNumber(existing.suffer_score, fresh.suffer_score)) changes.suffer_score = fresh.suffer_score;
  if (!sameNumber(existing.start_lat, fresh.start_lat)) changes.start_lat = fresh.start_lat;
  if (!sameNumber(existing.start_lng, fresh.start_lng)) changes.start_lng = fresh.start_lng;
  if (!sameNumber(existing.pace_std_dev, fresh.pace_std_dev)) changes.pace_std_dev = fresh.pace_std_dev;
  if ((existing.is_treadmill ?? false) !== fresh.is_treadmill) changes.is_treadmill = fresh.is_treadmill;
  return changes;
}

/** Step 2: the table in ADR 010 7.1, with the paused-user changes from 7.5.3. */
export function decideAction(input: DecideInput): ActionDecision {
  const { aspect_type, paused, response, existingRun, attempts, tokenRefreshed } = input;

  // Normally stopped by decideBeforeFetch; kept so the table holds even if a caller skips step 1.
  if (paused && aspect_type === 'create') return none('ignored_paused');

  if (response.kind === 'network_error') return retry('network_error', attempts);

  const { status } = response;
  if (status === 429) return { action: 'wait', outcome: null, countsAsFailedAttempt: false };
  if (status === 401) {
    // The function cannot refresh a token. First 401: ask the handler to; the second means the connection is not usable.
    return tokenRefreshed ? retry('unauthorized', attempts) : { action: 'refresh_token', outcome: null, countsAsFailedAttempt: false };
  }
  if (status >= 500) return retry('server_error', attempts);

  // `remove` is produced only for a run whose source is 'strava' (ADR 010 decision 8). A manual run is never touched.
  const stravaRun = existingRun?.source === 'strava' ? existingRun : null;

  if (status === 404) {
    // Deleted, or private under activity:read: Strava does not tell the two apart (ADR 010 7.3).
    if (stravaRun) return { action: 'remove', outcome: 'deleted', recalculateFrom: stravaRun.date, clearWeather: false };
    return none('not_a_run');
  }
  if (status !== 200) return retry('unexpected_status', attempts);

  const activity = response.activity;
  if (!activity || typeof activity !== 'object') return retry('invalid_response', attempts);

  // A run something will read: parsable date and distance. Anything else is a broken answer, not a reason to delete.
  const isPrivate = activity.private === true;
  const hasStartDate = typeof activity.start_date_local === 'string' && activity.start_date_local.length >= 10;
  const hasDistance = typeof activity.distance === 'number' && Number.isFinite(activity.distance);
  if (!isPrivate && isRunningActivity(activity) && (!hasStartDate || !hasDistance)) return retry('invalid_response', attempts);

  const activityDate = hasStartDate ? activity.start_date_local.split('T')[0] : null;
  // After a failed attempt the run may already match Strava because that attempt wrote it and died before the recalculation (ADR 010 decision 6).
  const retryRecalc = (date: string | null) => (attempts >= 1 ? date : null);

  const visibleRun = !isPrivate && isRunningActivity(activity) && hasDistance && exceedsImportDistance(activity);

  if (!visibleRun) {
    if (stravaRun) {
      return {
        action: 'remove',
        outcome: isPrivate ? 'removed_private' : 'removed_not_running',
        recalculateFrom: stravaRun.date,
        clearWeather: false,
      };
    }
    return none('not_a_run', retryRecalc(earliest(existingRun?.date ?? null, activityDate)));
  }

  // From here: Strava shows a visible running activity.
  if (aspect_type === 'delete') return none('ignored_not_confirmed');
  if (paused) return none('ignored_paused');

  if (!existingRun) {
    return { action: 'insert', outcome: 'imported', recalculateFrom: activityDate, clearWeather: false };
  }
  if (!stravaRun) return none('noop'); // a manual run on the same id: leave it alone

  const changes = diffRun(stravaRun, activity);
  if (Object.keys(changes).length === 0) {
    return none('noop', retryRecalc(earliest(stravaRun.date, activityDate)));
  }
  return {
    action: 'update',
    outcome: 'updated',
    changes,
    recalculateFrom: earliest(stravaRun.date, activityDate),
    clearWeather: 'start_time' in changes || 'start_lat' in changes || 'start_lng' in changes,
  };
}

