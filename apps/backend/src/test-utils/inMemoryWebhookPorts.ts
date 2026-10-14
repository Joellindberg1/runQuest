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
 * What it does not model: the database's own failure modes, and FOR UPDATE SKIP LOCKED (nothing else writes here).
 * The real SQL is checked with PGlite in the critic's run; these in-memory rules are checked in inMemoryWebhookPorts.test.ts.
 */
import type {
  Recompute,
  ReleaseWrite,
  RunStore,
  StravaApi,
  WebhookEventRow,
  WebhookEventStore,
} from '../services/stravaWebhook/ports.js';
import type { ExistingRun } from '../services/stravaWebhook/decideAction.js';
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

  function write(id: number, apply: (row: WebhookEventRow) => void): boolean {
    if (store.writeError) throw store.writeError;
    const row = table.find((candidate) => candidate.id === id);
    if (!row || row.status !== 'processing') return false;
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

    async markDone(id, outcome: WebhookOutcome, processedAt) {
      return write(id, (row) => {
        row.status = 'done';
        row.outcome = outcome;
        row.processed_at = iso(processedAt);
      });
    },
    async markDead(id, lastError, processedAt) {
      return write(id, (row) => {
        row.status = 'dead';
        row.last_error = lastError;
        row.processed_at = iso(processedAt);
      });
    },
    async release(id, { attempts, nextAttemptAt, lastError }: ReleaseWrite) {
      return write(id, (row) => {
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
  /** The calls, in order. */
  calls: Array<{ kind: 'reprocess'; userId: string; fromDate: string } | { kind: 'totals'; userId: string }>;
  reprocessError: Error | null;
  totalsError: Error | null;
}

export function createInMemoryRecompute(): InMemoryRecompute {
  const recompute: InMemoryRecompute = {
    calls: [],
    reprocessError: null,
    totalsError: null,
    async reprocessFrom(userId, fromDate) {
      recompute.calls.push({ kind: 'reprocess', userId, fromDate });
      if (recompute.reprocessError) throw recompute.reprocessError;
    },
    async recalculateTotals(userId) {
      recompute.calls.push({ kind: 'totals', userId });
      if (recompute.totalsError) throw recompute.totalsError;
    },
  };
  return recompute;
}

export interface InMemoryRunStore extends RunStore {
  /** Runs by user: date plus whatever else a test wants findRun to return. */
  runs: Array<{ userId: string; externalId: string; date: string; run?: ExistingRun }>;
  earliestError: Error | null;
}

export function createInMemoryRunStore(): InMemoryRunStore {
  const runs: InMemoryRunStore['runs'] = [];
  const store: InMemoryRunStore = {
    runs,
    earliestError: null,
    async findRun(userId, externalId) {
      return runs.find((run) => run.userId === userId && run.externalId === externalId)?.run ?? null;
    },
    async earliestRunDate(userId) {
      if (store.earliestError) throw store.earliestError;
      const dates = runs.filter((run) => run.userId === userId).map((run) => run.date).sort();
      return dates[0] ?? null;
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
  };
  return api;
}
