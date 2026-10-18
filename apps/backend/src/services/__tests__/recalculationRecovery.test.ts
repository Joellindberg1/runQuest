/**
 * The recovery job of the recalculation marks (services/recalculationMarks/recovery.ts): it finds the users whose recalculation a
 * crash or a failure left undone, recalculates them from the marked date and clears the mark. Behaviour tests against the in-memory
 * mark store (test-utils/inMemoryRecalculationMarks.ts, which mirrors migration 057); the SQL itself is proved against PGlite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../utils/logger.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import { createInMemoryMarkStore, type InMemoryMarkStore } from '../../test-utils/inMemoryRecalculationMarks.js';
import { createRecalculationRecovery } from '../recalculationMarks/recovery.js';
import { RECOVERY_MAX_PER_RUN } from '../recalculationMarks/constants.js';

let logLines: string[] = [];
let store: InMemoryMarkStore;
let calls: string[];

beforeEach(() => {
  logLines = [];
  calls = [];
  store = createInMemoryMarkStore();
  const collect = (...args: unknown[]) => {
    logLines.push(args.map(String).join(' '));
  };
  vi.spyOn(logger, 'info').mockImplementation(collect);
  vi.spyOn(logger, 'warn').mockImplementation(collect);
  vi.spyOn(logger, 'error').mockImplementation(collect);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A recompute that writes down what it was asked to do, and fails where the test says so. */
function recomputeWith(over: { reprocess?: (userId: string, from: string) => Promise<void>; totals?: (userId: string) => Promise<void> } = {}) {
  return {
    async reprocessFrom(userId: string, from: string) {
      calls.push(`reprocess:${userId}:${from}`);
      await over.reprocess?.(userId, from);
    },
    async recalculateTotals(userId: string) {
      calls.push(`totals:${userId}`);
      await over.totals?.(userId);
    },
  };
}

const recovery = (over: Parameters<typeof recomputeWith>[0] = {}, maxPerRun?: number) =>
  createRecalculationRecovery({ store, recompute: recomputeWith(over), ...(maxPerRun ? { maxPerRun } : {}) });

describe('recalculation recovery', () => {
  it('does nothing and costs one read when no user is marked', async () => {
    const summary = await recovery().run();

    expect(calls).toEqual([]);
    expect(store.calls).toEqual(['list']);
    expect(summary).toEqual({ found: 0, recalculated: 0, failed: 0 });
  });

  it('recalculates a marked user from the marked date, totals after the reprocess, and clears the mark', async () => {
    const version = await store.mark('user-1', '2026-10-13');
    store.calls.length = 0;

    const summary = await recovery().run();

    expect(calls).toEqual(['reprocess:user-1:2026-10-13', 'totals:user-1']);
    expect(store.calls).toContain(`clear:user-1:${version}`);
    expect(store.rows()).toEqual([]);
    expect(summary).toEqual({ found: 1, recalculated: 1, failed: 0 });
  });

  it('keeps the mark when the reprocess fails, skips the totals, and finishes on the next run', async () => {
    await store.mark('user-1', '2026-10-13');
    let failing = true;
    const job = recovery({
      reprocess: async () => {
        if (failing) throw Object.assign(new Error('boom'), { code: '57014' });
      },
    });

    const first = await job.run();
    expect(first).toEqual({ found: 1, recalculated: 0, failed: 1 });
    expect(store.rows()).toHaveLength(1);
    expect(calls).toEqual(['reprocess:user-1:2026-10-13']); // the totals wait for a reprocess that worked

    failing = false;
    calls.length = 0;
    const second = await job.run();
    expect(second).toEqual({ found: 1, recalculated: 1, failed: 0 });
    expect(calls).toEqual(['reprocess:user-1:2026-10-13', 'totals:user-1']);
    expect(store.rows()).toEqual([]);
  });

  it('keeps the mark when the totals fail', async () => {
    await store.mark('user-1', '2026-10-13');

    const summary = await recovery({
      totals: async () => {
        throw Object.assign(new Error('boom'), { code: '08006' });
      },
    }).run();

    expect(summary).toEqual({ found: 1, recalculated: 0, failed: 1 });
    expect(store.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-10-13', version: 1 }]);
  });

  it('does not clear a mark that a newer change wrote while it was recalculating, and takes it on the next run from the earliest date', async () => {
    await store.mark('user-1', '2026-10-13');
    let marked = false;
    const job = recovery({
      reprocess: async (userId) => {
        // A deletion of an older run marks the user while this recalculation is already running.
        if (!marked) {
          marked = true;
          await store.mark(userId, '2026-10-05');
        }
      },
    });

    const first = await job.run();
    expect(store.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-10-05', version: 2 }]);
    expect(first.failed).toBe(0);

    calls.length = 0;
    await job.run();
    expect(calls).toEqual(['reprocess:user-1:2026-10-05', 'totals:user-1']);
    expect(store.rows()).toEqual([]);
  });

  it('reads the mark again under the user lock: a mark cleared by someone else meanwhile costs no recalculation', async () => {
    await store.mark('user-1', '2026-10-13');

    let release!: () => void;
    const holding = withUserLock('user-1', () => new Promise<void>((resolve) => { release = resolve; }));
    const running = recovery().run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]); // waits for the lock

    // The holder (a poll, the reconcile) recalculated and cleared the mark before it let go.
    await store.clear('user-1', 1);
    release();
    await holding;
    const summary = await running;

    expect(calls).toEqual([]);
    expect(summary).toEqual({ found: 1, recalculated: 0, failed: 0 });
  });

  it('uses the date the mark has when the lock is granted, not the one it had when the list was read', async () => {
    await store.mark('user-1', '2026-10-13');

    let release!: () => void;
    const holding = withUserLock('user-1', () => new Promise<void>((resolve) => { release = resolve; }));
    const running = recovery().run();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await store.mark('user-1', '2026-10-02'); // widened while it waited
    release();
    await holding;
    await running;

    expect(calls).toEqual(['reprocess:user-1:2026-10-02', 'totals:user-1']);
    expect(store.rows()).toEqual([]);
  });

  it('takes at most the per-run cap, oldest mark first, and leaves the rest for the next run', async () => {
    for (let n = 1; n <= RECOVERY_MAX_PER_RUN + 3; n += 1) await store.mark(`user-${String(n).padStart(2, '0')}`, '2026-10-10');

    const first = await recovery().run();

    expect(first).toEqual({ found: RECOVERY_MAX_PER_RUN, recalculated: RECOVERY_MAX_PER_RUN, failed: 0 });
    expect(store.rows().map((row) => row.userId)).toEqual(['user-21', 'user-22', 'user-23']);

    calls.length = 0;
    const second = await recovery().run();
    expect(second.recalculated).toBe(3);
    expect(store.rows()).toEqual([]);
  });

  it('goes on with the next user when one user fails', async () => {
    await store.mark('user-1', '2026-10-13');
    await store.mark('user-2', '2026-10-14');

    const summary = await recovery({
      reprocess: async (userId) => {
        if (userId === 'user-1') throw Object.assign(new Error('boom'), { code: '40001' });
      },
    }).run();

    expect(summary).toEqual({ found: 2, recalculated: 1, failed: 1 });
    expect(store.rows().map((row) => row.userId)).toEqual(['user-1']);
  });

  it('counts a failed clear as a failure and leaves the mark, which the next run repeats harmlessly', async () => {
    await store.mark('user-1', '2026-10-13');
    store.failClear = Object.assign(new Error('boom'), { code: '57P01' });

    const summary = await recovery().run();

    expect(summary).toEqual({ found: 1, recalculated: 0, failed: 1 });
    expect(store.rows()).toHaveLength(1);
    expect(logLines.join('\n')).toContain('57P01');
  });

  it('never throws: a list that cannot be read ends the run with one failure and the code in the log', async () => {
    store.failRead = Object.assign(new Error('SECRET row value 12345'), { code: '08006' });

    const summary = await recovery().run();

    expect(summary).toEqual({ found: 0, recalculated: 0, failed: 1 });
    expect(logLines.join('\n')).toContain('08006');
    expect(logLines.join('\n')).not.toContain('SECRET');
  });

  it('logs our user id and error codes only, never an error message', async () => {
    await store.mark('user-1', '2026-10-13');

    await recovery({
      reprocess: async () => {
        throw Object.assign(new Error('failed for athlete 987654321 "Morning Run" at 59.33,18.06'), { code: '57014' });
      },
    }).run();

    const log = logLines.join('\n');
    expect(log).toContain('user-1');
    expect(log).toContain('57014');
    expect(log).not.toContain('987654321');
    expect(log).not.toContain('Morning Run');
    expect(log).not.toContain('59.33');
  });
});
