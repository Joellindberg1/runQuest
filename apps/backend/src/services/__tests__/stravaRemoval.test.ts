/**
 * The shared deletion path for Strava runs (services/stravaRemoval.ts, ADR 010 decision 8), called directly: the way the disconnect
 * (S16) uses it, outside the webhook worker. The worker's own use of it is tested through the delete handler.
 * The database is createFakeDb; reprocessRunsFromDate and calculateUserTotals are mocked here and asserted as calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../routes/runs.js', () => ({ reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseClient } from '../../config/database.js';
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { deleteStravaRuns, recomputeAfterRemoval } from '../stravaRemoval.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const run = (over: Row = {}): Row => ({ id: 'r', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, ...over });

function setup(runs: Row[], options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = { runs };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables, db };
}

let lines: string[];
beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe('deleteStravaRuns', () => {
  it('removal never deletes a manual run', async () => {
    const { tables, db } = setup([
      run({ id: 'strava-mine', external_id: '1001' }),
      run({ id: 'manual-same-id', source: 'manual', external_id: '1001' }),
      run({ id: 'manual-other', source: 'manual', external_id: null, date: '2026-09-01' }),
    ]);

    await deleteStravaRuns('user-1', { externalId: '1001' });
    await deleteStravaRuns('user-1', { all: true });

    expect(tables.runs.map((r) => r.id).sort()).toEqual(['manual-other', 'manual-same-id']);
    // The guard is one line in the query itself, on both scopes, not a filter applied afterwards.
    const deletes = db.queries.filter((q) => q.mutation === 'delete');
    expect(deletes).toHaveLength(2);
    for (const query of deletes) expect(query.filters).toContainEqual({ op: 'eq', column: 'source', value: 'strava' });
  });

  it('deletes one activity of one user and returns its date', async () => {
    const { tables } = setup([
      run({ id: 'a', external_id: '1001', date: '2026-10-03' }),
      run({ id: 'b', external_id: '1002', date: '2026-10-04' }),
      run({ id: 'other-user', user_id: 'user-2', external_id: '1001' }),
    ]);

    const dates = await deleteStravaRuns('user-1', { externalId: '1001' });

    expect(dates).toEqual(['2026-10-03']);
    expect(tables.runs.map((r) => r.id).sort()).toEqual(['b', 'other-user']);
  });

  it('deletes every Strava run of the user for a disconnect and returns the dates oldest first', async () => {
    const { tables } = setup([
      run({ id: 'a', external_id: '1', date: '2026-10-05' }),
      run({ id: 'b', external_id: '2', date: '2026-09-01' }),
      run({ id: 'c', external_id: '3', date: '2026-10-05' }),
      run({ id: 'm', source: 'manual', external_id: null }),
      run({ id: 'other-user', user_id: 'user-2' }),
    ]);

    const dates = await deleteStravaRuns('user-1', { all: true });

    expect(dates).toEqual(['2026-09-01', '2026-10-05', '2026-10-05']);
    expect(tables.runs.map((r) => r.id).sort()).toEqual(['m', 'other-user']);
  });

  it('returns no dates when nothing matches', async () => {
    setup([run({ id: 'a', external_id: '1001' })]);
    await expect(deleteStravaRuns('user-1', { externalId: '404' })).resolves.toEqual([]);
    await expect(deleteStravaRuns('nobody', { all: true })).resolves.toEqual([]);
  });

  it('refuses a scope that would widen the delete', async () => {
    const { tables, db } = setup([run({ id: 'a' }), run({ id: 'b', external_id: '2' })]);

    await expect(deleteStravaRuns('user-1', { externalId: '' })).rejects.toThrow();
    await expect(deleteStravaRuns('user-1', {} as never)).rejects.toThrow();
    await expect(deleteStravaRuns('user-1', { all: false } as never)).rejects.toThrow();
    await expect(deleteStravaRuns('', { all: true })).rejects.toThrow();

    expect(tables.runs).toHaveLength(2);
    expect(db.queries).toHaveLength(0);
  });

  it('a database error is thrown with its code only and logged without the Strava id', async () => {
    setup([run({ id: 'a', external_id: '987654321' })], {
      failWhen: (q) => (q.mutation === 'delete' ? { message: 'violates something for external_id 987654321', code: '23503' } as never : null),
    });

    const failure = await deleteStravaRuns('user-1', { externalId: '987654321' }).catch((error: Error & { code?: string }) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error & { code?: string }).code).toBe('23503');
    const text = lines.join('\n') + (failure as Error).message;
    expect(text).toContain('user-1');
    expect(text).toContain('23503');
    expect(text).not.toContain('987654321');
  });

  it('logs our user id and the number of rows only', async () => {
    setup([
      run({ id: 'a', external_id: '987654321', date: '2026-10-03', title: 'Secret run', start_lat: 59.3293 }),
      run({ id: 'b', external_id: '555', date: '2026-10-04' }),
    ]);

    await deleteStravaRuns('user-1', { all: true });

    const text = lines.join('\n');
    expect(text).toContain('user-1');
    expect(text).toContain('2');
    for (const secret of ['987654321', '555', 'Secret run', '59.3293', '2026-10-03']) expect(text).not.toContain(secret);
  });
});

describe('the disconnect (S16) use of both halves', () => {
  it('deletes all Strava runs, then reprocesses once from the oldest date and recalculates once', async () => {
    const { tables } = setup([
      run({ id: 'a', external_id: '1', date: '2026-10-05' }),
      run({ id: 'b', external_id: '2', date: '2026-09-01' }),
      run({ id: 'm', source: 'manual', external_id: null, date: '2026-08-01' }),
    ]);

    const dates = await deleteStravaRuns('user-1', { all: true });
    if (dates.length > 0) await recomputeAfterRemoval('user-1', dates[0]);

    expect(tables.runs.map((r) => r.id)).toEqual(['m']);
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-09-01');
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });
});

describe('recomputeAfterRemoval', () => {
  it('reprocesses from the given date and then recalculates the totals, once each', async () => {
    await recomputeAfterRemoval('user-1', '2026-09-01');

    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-09-01');
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1', { emitRankNews: false });
    expect(vi.mocked(reprocessRunsFromDate).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(calculateUserTotals).mock.invocationCallOrder[0]);
  });

  it('throws a failed reprocess upwards and still brings the totals up to date', async () => {
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));

    await expect(recomputeAfterRemoval('user-1', '2026-09-01')).rejects.toThrow('boom');

    // The deleted runs must leave the totals even when the XP of the later runs could not be recomputed; a retry sorts the rest out.
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('says that the totals were recalculated when they were', async () => {
    vi.mocked(calculateUserTotals).mockResolvedValueOnce(true);
    await expect(recomputeAfterRemoval('user-1', '2026-09-01')).resolves.toBe(true);
  });

  it('says that the totals were not recalculated when calculateUserTotals returns false, which is how it reports a failure', async () => {
    vi.mocked(calculateUserTotals).mockResolvedValueOnce(false);
    await expect(recomputeAfterRemoval('user-1', '2026-09-01')).resolves.toBe(false);
  });

  it('does not fail when the totals fail: they are best-effort, but it says they were not recalculated', async () => {
    vi.mocked(calculateUserTotals).mockRejectedValueOnce(Object.assign(new Error('totals down for 987654321'), { code: 'XX001' }));

    await expect(recomputeAfterRemoval('user-1', '2026-09-01')).resolves.toBe(false);

    const text = lines.join('\n');
    expect(text).toContain('XX001');
    expect(text).not.toContain('987654321');
  });

  it('refuses a missing user or date instead of reprocessing everything', async () => {
    await expect(recomputeAfterRemoval('', '2026-09-01')).rejects.toThrow();
    await expect(recomputeAfterRemoval('user-1', 'yesterday')).rejects.toThrow();
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });
});
