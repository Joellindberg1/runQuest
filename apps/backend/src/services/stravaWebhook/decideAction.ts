// The decision function of the Strava webhook worker (ADR 010 decisions 1, 7.1 and 7.6): Strava's state plus the database's state
// in, one action out. Pure: no database, no network, no logger, no clock. The handlers (create, update, delete) share this one table
// and do the I/O the action asks for.
//
// Two steps, because a paused user's `create` must not cost a Strava call (ADR 010 7.5.3):
//   1. decideBeforeFetch({ aspect_type, paused })  ->  'skip' (finish with the outcome) or 'fetch'
//   2. decideAction({ ...the Strava answer, the existing run, attempts })  ->  what to do with the database
import { connectionDay } from '../../utils/stravaLookback.js';
import { exceedsImportDistance, extractExtendedFields, isNamedSport, isRunningActivity } from '../stravaImport.js';
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

type ExtendedFields = ReturnType<typeof extractExtendedFields>;

/**
 * The run row as the database returns it for (user_id, external_id). Only the columns the comparison reads: date, distance and
 * every column extractExtendedFields returns (the type follows that function, so a new column must be supplied by the caller).
 * `distance` is numeric(6,2), so it comes back rounded to two decimals; `start_time` is a timestamptz string.
 */
export type ExistingRun = { source: string; date: string; distance: number } & {
  [Column in keyof ExtendedFields]: ExtendedFields[Column] | null;
};

/** Columns an update writes: only the ones that differ. Never the XP columns. */
export type RunChanges = Partial<{ date: string; distance: number } & ExtendedFields>;

export interface DecideInput {
  aspect_type: WebhookAspectType;
  paused: boolean;
  response: StravaResponse;
  /** The run with this (user_id, external_id), whatever its source; null when there is none. */
  existingRun: ExistingRun | null;
  /** Failed attempts so far (the event's `attempts` column, before this try). NaN or negative counts as 0. */
  attempts: number;
  /**
   * strava_tokens.connection_date as stored (a timestamp). An activity that started on an earlier calendar day is never imported
   * (owner decision 2026-10-14). Null (old legacy connections) = no restriction. Mandatory on purpose: a caller that forgets it
   * would silently switch the owner's promise off, so a missing property is a type error.
   */
  connectionDate: string | null;
  /** True once the handler has refreshed the token for this event and fetched again. */
  tokenRefreshed: boolean;
}

export type RetryReason = 'unauthorized' | 'server_error' | 'network_error' | 'unexpected_status' | 'invalid_response';

interface Effects {
  /** The earliest date reprocessRunsFromDate must start from; null = no recalculation (or see recalculateUnknown). */
  recalculateFrom: string | null;
  /** Delete the run's run_weather row so backfillMissingWeather fetches it again. */
  clearWeather: boolean;
  /**
   * True only when this is a retry (attempts >= 1) that found no run and has no date either: the earlier attempt may have
   * deleted the run and died before the recalculation, and the date went with the run. The handler decides the fallback.
   */
  recalculateUnknown: boolean;
}

export type ActionDecision =
  | ({ action: 'insert'; outcome: 'imported' } & Effects)
  | ({ action: 'update'; outcome: 'updated'; changes: RunChanges } & Effects)
  | ({ action: 'remove'; outcome: 'deleted' | 'removed_private' | 'removed_not_running' } & Effects)
  | ({ action: 'none'; outcome: 'noop' | 'not_a_run' | 'ignored_paused' | 'ignored_not_confirmed' } & Effects)
  // The Strava answer says nothing about the database yet: the handler acts and the event is not finished.
  | ({ action: 'refresh_token'; outcome: null; countsAsFailedAttempt: false } & Effects)
  | ({ action: 'wait'; outcome: null; countsAsFailedAttempt: false } & Effects)
  | ({ action: 'retry'; outcome: null; countsAsFailedAttempt: true; reason: RetryReason; retryAfterMinutes: number } & Effects);

export type FetchPlan = { action: 'skip'; outcome: 'ignored_paused' } | { action: 'fetch' };

/** Step 1: does this event need Strava's state at all? Only `create` for a paused user does not (ADR 010 7.5.3). */
export function decideBeforeFetch(input: { aspect_type: WebhookAspectType; paused: boolean }): FetchPlan {
  if (input.paused && input.aspect_type === 'create') return { action: 'skip', outcome: 'ignored_paused' };
  return { action: 'fetch' };
}

/**
 * The connection-day rule: does the activity's local start day fall before the day the user connected? Both are Stockholm calendar
 * days ('YYYY-MM-DD'; a timestamp is cut to its date). Nothing to compare (no connection date, an unreadable date) = not before.
 */
export function isBeforeConnectionDay(activityLocalDate: string, connectionDate: string | null | undefined): boolean {
  const activityDay = /^\d{4}-\d{2}-\d{2}/.test(activityLocalDate) ? activityLocalDate.slice(0, 10) : null;
  const connectedOn = connectionDay(connectionDate);
  return activityDay !== null && connectedOn !== null && activityDay < connectedOn;
}

const NO_EFFECTS: Effects = { recalculateFrom: null, clearWeather: false, recalculateUnknown: false };

/** Dates are 'YYYY-MM-DD', so the string order is the date order. */
function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function none(
  outcome: Extract<ActionDecision, { action: 'none' }>['outcome'],
  effects: Partial<Effects> = {},
): ActionDecision {
  return { action: 'none', outcome, ...NO_EFFECTS, ...effects };
}

function retry(reason: RetryReason, attempts: number): ActionDecision {
  // `attempts` counts the failures before this one; ADR 010 decision 6 indexes the list with min(attempts_after - 1, 3).
  const index = Math.min(attempts, WEBHOOK_BACKOFF_MINUTES.length - 1);
  return {
    action: 'retry',
    outcome: null,
    countsAsFailedAttempt: true,
    reason,
    retryAfterMinutes: WEBHOOK_BACKOFF_MINUTES[index],
    ...NO_EFFECTS,
  };
}

function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return Math.abs(a - b) < 1e-9;
}

/** Timestamps compare as instants: the database writes `+00:00` where Strava writes `Z`. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  return Number.isNaN(timeA) || Number.isNaN(timeB) ? a === b : timeA === timeB;
}

/** One extended column, stored against Strava's value. Typed by the value, so a new column is compared without an edit here. */
function sameColumn(column: string, stored: unknown, fresh: unknown): boolean {
  if (column === 'start_time') return sameInstant(stored as string | null | undefined, fresh as string | null | undefined);
  if (typeof fresh === 'number' || typeof stored === 'number') return sameNumber(stored as number | null | undefined, fresh as number | null | undefined);
  if (typeof fresh === 'boolean') return (stored ?? false) === fresh; // a null flag in an old row means false
  return (stored ?? null) === (fresh ?? null);
}

/**
 * What numeric(6,2) stores for a distance in km. PostgreSQL rounds the decimal value half away from zero, while Math.round on the
 * binary double can land the other way (8.575 * 100 is 857.4999999999999). toPrecision(12) first drops that float noise; the result
 * matches PostgreSQL for every distance from 1 to 60,020 m.
 */
function storedDistanceKm(km: number): number {
  return Math.round(Number((km * 100).toPrecision(12))) / 100;
}

/** The columns where Strava differs from the run, with Strava's values. Empty = nothing to write. */
function diffRun(existing: ExistingRun, activity: StravaActivityDetail): RunChanges {
  const changes: RunChanges = {};
  const date = activity.start_date_local.split('T')[0];
  const distanceKm = activity.distance / 1000;
  if (existing.date !== date) changes.date = date;
  // The column keeps two decimals: compare what it would store, or a run like 5.2345 km would differ forever. A tolerance
  // would hide real changes that land exactly one step away on a half-step boundary (8575 m -> 8585 m, stored 8.58 -> 8.59).
  if (!sameNumber(existing.distance, storedDistanceKm(distanceKm))) changes.distance = distanceKm;

  const fresh = extractExtendedFields(activity);
  const target = changes as Record<string, unknown>;
  const stored = existing as unknown as Record<string, unknown>;
  for (const column of Object.keys(fresh) as Array<keyof ExtendedFields>) {
    if (!sameColumn(column, stored[column], fresh[column])) target[column] = fresh[column];
  }
  return changes;
}

/** Step 2: the table in ADR 010 7.1, with the paused-user changes from 7.5.3. */
export function decideAction(input: DecideInput): ActionDecision {
  const { aspect_type, paused, response, existingRun, tokenRefreshed } = input;
  const attempts = Number.isFinite(input.attempts) && input.attempts > 0 ? Math.floor(input.attempts) : 0;

  // Normally stopped by decideBeforeFetch; kept so the table holds even if a caller skips step 1.
  if (paused && aspect_type === 'create') return none('ignored_paused');

  if (response.kind === 'network_error') return retry('network_error', attempts);

  const { status } = response;
  if (status === 429) return { action: 'wait', outcome: null, countsAsFailedAttempt: false, ...NO_EFFECTS };
  if (status === 401) {
    // The function cannot refresh a token. First 401: ask the handler to; the second means the connection is not usable.
    return tokenRefreshed
      ? retry('unauthorized', attempts)
      : { action: 'refresh_token', outcome: null, countsAsFailedAttempt: false, ...NO_EFFECTS };
  }
  if (status >= 500) return retry('server_error', attempts);

  // `remove` is produced only for a run whose source is 'strava' (ADR 010 decision 8). A manual run is never touched.
  const stravaRun = existingRun?.source === 'strava' ? existingRun : null;

  // After a failed attempt the run may already match Strava (or be gone) because that attempt wrote it and died before the
  // recalculation (ADR 010 decision 6). With no run to take a date from, only the handler can pick a fallback.
  const afterFailedAttempt = (...dates: Array<string | null>): Partial<Effects> => {
    if (attempts < 1) return {};
    const recalculateFrom = dates.reduce<string | null>(earliest, null);
    return recalculateFrom === null && existingRun === null ? { recalculateUnknown: true } : { recalculateFrom };
  };

  if (status === 404) {
    // Deleted, or private under activity:read: Strava does not tell the two apart (ADR 010 7.3).
    if (stravaRun) return { action: 'remove', outcome: 'deleted', ...NO_EFFECTS, recalculateFrom: stravaRun.date };
    return none('not_a_run', afterFailedAttempt());
  }
  if (status !== 200) return retry('unexpected_status', attempts);

  const activity = response.activity;
  if (!activity || typeof activity !== 'object') return retry('invalid_response', attempts);

  // An answer that names no sport at all (neither sport_type nor type) is malformed, not "not a running activity": treating it as a
  // non-run would delete a stored run or skip an import on a broken body. Older payloads carry `type` only, which is enough.
  // "Named" is the same test isRunningActivity uses, so the two can never disagree about which field to read.
  if (!isNamedSport(activity.sport_type) && !isNamedSport(activity.type)) return retry('invalid_response', attempts);

  // A run something will read: parsable date and distance. Anything else is a broken answer, not a reason to delete.
  const isPrivate = activity.private === true;
  const hasStartDate = typeof activity.start_date_local === 'string' && activity.start_date_local.length >= 10;
  const hasDistance = typeof activity.distance === 'number' && Number.isFinite(activity.distance);
  if (!isPrivate && isRunningActivity(activity) && (!hasStartDate || !hasDistance)) return retry('invalid_response', attempts);

  const activityDate = hasStartDate ? activity.start_date_local.split('T')[0] : null;
  const visibleRun = !isPrivate && isRunningActivity(activity) && hasDistance && exceedsImportDistance(activity);

  if (!visibleRun) {
    // Zero distance lands here on purpose: the import rule is that a Strava run needs distance > 0 (shared/rules.ts), so a
    // strava run whose activity now has none no longer qualifies and goes, like a type change, instead of lingering as a 0 km run.
    if (stravaRun) {
      return {
        action: 'remove',
        outcome: isPrivate ? 'removed_private' : 'removed_not_running',
        ...NO_EFFECTS,
        recalculateFrom: stravaRun.date,
      };
    }
    return none('not_a_run', afterFailedAttempt(existingRun?.date ?? null, activityDate));
  }

  // From here: Strava shows a visible running activity.
  if (aspect_type === 'delete') return none('ignored_not_confirmed');
  if (paused) return none('ignored_paused');

  if (!existingRun) {
    // Never fetched back from before the connection (the privacy text's promise). A run, just outside the window: noop, not not_a_run.
    if (activityDate !== null && isBeforeConnectionDay(activityDate, input.connectionDate)) return none('noop');
    return { action: 'insert', outcome: 'imported', ...NO_EFFECTS, recalculateFrom: activityDate };
  }
  if (!stravaRun) return none('noop'); // a manual run on the same id: leave it alone

  const changes = diffRun(stravaRun, activity);
  if (Object.keys(changes).length === 0) {
    return none('noop', afterFailedAttempt(stravaRun.date, activityDate));
  }
  return {
    action: 'update',
    outcome: 'updated',
    changes,
    ...NO_EFFECTS,
    recalculateFrom: earliest(stravaRun.date, activityDate),
    clearWeather: 'start_time' in changes || 'start_lat' in changes || 'start_lng' in changes,
  };
}
