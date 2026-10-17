/**
 * The Strava webhook worker (ADR 010 decisions 6, 9 and 11), as behaviour over the in-memory ports: claim and lease, one batch
 * per owner, retry and backoff, the rate-limit wait, the 48 h alarm, retention, and the handler contract the later stories plug into.
 * No Supabase and no network: the store mirrors the claim RPC of migration 046 (see test-utils/inMemoryWebhookPorts.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MS_DAY, WEBHOOK_RETENTION_DONE_DAYS, WEBHOOK_RETENTION_FAILED_DAYS } from '@runquest/shared';

vi.mock('../stravaAthlete.js', () => ({ findUserByAthleteId: vi.fn(), isValidAthleteId: vi.fn() }));

import { findUserByAthleteId } from '../stravaAthlete.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import { logger } from '../../utils/logger.js';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';
import {
  LEASE_SECONDS,
  WEBHOOK_CLAIM_BATCH,
  WEBHOOK_DEAD_AFTER_HOURS,
  type WebhookOutcome,
} from '../stravaWebhook/constants.js';
import type { RateBudget, WebhookEventRow, WebhookImportedRun } from '../stravaWebhook/ports.js';
import {
  createStravaWebhookWorker,
  resultForTokenFailure,
  webhookHandlerKey,
  type HandlerRegistry,
  type WebhookHandler,
  type WebhookHandlerContext,
  type WebhookHandlerResult,
} from '../stravaWebhookWorker.js';
import {
  createInMemoryRecompute,
  createInMemoryRunStore,
  createInMemoryWebhookStore,
  createUnusedStravaApi,
  type InMemoryWebhookStore,
} from '../../test-utils/inMemoryWebhookPorts.js';

const START = new Date('2026-10-14T12:07:00.000Z');
const MINUTE = 60_000;
const HOUR = 3_600_000;
let clock = START;
const now = () => clock;

const done = (outcome: WebhookOutcome, recalculateFrom: string | null = null, extra: { recalculateUnknown?: boolean } = {}): WebhookHandlerResult => ({
  status: 'done',
  outcome,
  recalculateFrom,
  ...extra,
});
const changed = (from: string): WebhookHandlerResult => done('updated', from);
const failure = (error = 'server_error'): WebhookHandlerResult => ({ status: 'retry', error });

/** One handler for every key the tests use. */
const everyKey = (handler: WebhookHandler): HandlerRegistry => ({
  [webhookHandlerKey('activity', 'create')]: handler,
  [webhookHandlerKey('activity', 'update')]: handler,
  [webhookHandlerKey('activity', 'delete')]: handler,
  [webhookHandlerKey('athlete', 'update')]: handler,
});

function setup(handlers: HandlerRegistry | WebhookHandler, extra: { budget?: RateBudget } = {}) {
  const store = createInMemoryWebhookStore({ now });
  const runs = createInMemoryRunStore();
  const recompute = createInMemoryRecompute();
  const strava = createUnusedStravaApi();
  const registry = typeof handlers === 'function' ? everyKey(handlers) : handlers;
  const make = () => createStravaWebhookWorker({ store, strava, runs, recompute, handlers: registry, now, budget: extra.budget });
  return { store, runs, recompute, strava, worker: make(), make };
}

function claimSizes(store: InMemoryWebhookStore): number[] {
  const sizes: number[] = [];
  const claim = store.claim.bind(store);
  store.claim = async (leaseSeconds, max) => {
    const rows = await claim(leaseSeconds, max);
    sizes.push(rows.length);
    return rows;
  };
  return sizes;
}

function captureLogs() {
  const lines: Array<{ level: string; text: string }> = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push({ level, text: args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' ') });
    });
  }
  return {
    lines,
    at: (level: string) => lines.filter((line) => line.level === level).map((line) => line.text),
    all: () => lines.map((line) => line.text).join('\n'),
  };
}

beforeEach(() => {
  clock = START;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('claim and batch', () => {
  it('worker claims at most 25 due events for one owner per claim', async () => {
    const { store, worker } = setup(async () => done('noop'));
    for (let i = 0; i < 30; i += 1) store.seed();
    const sizes = claimSizes(store);

    await worker.drain();

    expect(store.claimCalls[0]).toEqual({ leaseSeconds: LEASE_SECONDS, max: WEBHOOK_CLAIM_BATCH });
    expect(LEASE_SECONDS).toBe(300);
    expect(WEBHOOK_CLAIM_BATCH).toBe(25);
    expect(sizes).toEqual([25, 5, 0]);
  });

  it("worker processes one owner's claimed events in a single batch", async () => {
    const seen: number[] = [];
    const { store, worker, recompute } = setup(async (ctx) => {
      seen.push(ctx.event.id);
      return changed('2026-10-10');
    });
    store.seed();
    store.seed();
    store.seed();
    const sizes = claimSizes(store);

    await worker.drain();

    expect(sizes).toEqual([3, 0]);
    expect(seen).toEqual([1, 2, 3]);
    expect(recompute.calls).toHaveLength(2);
  });

  it('worker claims each pending event exactly once under two concurrent workers', async () => {
    const handled: number[] = [];
    const { store, make } = setup(async (ctx) => {
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      handled.push(ctx.event.id);
      return done('noop');
    });
    for (let i = 0; i < 6; i += 1) store.seed({ owner_id: 5001, user_id: 'user-1' });
    for (let i = 0; i < 6; i += 1) store.seed({ owner_id: 5002, user_id: 'user-2' });

    await Promise.all([make().drain(), make().drain()]);

    expect(handled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(store.rows().every((row) => row.status === 'done')).toBe(true);
  });

  it('worker does not claim events for an owner that already has a live lease', async () => {
    const handled: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      handled.push(ctx.event.id);
      return done('noop');
    });
    const live = new Date(START.getTime() + 2 * MINUTE).toISOString();
    store.seed({ owner_id: 5001, status: 'processing', claimed_at: START.toISOString(), lease_expires_at: live });
    const waiting = store.seed({ owner_id: 5001 });
    const other = store.seed({ owner_id: 5002, user_id: 'user-2' });

    await worker.drain();

    expect(handled).toEqual([other.id]);
    expect(store.row(waiting.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('worker reclaims an expired lease as a failed attempt', async () => {
    const attemptsSeen: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      attemptsSeen.push(ctx.attempts);
      return done('noop');
    });
    const crashed = store.seed({
      status: 'processing',
      claimed_at: new Date(START.getTime() - 6 * MINUTE).toISOString(),
      lease_expires_at: new Date(START.getTime() - MINUTE).toISOString(),
    });

    await worker.drain();

    expect(attemptsSeen).toEqual([1]);
    expect(store.row(crashed.id)).toMatchObject({ status: 'done', attempts: 1, last_error: 'lease expired' });
  });

  it("worker handles an owner's events oldest first", async () => {
    const order: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      order.push(ctx.event.id);
      return done('noop');
    });
    const at = (minutesAgo: number) => new Date(START.getTime() - minutesAgo * MINUTE).toISOString();
    store.seed({ id: 1, event_time: at(1) });
    store.seed({ id: 2, event_time: at(30) });
    store.seed({ id: 3, event_time: at(10) });

    await worker.drain();

    expect(order).toEqual([2, 3, 1]);
  });

  it('worker uses the user id stored on the event and not a new athlete lookup', async () => {
    const users: string[] = [];
    const { store, worker } = setup(async (ctx) => {
      users.push(ctx.userId);
      return done('noop');
    });
    store.seed({ user_id: 'user-from-receipt', owner_id: 424242 });

    await worker.drain();

    expect(users).toEqual(['user-from-receipt']);
    expect(findUserByAthleteId).not.toHaveBeenCalled();
  });

  it('a batch of events for one user triggers one reprocess and one calculateUserTotals', async () => {
    const dates = ['2026-10-10', '2026-10-08', '2026-10-12'];
    const { store, worker, recompute } = setup(async (ctx) => changed(dates[ctx.event.id - 1]));
    store.seed();
    store.seed();
    store.seed();

    await worker.drain();

    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-10-08' },
      { kind: 'totals', userId: 'user-1' },
    ]);
    expect(store.rows().map((row) => row.status)).toEqual(['done', 'done', 'done']);
  });

  it('a burst of more than 25 events for one user is processed in several batches', async () => {
    const { store, worker, recompute } = setup(async () => changed('2026-10-10'));
    for (let i = 0; i < 60; i += 1) store.seed();
    const sizes = claimSizes(store);

    await worker.drain();

    expect(sizes).toEqual([25, 25, 10, 0]);
    expect(store.rows().every((row) => row.status === 'done')).toBe(true);
    expect(recompute.calls.filter((call) => call.kind === 'reprocess')).toHaveLength(3);
    expect(recompute.calls.filter((call) => call.kind === 'totals')).toHaveLength(3);
  });

  it('a stuck event does not block the other events in the batch', async () => {
    const { store, worker, recompute } = setup(async (ctx) => (ctx.event.id === 2 ? failure('server_error') : changed('2026-10-10')));
    store.seed();
    const stuck = store.seed();
    store.seed();

    await worker.drain();

    expect(store.row(1).status).toBe('done');
    expect(store.row(3).status).toBe('done');
    expect(store.row(stuck.id)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'server_error' });
    expect(recompute.calls.filter((call) => call.kind === 'reprocess')).toHaveLength(1);
  });

  it("worker runs a user's batch inside the user lock", async () => {
    const handled: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      handled.push(ctx.event.id);
      return done('noop');
    });
    store.seed({ user_id: 'user-1' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = withUserLock('user-1', () => gate);

    const draining = worker.drain();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handled).toEqual([]);

    release();
    await holder;
    await draining;
    expect(handled).toEqual([1]);
  });
});

describe('retry and rate-limit waits', () => {
  it.each([[0, 1], [1, 5], [2, 15], [3, 60], [4, 60], [7, 60]] as const)(
    'retry schedules next_attempt_at by the backoff 1, 5, 15, 60 minutes and then hourly (attempts before: %i -> %i min)',
    async (attemptsBefore, minutes) => {
      const { store, worker } = setup(async () => failure('network_error'));
      const event = store.seed({ attempts: attemptsBefore });

      await worker.drain();

      expect(store.row(event.id)).toMatchObject({
        status: 'pending',
        attempts: attemptsBefore + 1,
        next_attempt_at: new Date(START.getTime() + minutes * MINUTE).toISOString(),
        last_error: 'network_error',
        claimed_at: null,
        lease_expires_at: null,
      });
    },
  );

  it('rate limit wait postpones to the next quarter hour plus 30 seconds without increasing attempts', async () => {
    const { store, worker } = setup(async () => ({ status: 'wait', kind: 'rate_limit' }));
    const event = store.seed({ attempts: 2 });

    await worker.drain();

    expect(store.row(event.id)).toMatchObject({ status: 'pending', attempts: 2, next_attempt_at: '2026-10-14T12:15:30.000Z' });
  });

  it('a wait on the quarter hour itself goes to the following quarter', async () => {
    clock = new Date('2026-10-14T12:15:00.000Z');
    const { store, worker } = setup(async () => ({ status: 'wait', kind: 'rate_limit' }));
    const event = store.seed();

    await worker.drain();

    expect(store.row(event.id).next_attempt_at).toBe('2026-10-14T12:30:30.000Z');
  });

  it('daily limit wait postpones to the next UTC midnight plus 1 minute without increasing attempts', async () => {
    const { store, worker } = setup(async () => ({ status: 'wait', kind: 'daily_limit' }));
    const event = store.seed({ attempts: 1 });

    await worker.drain();

    expect(store.row(event.id)).toMatchObject({ status: 'pending', attempts: 1, next_attempt_at: '2026-10-15T00:01:00.000Z' });
    expect(Date.parse('2026-10-15T00:00:00.000Z') - Date.parse('2026-10-14T00:00:00.000Z')).toBe(MS_DAY);
  });

  it('a batch that hits the rate limit leaves no row processing, keeps attempts and stops calling Strava', async () => {
    const called: number[] = [];
    const { store, worker, recompute } = setup(async (ctx) => {
      called.push(ctx.event.id);
      if (ctx.event.id === 2) return { status: 'wait', kind: 'rate_limit' };
      return changed('2026-10-10');
    });
    store.seed();
    store.seed({ attempts: 1 });
    store.seed({ attempts: 3 });
    store.seed({ owner_id: 5001, user_id: 'user-1' });

    await worker.drain();

    expect(called).toEqual([1, 2]);
    expect(store.row(1).status).toBe('done');
    for (const id of [2, 3, 4]) {
      expect(store.row(id)).toMatchObject({ status: 'pending', next_attempt_at: '2026-10-14T12:15:30.000Z', claimed_at: null, lease_expires_at: null });
    }
    expect(store.row(2).attempts).toBe(1);
    expect(store.row(3).attempts).toBe(3);
    expect(store.row(4).attempts).toBe(0);
    expect(store.rows().some((row) => row.status === 'processing')).toBe(false);
    // The event that finished before the wait is still recalculated.
    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-10-10' },
      { kind: 'totals', userId: 'user-1' },
    ]);
  });

  it("a wait in one user's batch releases the rows of every user in the claim and never calls the next user's handler", async () => {
    const called: string[] = [];
    const { store, worker, recompute } = setup(async (ctx) => {
      called.push(ctx.userId);
      return ctx.userId === 'user-1' ? { status: 'wait', kind: 'rate_limit' } : changed('2026-10-10');
    });
    store.seed({ user_id: 'user-1', attempts: 1 });
    store.seed({ user_id: 'user-2', attempts: 2 });
    store.seed({ user_id: 'user-1', attempts: 0 });

    await worker.drain();

    expect(called).toEqual(['user-1']);
    expect(store.rows().map((row) => ({ status: row.status, attempts: row.attempts, next: row.next_attempt_at }))).toEqual([
      { status: 'pending', attempts: 1, next: '2026-10-14T12:15:30.000Z' },
      { status: 'pending', attempts: 2, next: '2026-10-14T12:15:30.000Z' },
      { status: 'pending', attempts: 0, next: '2026-10-14T12:15:30.000Z' },
    ]);
    expect(recompute.calls).toEqual([]);
  });

  it('the wait releases the lease before any later time passes: after the batch a second claim finds nothing due', async () => {
    const { store, worker } = setup(async () => ({ status: 'wait', kind: 'rate_limit' }));
    store.seed();
    const sizes = claimSizes(store);

    await worker.drain();
    clock = new Date(START.getTime() + (LEASE_SECONDS + 1) * 1000); // past the lease of a row that had been left processing, before the wait ends
    await worker.drain();

    expect(sizes).toEqual([1, 0, 0]);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('worker postpones the batch to the budget resume time when the soft limit is reached', async () => {
    const budget: RateBudget = { isOverSoftLimit: () => true, nextResumeAt: () => new Date('2026-10-14T12:15:30.000Z') };
    const called: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      called.push(ctx.event.id);
      return done('noop');
    }, { budget });
    store.seed({ attempts: 2 });
    store.seed();

    await worker.drain();

    expect(called).toEqual([]);
    expect(store.rows().map((row) => ({ status: row.status, attempts: row.attempts, next: row.next_attempt_at }))).toEqual([
      { status: 'pending', attempts: 2, next: '2026-10-14T12:15:30.000Z' },
      { status: 'pending', attempts: 0, next: '2026-10-14T12:15:30.000Z' },
    ]);
  });

  it('a resume time in the past never makes the loop spin on the same rows', async () => {
    const budget: RateBudget = { isOverSoftLimit: () => true, nextResumeAt: () => new Date(START.getTime() - HOUR) };
    const { store, worker } = setup(async () => done('noop'), { budget });
    store.seed();
    const sizes = claimSizes(store);

    await worker.drain();

    expect(sizes).toEqual([1, 0]);
    expect(Date.parse(store.row(1).next_attempt_at)).toBeGreaterThan(START.getTime());
  });
});

describe('recalculation', () => {
  it('a retry with attempts above zero recomputes even when the run already matches Strava', async () => {
    const { store, worker, recompute } = setup(async () => done('noop', '2026-10-09'));
    store.seed({ attempts: 1 });

    await worker.drain();

    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-10-09' },
      { kind: 'totals', userId: 'user-1' },
    ]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
  });

  it('a retry whose handler gives no date still recomputes, from the earliest run', async () => {
    const { store, worker, recompute, runs } = setup(async () => done('noop'));
    runs.runs.push({ userId: 'user-1', externalId: 'a', date: '2026-09-20' }, { userId: 'user-1', externalId: 'b', date: '2026-10-01' });
    store.seed({ attempts: 2 });

    await worker.drain();

    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-09-20' },
      { kind: 'totals', userId: 'user-1' },
    ]);
  });

  it('recalculateUnknown without a date recomputes from the earliest run of the user', async () => {
    const { store, worker, recompute, runs } = setup(async () => done('not_a_run', null, { recalculateUnknown: true }));
    runs.runs.push({ userId: 'user-1', externalId: 'a', date: '2026-08-02' }, { userId: 'user-2', externalId: 'z', date: '2026-01-01' });
    store.seed({ attempts: 1 });
    store.seed({ attempts: 1 });

    await worker.drain();

    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-08-02' },
      { kind: 'totals', userId: 'user-1' },
    ]);
  });

  it('recalculateUnknown wins over a later known date in the same batch', async () => {
    const { store, worker, recompute, runs } = setup(async (ctx) =>
      ctx.event.id === 1 ? changed('2026-10-10') : done('not_a_run', null, { recalculateUnknown: true }),
    );
    runs.runs.push({ userId: 'user-1', externalId: 'a', date: '2026-07-04' });
    store.seed();
    store.seed({ attempts: 1 });

    await worker.drain();

    expect(recompute.calls[0]).toEqual({ kind: 'reprocess', userId: 'user-1', fromDate: '2026-07-04' });
  });

  it('recalculateUnknown for a user without runs recalculates the totals only', async () => {
    const { store, worker, recompute } = setup(async () => done('deleted', null, { recalculateUnknown: true }));
    store.seed({ attempts: 1 });

    await worker.drain();

    expect(recompute.calls).toEqual([{ kind: 'totals', userId: 'user-1' }]);
    expect(store.row(1).status).toBe('done');
  });

  it('a retry after exactly one failed attempt without a date recomputes from the earliest run', async () => {
    const { store, worker, recompute, runs } = setup(async () => done('noop', null));
    runs.runs.push({ userId: 'user-1', externalId: 'a', date: '2026-05-05' });
    store.seed({ attempts: 1 });

    await worker.drain();

    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-05-05' },
      { kind: 'totals', userId: 'user-1' },
    ]);
  });

  it('a first try that is a noop without a date recomputes nothing', async () => {
    const { store, worker, recompute } = setup(async () => done('noop', null));
    store.seed({ attempts: 0 });

    await worker.drain();

    expect(recompute.calls).toEqual([]);
  });

  it('an impossible calendar date such as 2026-02-31 is treated as unknown', async () => {
    const { store, worker, recompute, runs } = setup(async () => done('updated', '2026-02-31'));
    runs.runs.push({ userId: 'user-1', externalId: 'a', date: '2026-03-01' });
    store.seed();

    await worker.drain();

    expect(recompute.calls[0]).toEqual({ kind: 'reprocess', userId: 'user-1', fromDate: '2026-03-01' });
  });

  it('a date that is not a calendar day is treated as unknown instead of reaching the reprocess', async () => {
    const { store, worker, recompute, runs } = setup(async () => done('updated', 'yesterday'));
    runs.runs.push({ userId: 'user-1', externalId: 'a', date: '2026-06-01' });
    store.seed();

    await worker.drain();

    expect(recompute.calls[0]).toEqual({ kind: 'reprocess', userId: 'user-1', fromDate: '2026-06-01' });
  });

  it('noop and ignored_paused events trigger no recompute', async () => {
    const outcomes: WebhookOutcome[] = ['noop', 'ignored_paused', 'not_a_run', 'ignored_not_confirmed'];
    const { store, worker, recompute } = setup(async (ctx) => done(outcomes[ctx.event.id - 1]));
    for (let i = 0; i < outcomes.length; i += 1) store.seed();

    await worker.drain();

    expect(recompute.calls).toEqual([]);
    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual(outcomes.map((outcome) => ['done', outcome]));
  });

  it('events that need the recompute are retried when it fails, the others still finish', async () => {
    const { store, worker, recompute } = setup(async (ctx) => (ctx.event.id === 3 ? done('noop') : changed('2026-10-10')));
    recompute.reprocessError = new Error('boom with a secret');
    store.seed();
    store.seed();
    store.seed();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'recompute_failed' });
    expect(store.row(2)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'recompute_failed' });
    expect(store.row(3).status).toBe('done');
    expect(recompute.calls.some((call) => call.kind === 'totals')).toBe(false);
  });

  it('a failing earliest-run lookup is a failed recompute: the event is retried, not done', async () => {
    const { store, worker, runs } = setup(async () => done('noop', null, { recalculateUnknown: true }));
    runs.earliestError = new Error('db down');
    store.seed({ attempts: 1 });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 2, last_error: 'recompute_failed' });
  });
});

describe('48 hours, removed users and unknown types', () => {
  const overdue = () => new Date(START.getTime() - WEBHOOK_DEAD_AFTER_HOURS * HOUR - 1000).toISOString();

  it('an event older than 48 hours counted from received_at becomes dead and logs exactly one critical error', async () => {
    const logs = captureLogs();
    const called: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      called.push(ctx.event.id);
      return done('noop');
    });
    const old = store.seed({ received_at: overdue(), attempts: 7, last_error: 'server_error' });

    await worker.drain();
    await worker.drain();

    expect(called).toEqual([]);
    expect(store.row(old.id)).toMatchObject({ status: 'dead', claimed_at: null, lease_expires_at: null });
    const critical = logs.at('error').filter((line) => line.includes('🚨 KRITISKT: Strava-webhook'));
    expect(critical).toHaveLength(1);
    expect(logs.at('error')).toHaveLength(1);
    expect(critical[0]).toContain('activity');
    expect(critical[0]).toContain(`object_id=${old.object_id}`);
    expect(critical[0]).toContain(`owner_id=${old.owner_id}`);
    expect(critical[0]).toContain('attempts=7');
  });

  it('an old event for a removed user ends as ignored_unknown_owner without a deletion alarm', async () => {
    const logs = captureLogs();
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ user_id: null, received_at: overdue(), aspect_type: 'delete' });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_unknown_owner' });
    expect(logs.at('error')).toEqual([]);
  });

  it('an event exactly 48 hours old is still processed', async () => {
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: new Date(START.getTime() - WEBHOOK_DEAD_AFTER_HOURS * HOUR).toISOString() });

    await worker.drain();

    expect(store.row(1).status).toBe('done');
  });

  it.each([
    ['activity', 'delete'],
    ['athlete', 'update'],
  ] as const)('a dead %s %s event says that the deletion was not completed within Strava\'s deadline', async (objectType, aspectType) => {
    const logs = captureLogs();
    const { store, worker } = setup(async () => done('noop'));
    const old = store.seed({ received_at: overdue(), object_type: objectType, aspect_type: aspectType, object_id: 31337, owner_id: 5001 });

    await worker.drain();

    const [line] = logs.at('error');
    expect(line).toContain('🚨 KRITISKT: Strava-webhook');
    expect(line).toMatch(/deletion/i);
    expect(line).toContain("Strava's");
    expect(line).toContain('48 h');
    expect(line).toContain('object_id=31337');
    expect(line).toContain('owner_id=5001');
    expect(store.row(old.id).status).toBe('dead');
  });

  it('a dead event does not alarm when its status could not be written', async () => {
    const logs = captureLogs();
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: overdue() });
    store.writeError = new Error('db down');

    await worker.drain();

    expect(logs.at('error').filter((line) => line.includes('🚨 KRITISKT'))).toHaveLength(0);
    expect(store.row(1).status).toBe('processing'); // the lease runs out and the next claim handles it again
  });

  it('a rate-limited event that turns 48 hours old becomes dead instead of waiting again', async () => {
    const { store, worker } = setup(async () => ({ status: 'wait', kind: 'rate_limit' }));
    store.seed({ received_at: new Date(START.getTime() - WEBHOOK_DEAD_AFTER_HOURS * HOUR + 5 * MINUTE).toISOString() });
    await worker.drain();
    expect(store.row(1).status).toBe('pending');

    clock = new Date(START.getTime() + 10 * MINUTE);
    await worker.drain();

    expect(store.row(1).status).toBe('dead');
  });

  it('an event for a removed user finishes as ignored_unknown_owner without retry', async () => {
    const called: number[] = [];
    const { store, worker, recompute } = setup(async (ctx) => {
      called.push(ctx.event.id);
      return done('noop');
    });
    store.seed({ user_id: null, attempts: 2 });

    await worker.drain();

    expect(called).toEqual([]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_unknown_owner', attempts: 2 });
    expect(recompute.calls).toEqual([]);
  });

  it('worker marks unknown event types done with a warning', async () => {
    const logs = captureLogs();
    const { store, worker, recompute } = setup({ [webhookHandlerKey('activity', 'create')]: async () => done('noop') });
    store.seed({ aspect_type: 'update' }); // a known type that has no handler yet
    store.seed({ object_type: 'segment' as unknown as WebhookEventRow['object_type'] }); // a type nobody has heard of

    await worker.drain();

    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([['done', 'noop'], ['done', 'noop']]);
    expect(logs.at('warn')).toHaveLength(2);
    expect(logs.at('warn')[0]).toContain('no handler');
    expect(recompute.calls).toEqual([]);
  });

  it('an unregistered handler gives no recompute even for a retried event', async () => {
    const { store, worker, recompute } = setup({});
    store.seed({ attempts: 2 });

    await worker.drain();

    expect(recompute.calls).toEqual([]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
  });
});

describe('handler contract', () => {
  it('hands the handler the event, the stored user id, the attempts before this try and the ports, but not the event store', async () => {
    const contexts: WebhookHandlerContext[] = [];
    const { store, worker, strava, runs } = setup(async (ctx) => {
      contexts.push(ctx);
      return done('noop');
    });
    store.seed({ attempts: 3, user_id: 'user-9', object_id: 555 });

    await worker.drain();

    const ctx = contexts[0];
    expect(ctx.event).toMatchObject({ id: 1, object_id: 555 });
    expect(ctx).toMatchObject({ userId: 'user-9', attempts: 3 });
    expect(ctx.strava).toBe(strava);
    expect(ctx.runs).toBe(runs);
    expect(ctx.now()).toEqual(START);
    expect('store' in ctx).toBe(false);
  });

  it('a handler that throws is a failed attempt with a short code, never the error message', async () => {
    const { store, worker } = setup(async () => {
      throw Object.assign(new Error('Bearer abc123 {"title":"Secret run"}'), { code: 'ECONNRESET' });
    });
    store.seed();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'handler_error:ECONNRESET' });
  });

  it('a handler that returns nothing usable is a failed attempt', async () => {
    const { store, worker } = setup((async () => undefined) as unknown as WebhookHandler);
    store.seed();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'invalid_handler_result' });
  });

  it('a handler that names an outcome outside the list is a failed attempt', async () => {
    const { store, worker } = setup((async () => ({ status: 'done', outcome: 'made_up', recalculateFrom: null })) as unknown as WebhookHandler);
    store.seed();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'invalid_handler_result' });
  });

  it('last_error from a handler is cut short', async () => {
    const { store, worker } = setup(async () => failure('x'.repeat(500)));
    store.seed();

    await worker.drain();

    expect(store.row(1).last_error).toHaveLength(80);
  });

  it('last_error from a handler is filtered like an error code: no spaces, quotes or braces', async () => {
    const { store, worker } = setup(async () => failure('Bearer abc {"title": "x"}'));
    store.seed();

    await worker.drain();

    expect(store.row(1).last_error).toBe('Bearerabctitle:x');
    expect(store.row(1).last_error).not.toMatch(/[\s"{}]/);
  });

  it('the worker itself makes no Strava calls', async () => {
    const { store, worker, strava } = setup(async () => changed('2026-10-10'));
    store.seed();
    store.seed({ user_id: null });
    store.seed({ received_at: new Date(START.getTime() - 3 * 24 * HOUR).toISOString() });

    await worker.drain();

    expect(strava.calls).toEqual([]);
  });

  it('a user without a Strava connection ends as ignored_unknown_owner; other token failures are failed attempts', () => {
    expect(resultForTokenFailure('not_connected')).toEqual({ status: 'done', outcome: 'ignored_unknown_owner', recalculateFrom: null });
    expect(resultForTokenFailure('refresh_failed')).toEqual({ status: 'retry', error: 'token_refresh_failed' });
    expect(resultForTokenFailure('no_refresh_token')).toEqual({ status: 'retry', error: 'no_refresh_token' });
  });

  it('a rejected refresh token or a token row that could not be read is a retry for an activity event, never an unknown owner', () => {
    expect(resultForTokenFailure('refresh_rejected')).toEqual({ status: 'retry', error: 'token_refresh_rejected' });
    expect(resultForTokenFailure('token_read_failed')).toEqual({ status: 'retry', error: 'token_read_failed' });
  });
});

describe('the loop', () => {
  it('a failing claim does not crash the loop and the next sweep tries again', async () => {
    const logs = captureLogs();
    const { store, worker } = setup(async () => done('noop'));
    store.seed();
    store.claimError = Object.assign(new Error('connection refused to db.internal with key abc'), { code: 'ECONNREFUSED' });

    await expect(worker.drain()).resolves.toBeUndefined();
    expect(store.row(1).status).toBe('pending');
    expect(logs.at('error')).toHaveLength(1);
    expect(logs.all()).not.toContain('db.internal');

    store.claimError = null;
    await worker.drain();
    expect(store.row(1).status).toBe('done');
  });

  it('a failed status write is logged and leaves the row to the lease, which counts the attempt', async () => {
    const logs = captureLogs();
    const handled: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      handled.push(ctx.attempts);
      return done('noop');
    });
    store.seed();
    store.writeError = new Error('db down');

    await worker.drain();
    expect(store.row(1).status).toBe('processing');
    expect(logs.at('error').length).toBeGreaterThan(0);

    store.writeError = null;
    clock = new Date(START.getTime() + (LEASE_SECONDS + 1) * 1000);
    await worker.drain();

    expect(handled).toEqual([0, 1]);
    expect(store.row(1)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('a wake-up while the loop is running starts no second loop, and the event it announces is not lost', async () => {
    let active = 0;
    let peak = 0;
    const handled: number[] = [];
    const { store, worker } = setup(async (ctx) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      handled.push(ctx.event.id);
      active -= 1;
      return done('noop');
    });
    store.seed();
    // The event arrives right after the loop's last claim found the queue empty: only the wake-up can save it.
    const claim = store.claim.bind(store);
    let claims = 0;
    store.claim = async (leaseSeconds, max) => {
      const rows = await claim(leaseSeconds, max);
      claims += 1;
      if (claims === 2) {
        store.seed({ owner_id: 5002, user_id: 'user-2' });
        void worker.drain();
      }
      return rows;
    };

    await worker.drain();

    expect(peak).toBe(1);
    expect(handled).toEqual([1, 2]);
  });

  it('drain finds nothing to do on an empty queue', async () => {
    const { worker, store } = setup(async () => done('noop'));
    await worker.drain();
    expect(store.rows()).toEqual([]);
  });
});

describe('retention', () => {
  it('retention purges done events after 30 days and dead events after 90 days and keeps newer ones', async () => {
    const { store, worker } = setup(async () => done('noop'));
    const ago = (days: number, extraMs = 0) => new Date(START.getTime() - days * MS_DAY - extraMs).toISOString();
    expect([WEBHOOK_RETENTION_DONE_DAYS, WEBHOOK_RETENTION_FAILED_DAYS]).toEqual([30, 90]);
    const oldDone = store.seed({ status: 'done', outcome: 'noop', processed_at: ago(30, 1000) });
    const freshDone = store.seed({ status: 'done', outcome: 'noop', processed_at: ago(29) });
    const oldDead = store.seed({ status: 'dead', processed_at: ago(90, 1000) });
    const freshDead = store.seed({ status: 'dead', processed_at: ago(89) });
    const deadAt31 = store.seed({ status: 'dead', processed_at: ago(31) });
    const pending = store.seed({ status: 'pending', received_at: ago(200) });

    const purged = await worker.runRetention();

    expect(purged).toEqual({ done: 1, dead: 1 });
    expect(store.rows().map((row) => row.id).sort()).toEqual([freshDone.id, freshDead.id, deadAt31.id, pending.id].sort());
    expect(store.rows().some((row) => row.id === oldDone.id || row.id === oldDead.id)).toBe(false);
  });

  it('a failing retention run is logged and does not throw', async () => {
    const logs = captureLogs();
    const { store, worker } = setup(async () => done('noop'));
    store.purge = async () => {
      throw new Error('db down');
    };

    await expect(worker.runRetention()).resolves.toBeNull();
    expect(logs.at('error')).toHaveLength(1);
  });
});

describe('logging', () => {
  it('routine log lines carry no Strava id; only the dead alarm names object_id and owner_id', async () => {
    const logs = captureLogs();
    const OBJECT_ID = 987654321;
    const OWNER_ID = 555111;
    const ids = { object_id: OBJECT_ID, owner_id: OWNER_ID };
    const { store, worker, recompute } = setup({
      [webhookHandlerKey('activity', 'create')]: async (ctx) => {
        if (ctx.event.id === 1) throw new Error('boom');
        if (ctx.event.id === 2) return changed('2026-10-10');
        return failure('server_error');
      },
    });
    recompute.reprocessError = new Error('db');
    store.seed({ ...ids });
    store.seed({ ...ids });
    store.seed({ ...ids, aspect_type: 'update' }); // no handler registered
    store.seed({ ...ids, received_at: new Date(START.getTime() - 3 * 24 * HOUR).toISOString() }); // dead: the alarm
    store.claimError = null;

    await worker.drain();
    await worker.runRetention();
    store.claimError = Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
    await worker.drain();

    expect(logs.lines.length).toBeGreaterThan(3);
    const withIds = logs.lines.filter((line) => line.text.includes(String(OBJECT_ID)) || line.text.includes(String(OWNER_ID)));
    expect(withIds).toHaveLength(1);
    expect(withIds[0].text).toContain('🚨 KRITISKT: Strava-webhook');
  });

  it('worker never logs tokens, titles or request bodies', async () => {
    const logs = captureLogs();
    const SECRET = 'SECRET-TOKEN-9f3a';
    const TITLE = 'My secret morning run';
    const { store, worker, recompute } = setup(async (ctx) => {
      if (ctx.event.id === 1) throw new Error(`Bearer ${SECRET} body={"title":"${TITLE}"}`);
      if (ctx.event.id === 2) return failure('server_error');
      return changed('2026-10-10');
    });
    recompute.totalsError = new Error(`totals ${SECRET} ${TITLE}`);
    // A row that carried more than the whitelist would still never be printed.
    store.seed({ updates: { title: TITLE, private: 'true' } });
    store.seed({ updates: { title: TITLE } });
    store.seed({ updates: { title: TITLE } });
    store.seed({ updates: { title: TITLE }, received_at: new Date(START.getTime() - 3 * 24 * HOUR).toISOString() });
    store.seed({ user_id: null });

    await worker.drain();
    await worker.runRetention();

    expect(logs.lines.length).toBeGreaterThan(0);
    const everything = logs.all() + store.rows().map((row) => row.last_error).join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(TITLE);
    expect(everything).not.toMatch(/Bearer/);
  });
});

describe('after an import', () => {
  const imported = (id: string, date = '2026-10-12'): WebhookImportedRun => ({
    id,
    external_id: `ext-${id}`,
    date,
    distance_km: 5,
    start_lat: 59.3,
    start_lng: 18.1,
    start_time: `${date}T07:30:00Z`,
    moving_time: 1500,
    is_treadmill: false,
  });
  const importedDone = (...runs: WebhookImportedRun[]): WebhookHandlerResult => ({
    status: 'done',
    outcome: 'imported',
    recalculateFrom: runs.map((run) => run.date).sort()[0],
    importedRuns: runs,
  });
  const kinds = (recompute: ReturnType<typeof setup>['recompute']) => recompute.calls.map((call) => call.kind);

  it('runs reprocess, weather, totals and event qualification in that order', async () => {
    const { store, worker, recompute } = setup(async () => importedDone(imported('run-1')));
    store.seed();

    await worker.drain();

    expect(kinds(recompute)).toEqual(['reprocess', 'weather', 'totals', 'qualify']);
    expect(recompute.calls[0]).toEqual({ kind: 'reprocess', userId: 'user-1', fromDate: '2026-10-12' });
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported' });
  });

  it('fetches weather and qualifies events once for all new runs of a batch, and reprocesses once from the oldest date', async () => {
    const runs = [imported('run-a', '2026-10-12'), imported('run-b', '2026-10-10')];
    const { store, worker, recompute } = setup(async (ctx) => importedDone(runs[ctx.event.id - 1]));
    store.seed();
    store.seed();

    await worker.drain();

    expect(recompute.calls).toEqual([
      { kind: 'reprocess', userId: 'user-1', fromDate: '2026-10-10' },
      { kind: 'weather', runIds: ['run-a', 'run-b'] },
      { kind: 'totals', userId: 'user-1' },
      { kind: 'qualify', userId: 'user-1', runIds: ['run-a', 'run-b'] },
    ]);
  });

  it('only runs the new runs through weather and event qualification, not the other events of the batch', async () => {
    const { store, worker, recompute } = setup(async (ctx) => (ctx.event.id === 1 ? importedDone(imported('run-new')) : changed('2026-10-11')));
    store.seed();
    store.seed();

    await worker.drain();

    expect(recompute.calls.filter((call) => call.kind === 'weather' || call.kind === 'qualify')).toEqual([
      { kind: 'weather', runIds: ['run-new'] },
      { kind: 'qualify', userId: 'user-1', runIds: ['run-new'] },
    ]);
  });

  it('does neither weather nor event qualification when nothing was imported', async () => {
    const { store, worker, recompute } = setup(async () => changed('2026-10-12'));
    store.seed();

    await worker.drain();

    expect(kinds(recompute)).toEqual(['reprocess', 'totals']);
  });

  it('a weather failure is logged and changes nothing: totals and qualification still run and the event is done', async () => {
    const logs = captureLogs();
    const { store, worker, recompute } = setup(async () => importedDone(imported('run-1')));
    recompute.weatherError = Object.assign(new Error('weather down SECRET'), { code: 'ETIMEDOUT' });
    store.seed();

    await worker.drain();

    expect(kinds(recompute)).toEqual(['reprocess', 'weather', 'totals', 'qualify']);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported', attempts: 0 });
    expect(logs.all()).toContain('ETIMEDOUT');
    expect(logs.all()).not.toContain('SECRET');
  });

  it('an event qualification failure never fails the batch', async () => {
    const logs = captureLogs();
    const { store, worker, recompute } = setup(async () => importedDone(imported('run-1')));
    recompute.qualifyError = Object.assign(new Error('qualify down SECRET'), { code: 'XX000' });
    store.seed();

    await worker.drain();
    await new Promise((resolve) => setImmediate(resolve));

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported', attempts: 0 });
    expect(logs.at('error').join('\n')).toContain('XX000');
    expect(logs.all()).not.toContain('SECRET');
  });

  it('event qualification that throws at once, before returning a promise, never fails the batch', async () => {
    const { store, worker, recompute } = setup(async () => importedDone(imported('run-1')));
    recompute.qualifyThrowsSynchronously = true;
    store.seed();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported' });
  });

  it('event qualification is fire-and-forget: the batch does not wait for it', async () => {
    const { store, worker, recompute } = setup(async () => importedDone(imported('run-1')));
    recompute.qualifyNeverSettles = true;
    store.seed();

    await worker.drain();

    expect(kinds(recompute)).toEqual(['reprocess', 'weather', 'totals', 'qualify']);
    expect(store.row(1).status).toBe('done');
  });

  it('when the reprocess fails the event is retried, but weather and event qualification still run for the new run and totals do not', async () => {
    const { store, worker, recompute } = setup(async () => importedDone(imported('run-1')));
    recompute.reprocessError = new Error('boom');
    store.seed();

    await worker.drain();

    expect(kinds(recompute)).toEqual(['reprocess', 'weather', 'qualify']);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'recompute_failed' });
  });

  it('a retried event does not qualify the same run twice: only the try that imported it carries the run', async () => {
    let tries = 0;
    const { store, worker, recompute } = setup(async () => {
      tries += 1;
      return tries === 1 ? importedDone(imported('run-1')) : done('noop', '2026-10-12');
    });
    recompute.reprocessError = new Error('boom');
    store.seed();
    await worker.drain();
    recompute.reprocessError = null;
    clock = new Date(START.getTime() + 2 * MINUTE);

    await worker.drain();

    expect(recompute.calls.filter((call) => call.kind === 'qualify')).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
  });

  it('an imported run without a usable date makes the recalculation start from the earliest run', async () => {
    const { store, worker, recompute, runs } = setup(async () => ({ status: 'done', outcome: 'imported', recalculateFrom: null, importedRuns: [imported('run-1')] }));
    runs.runs.push({ userId: 'user-1', externalId: '1', date: '2026-09-01' });
    store.seed();

    await worker.drain();

    expect(recompute.calls[0]).toEqual({ kind: 'reprocess', userId: 'user-1', fromDate: '2026-09-01' });
    expect(kinds(recompute)).toContain('qualify');
  });

  it('entries of importedRuns that are not runs are dropped before weather and qualification', async () => {
    const { store, worker, recompute } = setup(
      (async () => ({
        status: 'done',
        outcome: 'imported',
        recalculateFrom: '2026-10-12',
        importedRuns: [imported('run-1'), null, 'x', { id: 7 }, { id: 'run-2', date: 'not a date', distance_km: 5 }],
      })) as unknown as WebhookHandler,
    );
    store.seed();

    await worker.drain();

    expect(recompute.calls.filter((call) => call.kind === 'weather')).toEqual([{ kind: 'weather', runIds: ['run-1'] }]);
  });

  it('a handler that returns importedRuns that is not a list is a failed attempt', async () => {
    const { store, worker } = setup(
      (async () => ({ status: 'done', outcome: 'imported', recalculateFrom: '2026-10-12', importedRuns: 'run-1' })) as unknown as WebhookHandler,
    );
    store.seed();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'invalid_handler_result' });
  });
});

describe('critical alerts in sentry', () => {
  const overdue = () => new Date(START.getTime() - WEBHOOK_DEAD_AFTER_HOURS * HOUR - 1000).toISOString();
  let sentry: FakeSentry;
  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
    sentry = startFakeSentry();
  });
  afterEach(async () => {
    await sentry.stop();
  });

  it('critical log lines reach sentry', async () => {
    const { store, worker } = setup(async () => done('noop'));
    const old = store.seed({ received_at: overdue(), object_id: 987654321, owner_id: 555111 });

    await worker.drain();
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'webhook_dead', user_id: old.user_id } });
  });

  it('a dead deletion reaches sentry as the same alert', async () => {
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: overdue(), object_type: 'activity', aspect_type: 'delete' });

    await worker.drain();
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'webhook_dead' } });
    expect(sent[0].message).toMatch(/deletion/i);
  });

  it('a dead event alerts once at the transition, not on every worker round', async () => {
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: overdue() });

    await worker.drain();
    await worker.drain();
    await worker.drain();
    const sent = await sentry.flush();

    expect(store.row(1).status).toBe('dead');
    expect(sent).toHaveLength(1);
  });

  it('two events that die in the same round are two alerts, one each', async () => {
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: overdue(), object_id: 11, owner_id: 21 });
    store.seed({ received_at: overdue(), object_id: 12, owner_id: 22 });

    await worker.drain();
    const sent = await sentry.flush();

    expect(sent).toHaveLength(2);
  });

  it('sends no Strava id, name or token in the tags', async () => {
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: overdue(), object_id: 987654321, owner_id: 555111 });

    await worker.drain();
    const [event] = await sentry.flush();

    const tags = JSON.stringify(event.tags);
    expect(tags).not.toContain('987654321');
    expect(tags).not.toContain('555111');
    expect(Object.keys(event.tags).sort()).toEqual(['alert', 'source', 'user_id']);
  });

  it('a dead event whose status could not be written sends no critical alert', async () => {
    const { store, worker } = setup(async () => done('noop'));
    store.seed({ received_at: overdue() });
    store.writeError = new Error('db down');

    await worker.drain();

    // The failed write itself is an ordinary error line; the alarm is not given.
    const sent = await sentry.flush();
    expect(sent.filter((event) => event.tags?.alert === 'critical')).toEqual([]);
  });
});
