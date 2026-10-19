// The real ports of the Strava webhook worker (ports.ts): Supabase for the event queue and the runs, the central Strava client
// for the handlers' calls, the existing recalculation for the rest. Thin on purpose: every rule lives in
// services/stravaWebhookWorker.ts and is tested there against the in-memory ports; the coupling tests are in
// services/__tests__/stravaWebhookAdapters.test.ts.
//
// Errors from the database are rethrown with the PostgREST code only (the message can carry values from the row).
import { getSupabaseClient } from '../../config/database.js';
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { errorCode, errorWithCode } from '../../utils/errorCode.js';
import { checkEventQualification } from '../eventService.js';
import { getValidAccessToken, refreshAccessToken, stravaFetch } from '../stravaClient.js';
import { extractExtendedFields } from '../stravaImport.js';
import { deleteStravaRuns } from '../stravaRemoval.js';
import { assertUpdatableRunPatch } from './runPatch.js';
import { WeatherService } from '../weatherService.js';
import type { ExistingRun, StravaResponse } from './decideAction.js';
import type { Recompute, RunStore, StravaApi, WebhookEventRow, WebhookEventStore } from './ports.js';

const EVENTS = 'strava_webhook_events';
const STRAVA_API = 'https://www.strava.com/api/v3';

/** supabase-js gives `code: ''` when the connection breaks, so the code comes from errorCode (the network cause), not from `error.code`. */
function databaseError(operation: string, error: unknown): Error {
  return errorWithCode(`${operation} failed (${errorCode(error)})`, error);
}

export function createWebhookEventStore(): WebhookEventStore {
  // A claimed row leaves the claim whatever the new status. `claimed_at` is the lease token: a claim sets it afresh, so a late write
  // from an old claim (the lease ran out and the row was claimed again, status processing once more) matches no row.
  async function writeClaimed(row: WebhookEventRow, operation: string, values: Record<string, unknown>): Promise<boolean> {
    const query = getSupabaseClient()
      .from(EVENTS)
      .update({ ...values, claimed_at: null, lease_expires_at: null })
      .eq('id', row.id)
      .eq('status', 'processing');
    const { data, error } = await (row.claimed_at === null ? query.is('claimed_at', null) : query.eq('claimed_at', row.claimed_at)).select('id');
    if (error) throw databaseError(operation, error);
    return Array.isArray(data) && data.length > 0;
  }

  async function deleteProcessedBefore(status: 'done' | 'dead', before: Date): Promise<number> {
    const { data, error } = await getSupabaseClient()
      .from(EVENTS)
      .delete()
      .eq('status', status)
      .lt('processed_at', before.toISOString())
      .select('id');
    if (error) throw databaseError('purge', error);
    return Array.isArray(data) ? data.length : 0;
  }

  return {
    async claim(leaseSeconds, max) {
      const { data, error } = await getSupabaseClient().rpc('claim_strava_webhook_events', { p_lease_seconds: leaseSeconds, p_max: max });
      if (error) throw databaseError('claim', error);
      return (data ?? []) as WebhookEventRow[];
    },
    markDone: (row, outcome, processedAt) => writeClaimed(row, 'markDone', { status: 'done', outcome, processed_at: processedAt.toISOString() }),
    markDead: (row, lastError, processedAt) => writeClaimed(row, 'markDead', { status: 'dead', last_error: lastError, processed_at: processedAt.toISOString() }),
    release: (row, { attempts, nextAttemptAt, lastError }) =>
      writeClaimed(row, 'release', { status: 'pending', attempts, next_attempt_at: nextAttemptAt.toISOString(), last_error: lastError }),
    async purge({ doneBefore, deadBefore }) {
      return { done: await deleteProcessedBefore('done', doneBefore), dead: await deleteProcessedBefore('dead', deadBefore) };
    },
  };
}

// Every column the decision function compares (ExistingRun): source, date, distance and each extended column. The list follows
// extractExtendedFields, so a new extended column is selected without an edit here.
const EXISTING_RUN_COLUMNS = ['source', 'date', 'distance', ...Object.keys(extractExtendedFields({}))].join(',');

export function createRunStore(): RunStore {
  return {
    async findRun(userId, externalId) {
      // No `source` filter: a manual run on the same id must be seen too (decideAction leaves it alone).
      const { data, error } = await getSupabaseClient()
        .from('runs')
        .select(EXISTING_RUN_COLUMNS)
        .eq('user_id', userId)
        .eq('external_id', externalId)
        .maybeSingle();
      if (error) throw databaseError('findRun', error);
      return (data as ExistingRun | null) ?? null;
    },
    async earliestRunDate(userId) {
      const { data, error } = await getSupabaseClient()
        .from('runs')
        .select('date')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .limit(1);
      if (error) throw databaseError('earliestRunDate', error);
      return (data as Array<{ date: string }> | null)?.[0]?.date ?? null;
    },
    async getConnection(userId) {
      // Never the token columns: a handler needs the pause flag and the day, nothing it could log by mistake.
      const { data, error } = await getSupabaseClient()
        .from('strava_tokens')
        .select('sync_paused, connection_date')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw databaseError('getConnection', error);
      if (!data) return null;
      const row = data as { sync_paused?: boolean | null; connection_date?: string | null };
      return { syncPaused: row.sync_paused === true, connectionDate: row.connection_date ?? null };
    },
    async removeStravaRun(userId, externalId) {
      // The shared deletion path (stravaRemoval.ts): one query for the worker, the disconnect and every later caller.
      const dates = await deleteStravaRuns(userId, { externalId });
      return { removed: dates.length > 0, date: dates[0] ?? null };
    },
    async updateStravaRun(userId, externalId, patch, options) {
      // The guard comes first: a forbidden column (XP, streak, identity) refuses the whole patch before any query is made.
      const values = assertUpdatableRunPatch(patch);
      if (Object.keys(values).length === 0) return { updated: false, previousDate: null };

      const supabase = getSupabaseClient();
      const { data: found, error: findError } = await supabase
        .from('runs')
        .select('id, date')
        .eq('user_id', userId)
        .eq('external_id', externalId)
        .eq('source', 'strava')
        .maybeSingle();
      if (findError) throw databaseError('updateStravaRun', findError);
      if (!found) return { updated: false, previousDate: null };
      const run = found as { id: string; date: string };

      if (options?.clearWeather) {
        const { error } = await supabase.from('run_weather').delete().eq('run_id', run.id);
        if (error) throw databaseError('clearWeather', error);
      }
      const { data: written, error } = await supabase
        .from('runs')
        .update(values)
        .eq('id', run.id)
        .eq('source', 'strava')
        .select('id');
      if (error) throw databaseError('updateStravaRun', error);
      return { updated: Array.isArray(written) && written.length > 0, previousDate: run.date };
    },
  };
}

export function createRecompute(): Recompute {
  return {
    reprocessFrom: (userId, fromDate) => reprocessRunsFromDate(userId, fromDate),
    recalculateTotals: (userId) => calculateUserTotals(userId),
    fetchWeather: (runs) => WeatherService.fetchAndSaveWeatherForRuns(runs),
    async qualifyEvents(userId, runs) {
      // The polling's arguments (routes/strava.ts): the runs are independent, so one failing does not stop the others.
      const results = await Promise.allSettled(
        runs.map((run) =>
          checkEventQualification({ userId, runId: run.id, runDate: run.date, distanceKm: run.distance_km, isTreadmill: run.is_treadmill }),
        ),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error(`❌ Strava webhook: checkEventQualification failed for user ${userId} (${errorCode(result.reason)})`);
        }
      }
    },
  };
}

/** Status and, on 200, the JSON body (null if it is not JSON). The body of any other answer is dropped unread. */
async function getJson(url: string, accessToken: string, readBody: boolean): Promise<StravaResponse> {
  let response: Response;
  try {
    response = await stravaFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    return { kind: 'network_error' };
  }
  if (!readBody || response.status !== 200) {
    void response.body?.cancel().catch(() => undefined);
    return { kind: 'http', status: response.status };
  }
  try {
    return { kind: 'http', status: 200, activity: await response.json() };
  } catch (error) {
    // Only a body that arrived and is not JSON is an answer without an activity. A body that never finished (the timeout of stravaFetch,
    // a connection cut off) is no answer at all, and the handler retries it under the right reason.
    if (error instanceof SyntaxError) return { kind: 'http', status: 200, activity: null };
    return { kind: 'network_error' };
  }
}

export function createStravaApi(): StravaApi {
  return {
    getAccessToken: getValidAccessToken,
    refreshAccessToken,
    fetchActivity: (accessToken, activityId) => getJson(`${STRAVA_API}/activities/${activityId}`, accessToken, true),
    fetchAthlete: (accessToken) => getJson(`${STRAVA_API}/athlete`, accessToken, false),
  };
}
