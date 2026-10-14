// The real ports of the Strava webhook worker (ports.ts): Supabase for the event queue and the runs, the central Strava client
// for the handlers' calls, the existing recalculation for the rest. Thin on purpose: every rule lives in
// services/stravaWebhookWorker.ts and is tested there against the in-memory ports; the coupling tests are in
// services/__tests__/stravaWebhookAdapters.test.ts.
//
// Errors from the database are rethrown with the PostgREST code only (the message can carry values from the row).
import { getSupabaseClient } from '../../config/database.js';
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { getValidAccessToken, stravaFetch } from '../stravaClient.js';
import { extractExtendedFields } from '../stravaImport.js';
import type { ExistingRun, StravaResponse } from './decideAction.js';
import type { Recompute, RunStore, StravaApi, WebhookEventRow, WebhookEventStore } from './ports.js';

const EVENTS = 'strava_webhook_events';
const STRAVA_API = 'https://www.strava.com/api/v3';

function databaseError(operation: string, error: { code?: string }): Error {
  const code = error.code ?? 'unknown';
  return Object.assign(new Error(`${operation} failed (${code})`), { code });
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
  };
}

export function createRecompute(): Recompute {
  return {
    reprocessFrom: (userId, fromDate) => reprocessRunsFromDate(userId, fromDate),
    recalculateTotals: async (userId) => {
      await calculateUserTotals(userId);
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
  } catch {
    return { kind: 'http', status: 200, activity: null };
  }
}

export function createStravaApi(): StravaApi {
  return {
    getAccessToken: getValidAccessToken,
    fetchActivity: (accessToken, activityId) => getJson(`${STRAVA_API}/activities/${activityId}`, accessToken, true),
    fetchAthlete: (accessToken) => getJson(`${STRAVA_API}/athlete`, accessToken, false),
  };
}
