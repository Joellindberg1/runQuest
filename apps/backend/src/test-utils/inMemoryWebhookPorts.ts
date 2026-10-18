/**
 * In-memory versions of the Strava webhook worker's ports (ADR 010 decision 17). Only for tests: server.ts never imports this
 * folder (test-utils isolation test in __tests__/fakeStrava.test.ts).
 *
 * The event store mirrors claim_strava_webhook_events from migration 046 step by step, so a behaviour test of the worker means
 * the same thing here as against the database. What is mirrored:
 *   step 1  claims run one at a time (the advisory lock): a second claim waits for the first, and sees its committed rows;
 *           a non-positive p_lease_seconds or p_max is rejected (errcode 22023) and changes nothing.
 *   step 2  a `processing` row whose lease has run out (or has none) goes back to `pending` with attempts + 1,
 *           claimed_at and lease_expires_at cleared and last_error = 'lease expired'. next_attempt_at is not touched.
 *   step 3  the owner whose oldest due pending row (next_attempt_at <= now, order event_time then id) is the oldest of all,
 *           among owners with no `processing` row; then up to p_max of that owner's due rows, oldest first, become `processing`
 *           with claimed_at = now and lease_expires_at = now + p_lease_seconds. The answer is in the same order.
 * The status writes mirror the adapter: they apply only to the same claim (status processing and the same claimed_at).
 * What it does not model: the database's own failure modes, and FOR UPDATE SKIP LOCKED (nothing else writes here).
 * The real SQL is checked with PGlite in the critic's run; these in-memory rules are checked in inMemoryWebhookPorts.test.ts.
 */
import type {
  Recompute,
  ReleaseWrite,
  RunStore,
  StravaApi,
  StravaConnection,
  WebhookEventRow,
  WebhookEventStore,
} from '../services/stravaWebhook/ports.js';
import type { ExistingRun, RunChanges } from '../services/stravaWebhook/decideAction.js';
import { assertUpdatableRunPatch } from '../services/stravaWebhook/runPatch.js';
import type { WebhookOutcome } from '../services/stravaWebhook/constants.js';

const iso = (at: Date): string => at.toISOString();

export interface InMemoryWebhookStore extends WebhookEventStore {
  /** Adds a row; unspecified fields get the defaults of a freshly received, due event. Returns a copy. */
  seed(partial?: Partial<WebhookEventRow>): WebhookEventRow;
  /** Copies of all rows, in insertion order. */
  rows(): WebhookEventRow[];
  row(id: number): WebhookEventRow;
  /** Every claim call, as (leaseSeconds, max). */
  claimCalls: Array<{ leaseSeconds: number; max: number }>;
  /** Set to make the next claims (all of them until cleared) fail, as when the database is down. */
  claimError: Error | null;
  /** Set to make every status write fail. */
  writeError: Error | null;
}

export function createInMemoryWebhookStore(options: { now: () => Date }): InMemoryWebhookStore {
  const table: WebhookEventRow[] = [];
  let nextId = 1;
  // Step 1: the advisory lock. Claims are chained, so they never overlap.
  let claimQueue: Promise<unknown> = Promise.resolve();

  const byOrder = (a: WebhookEventRow, b: WebhookEventRow): number => Date.parse(a.event_time) - Date.parse(b.event_time) || a.id - b.id;

  function claimNow(leaseSeconds: number, max: number): WebhookEventRow[] {
    if (!(leaseSeconds > 0) || !(max > 0)) throw Object.assign(new Error('p_lease_seconds and p_max must be positive integers'), { code: '22023' });
    const now = options.now();

    // Step 2
    for (const row of table) {
      if (row.status === 'processing' && (row.lease_expires_at === null || Date.parse(row.lease_expires_at) <= now.getTime())) {
        row.status = 'pending';
        row.attempts += 1;
        row.claimed_at = null;
        row.lease_expires_at = null;
        row.last_error = 'lease expired';
      }
    }

    // Step 3
    const isDue = (row: WebhookEventRow): boolean => row.status === 'pending' && Date.parse(row.next_attempt_at) <= now.getTime();
    const busyOwners = new Set(table.filter((row) => row.status === 'processing').map((row) => row.owner_id));
    const first = table.filter((row) => isDue(row) && !busyOwners.has(row.owner_id)).sort(byOrder)[0];
    if (!first) return [];

    const claimed = table.filter((row) => isDue(row) && row.owner_id === first.owner_id).sort(byOrder).slice(0, max);
    for (const row of claimed) {
      row.status = 'processing';
      row.claimed_at = iso(now);
      row.lease_expires_at = iso(new Date(now.getTime() + leaseSeconds * 1000));
    }
    return claimed.map((row) => ({ ...row }));
  }

  function write(claimedRow: WebhookEventRow, apply: (row: WebhookEventRow) => void): boolean {
    if (store.writeError) throw store.writeError;
    const row = table.find((candidate) => candidate.id === claimedRow.id);
    // The lease token: still processing AND the same claim (claimed_at), as the database adapter requires.
    if (!row || row.status !== 'processing' || row.claimed_at !== claimedRow.claimed_at) return false;
    apply(row);
    row.claimed_at = null;
    row.lease_expires_at = null;
    return true;
  }

  const store: InMemoryWebhookStore = {
    claimCalls: [],
    claimError: null,
    writeError: null,

    seed(partial = {}) {
      const id = partial.id ?? nextId++;
      nextId = Math.max(nextId, id + 1);
      const now = options.now();
      const row: WebhookEventRow = {
        id,
        dedupe_key: `strava:activity:${9000 + id}:create:${1_760_000_000 + id}:abc`,
        object_type: 'activity',
        object_id: 9000 + id,
        aspect_type: 'create',
        owner_id: 5001,
        subscription_id: 777,
        event_time: iso(new Date(now.getTime() - 60_000 + id)),
        updates: {},
        user_id: 'user-1',
        status: 'pending',
        outcome: null,
        attempts: 0,
        next_attempt_at: iso(new Date(now.getTime() - 1000)),
        claimed_at: null,
        lease_expires_at: null,
        last_error: null,
        received_at: iso(new Date(now.getTime() - 60_000)),
        processed_at: null,
        ...partial,
      };
      table.push(row);
      return { ...row };
    },
    rows: () => table.map((row) => ({ ...row })),
    row(id) {
      const row = table.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`no event ${id}`);
      return { ...row };
    },

    claim(leaseSeconds, max) {
      store.claimCalls.push({ leaseSeconds, max });
      const run = claimQueue.then(() => {
        if (store.claimError) throw store.claimError;
        return claimNow(leaseSeconds, max);
      });
      claimQueue = run.catch(() => undefined);
      return run;
    },

    async markDone(claimed, outcome: WebhookOutcome, processedAt) {
      return write(claimed, (row) => {
        row.status = 'done';
        row.outcome = outcome;
        row.processed_at = iso(processedAt);
      });
    },
    async markDead(claimed, lastError, processedAt) {
      return write(claimed, (row) => {
        row.status = 'dead';
        row.last_error = lastError;
        row.processed_at = iso(processedAt);
      });
    },
    async release(claimed, { attempts, nextAttemptAt, lastError }: ReleaseWrite) {
      return write(claimed, (row) => {
        row.status = 'pending';
        row.attempts = attempts;
        row.next_attempt_at = iso(nextAttemptAt);
        row.last_error = lastError;
      });
    },

    async purge({ doneBefore, deadBefore }) {
      const expired = (row: WebhookEventRow): 'done' | 'dead' | null => {
        if (row.processed_at === null) return null;
        const processed = Date.parse(row.processed_at);
        if (row.status === 'done' && processed < doneBefore.getTime()) return 'done';
        if (row.status === 'dead' && processed < deadBefore.getTime()) return 'dead';
        return null;
      };
      const counts = { done: 0, dead: 0 };
      for (let index = table.length - 1; index >= 0; index -= 1) {
        const kind = expired(table[index]);
        if (kind) {
          counts[kind] += 1;
          table.splice(index, 1);
        }
      }
      return counts;
    },
  };
  return store;
}

export interface InMemoryRecompute extends Recompute {
  /** The calls, in order. The weather and qualification calls carry the run ids only. */
  calls: Array<
    | { kind: 'reprocess'; userId: string; fromDate: string }
    | { kind: 'weather'; runIds: string[] }
    | { kind: 'totals'; userId: string }
    | { kind: 'qualify'; userId: string; runIds: string[] }
  >;
  reprocessError: Error | null;
  totalsError: Error | null;
  weatherError: Error | null;
  qualifyError: Error | null;
  /** qualifyEvents throws before it returns a promise. */
  qualifyThrowsSynchronously: boolean;
  /** qualifyEvents returns a promise that never settles (fire-and-forget must not wait for it). */
  qualifyNeverSettles: boolean;
}

export function createInMemoryRecompute(): InMemoryRecompute {
  const recompute: InMemoryRecompute = {
    calls: [],
    reprocessError: null,
    totalsError: null,
    weatherError: null,
    qualifyError: null,
    qualifyThrowsSynchronously: false,
    qualifyNeverSettles: false,
    async reprocessFrom(userId, fromDate) {
      recompute.calls.push({ kind: 'reprocess', userId, fromDate });
      if (recompute.reprocessError) throw recompute.reprocessError;
    },
    async recalculateTotals(userId) {
      recompute.calls.push({ kind: 'totals', userId });
      if (recompute.totalsError) throw recompute.totalsError;
      return true;
    },
    async fetchWeather(runs) {
      recompute.calls.push({ kind: 'weather', runIds: runs.map((run) => run.id) });
      if (recompute.weatherError) throw recompute.weatherError;
    },
    qualifyEvents(userId, runs) {
      recompute.calls.push({ kind: 'qualify', userId, runIds: runs.map((run) => run.id) });
      if (recompute.qualifyThrowsSynchronously) throw new Error('qualifyEvents threw at once');
      if (recompute.qualifyNeverSettles) return new Promise<void>(() => undefined);
      return recompute.qualifyError ? Promise.reject(recompute.qualifyError) : Promise.resolve();
    },
  };
  return recompute;
}

export interface InMemoryRunStore extends RunStore {
  /** Runs by user: date plus whatever else a test wants findRun to return. */
  runs: Array<{ userId: string; externalId: string; date: string; run?: ExistingRun }>;
  earliestError: Error | null;
  /**
   * strava_tokens by user. A user that is not listed is connected, not paused and without a connection date; `null` is "no row"
   * (disconnected).
   */
  connections: Record<string, StravaConnection | null>;
  /** Set to make getConnection fail, as when the database is down. */
  connectionError: Error | null;
  /** Set to make removeStravaRun fail, as when the database is down. */
  removeError: Error | null;
  /** Every removeStravaRun call, as (userId, externalId). */
  removeCalls: Array<{ userId: string; externalId: string }>;
  /** Set to make updateStravaRun fail, as when the database is down. */
  updateError: Error | null;
  /** Every updateStravaRun call that passed the column guard, as the handler made it (the weather clearing is only recorded here). */
  updateCalls: Array<{ userId: string; externalId: string; patch: RunChanges; clearWeather: boolean }>;
}

export function createInMemoryRunStore(): InMemoryRunStore {
  const runs: InMemoryRunStore['runs'] = [];
  const store: InMemoryRunStore = {
    runs,
    earliestError: null,
    connections: {},
    connectionError: null,
    removeError: null,
    removeCalls: [],
    updateError: null,
    updateCalls: [],
    async findRun(userId, externalId) {
      return runs.find((run) => run.userId === userId && run.externalId === externalId)?.run ?? null;
    },
    async earliestRunDate(userId) {
      if (store.earliestError) throw store.earliestError;
      const dates = runs.filter((run) => run.userId === userId).map((run) => run.date).sort();
      return dates[0] ?? null;
    },
    async getConnection(userId) {
      if (store.connectionError) throw store.connectionError;
      return userId in store.connections ? store.connections[userId] : { syncPaused: false, connectionDate: null };
    },
    async removeStravaRun(userId, externalId) {
      store.removeCalls.push({ userId, externalId });
      if (store.removeError) throw store.removeError;
      // Only a run known to be source 'strava' goes (as the adapter's query); an entry without a run description is not one.
      const index = runs.findIndex((run) => run.userId === userId && run.externalId === externalId && run.run?.source === 'strava');
      if (index === -1) return { removed: false, date: null };
      const [removed] = runs.splice(index, 1);
      return { removed: true, date: removed.date };
    },
    async updateStravaRun(userId, externalId, patch, options) {
      // The same column guard as the Supabase store: a patch with an XP column is refused whatever the caller meant.
      const values = assertUpdatableRunPatch(patch);
      if (Object.keys(values).length === 0) return { updated: false, previousDate: null };
      store.updateCalls.push({ userId, externalId, patch, clearWeather: options?.clearWeather === true });
      if (store.updateError) throw store.updateError;
      const entry = runs.find((run) => run.userId === userId && run.externalId === externalId && run.run?.source === 'strava');
      if (!entry) return { updated: false, previousDate: null };
      const previousDate = entry.date;
      Object.assign(entry.run as object, values);
      if (typeof values.date === 'string') entry.date = values.date;
      return { updated: true, previousDate };
    },
  };
  return store;
}

export interface UnusedStravaApi extends StravaApi {
  /** Names of the methods called. The worker itself must leave this empty. */
  calls: string[];
}

/** A StravaApi nobody should call: records the call and answers as an unconnected user / a dead network. */
export function createUnusedStravaApi(): UnusedStravaApi {
  const api: UnusedStravaApi = {
    calls: [],
    async getAccessToken() { api.calls.push('getAccessToken'); return { ok: false, reason: 'not_connected' }; },
    async fetchActivity() { api.calls.push('fetchActivity'); return { kind: 'network_error' }; },
    async fetchAthlete() { api.calls.push('fetchAthlete'); return { kind: 'network_error' }; },
    async refreshAccessToken() { api.calls.push('refreshAccessToken'); return { ok: false, reason: 'not_connected' }; },
  };
  return api;
}
