/**
 * removeStravaConnection (services/stravaConnection.ts, ADR 010 decision 7.4): the one function behind "Disconnect" and a
 * deauthorize from Strava. The database is createFakeDb with the foreign keys of runs(id) (withRunForeignKeys); the deletion
 * chain itself (stravaRemoval.ts) is real, and only reprocessRunsFromDate and calculateUserTotals are mocked and asserted as calls.
 * The lock is the real withUserLock: the function must run inside the caller's lock without taking one itself.
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
import { withUserLock } from '../../utils/keyedMutex.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { removeStravaConnection } from '../stravaConnection.js';
import { createRecalculationRecovery } from '../recalculationMarks/recovery.js';
import { createInMemoryMarkStore } from '../../test-utils/inMemoryRecalculationMarks.js';

const run = (over: Row = {}): Row => ({ id: 'r', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, ...over });
const token = (over: Row = {}): Row => ({
  user_id: 'user-1',
  athlete_id: 424242,
  access_token: 'SECRET-ACCESS',
  refresh_token: 'SECRET-REFRESH',
  consent_version: '2026-10-14',
  consented_at: '2026-10-14T09:30:00.000Z',
  ...over,
});

interface Setup {
  runs?: Row[];
  tokens?: Row[];
  extra?: Record<string, Row[]>;
  options?: FakeDbOptions;
  hooks?: RunsHooks;
}

interface RunsHooks {
  /** Runs right after a delete on `runs` has been applied: a row that shows up behind the delete's back. */
  afterDelete?: (tables: Record<string, Row[]>) => void;
  /** PostgREST max-rows: a delete with .select() hands back at most this many rows, newest first. */
  returnCap?: number;
}

/** Puts the hooks on every query on `runs`; every other table passes through. */
function withRunsHooks<T extends { from: (table: string) => any }>(client: T, tables: Record<string, Row[]>, hooks: RunsHooks): T {
  function wrap(builder: any): any {
    let isDelete = false;
    const wrapper: any = new Proxy(builder, {
      get(target, property) {
        if (property === 'then') {
          return (resolve: (value: unknown) => void, reject?: (error: unknown) => void) =>
            target.then((result: any) => {
              if (isDelete) {
                hooks.afterDelete?.(tables);
                if (hooks.returnCap !== undefined && Array.isArray(result.data)) {
                  result = { ...result, data: [...result.data].sort((a: Row, b: Row) => (a.date < b.date ? 1 : -1)).slice(0, hooks.returnCap) };
                }
              }
              resolve(result);
            }, reject);
        }
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (property === 'delete') isDelete = true;
          const out = value.apply(target, args);
          return out === target ? wrapper : out;
        };
      },
    });
    return wrapper;
  }
  return { ...client, from: (table: string) => (table === 'runs' ? wrap(client.from(table)) : client.from(table)) };
}

function setup({ runs = [], tokens = [token()], extra = {}, options = {}, hooks = {} }: Setup = {}) {
  const tables: Record<string, Row[]> = { runs, strava_tokens: tokens, ...extra };
  const db = createFakeDb(tables, options);
  const client = withRunsHooks(withRunForeignKeys(db.client, tables), tables, hooks);
  vi.mocked(getSupabaseClient).mockReturnValue(client as any);
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

describe('removeStravaConnection', () => {
  it('deauthorize purge removes all strava runs of the athlete and keeps manual runs', async () => {
    const { tables } = setup({
      runs: [
        run({ id: 'a', external_id: '1', date: '2026-10-05' }),
        run({ id: 'b', external_id: '2', date: '2026-09-01' }),
        run({ id: 'manual', source: 'manual', external_id: null, date: '2026-08-01' }),
        run({ id: 'manual-same-id', source: 'manual', external_id: '1', date: '2026-08-02' }),
        run({ id: 'other-user', user_id: 'user-2', external_id: '3' }),
      ],
      tokens: [token(), token({ user_id: 'user-2', athlete_id: 7 })],
    });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(tables.runs.map((r) => r.id).sort()).toEqual(['manual', 'manual-same-id', 'other-user']);
    expect(tables.strava_tokens.map((t) => t.user_id)).toEqual(['user-2']);
  });

  it('deauthorize purge recomputes totals and badges once for the user', async () => {
    const { tables } = setup({
      runs: [
        run({ id: 'a', external_id: '1', date: '2026-10-05' }),
        run({ id: 'b', external_id: '2', date: '2026-09-01' }),
        run({ id: 'c', external_id: '3', date: '2026-10-05' }),
      ],
    });
    const rowDuringRecompute: Array<number> = [];
    vi.mocked(reprocessRunsFromDate).mockImplementation(async () => { rowDuringRecompute.push(tables.strava_tokens.length); });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-09-01');
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1', { emitRankNews: false });
    // The token row is still there while the runs are recomputed: a crash in between leaves it for the rerun.
    expect(rowDuringRecompute).toEqual([1]);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('deauthorize purge for an athlete with event-qualified runs keeps the entries (run_id null)', async () => {
    const { tables } = setup({
      runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' }), run({ id: 'b', external_id: '2', date: '2026-10-06' })],
      extra: {
        event_entries: [
          { id: 'e1', user_id: 'user-1', run_id: 'a', xp_awarded: 120 },
          { id: 'e2', user_id: 'user-1', run_id: 'b', xp_awarded: 80 },
        ],
        users: [{ id: 'user-1', event_xp: 200 }],
        run_weather: [{ run_id: 'a' }],
      },
    });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(tables.runs).toEqual([]);
    expect(tables.event_entries).toEqual([
      { id: 'e1', user_id: 'user-1', run_id: null, xp_awarded: 120 },
      { id: 'e2', user_id: 'user-1', run_id: null, xp_awarded: 80 },
    ]);
    expect(tables.users).toEqual([{ id: 'user-1', event_xp: 200 }]);
  });

  it('deauthorize purge is idempotent', async () => {
    const { tables } = setup({
      runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' }), run({ id: 'manual', source: 'manual', external_id: null })],
    });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });
    await expect(removeStravaConnection('user-1', { reason: 'deauthorized' })).resolves.toBeUndefined();

    expect(tables.runs.map((r) => r.id)).toEqual(['manual']);
    expect(tables.strava_tokens).toEqual([]);
    // The second call found no runs and no row: nothing is recomputed again.
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('a rerun after a crash before the token row went finishes the job', async () => {
    let failTokenDelete = true;
    const { tables } = setup({
      runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' })],
      options: { failWhen: (q) => (failTokenDelete && q.table === 'strava_tokens' && q.mutation === 'delete' ? ({ message: 'down', code: '57P01' } as never) : null) },
    });

    await expect(removeStravaConnection('user-1', { reason: 'deauthorized' })).rejects.toMatchObject({ code: '57P01' });
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toHaveLength(1);

    failTokenDelete = false;
    await removeStravaConnection('user-1', { reason: 'deauthorized' });
    expect(tables.strava_tokens).toEqual([]);
  });

  it('a failed reprocess is thrown and the token row stays for the rerun', async () => {
    const { tables } = setup({ runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' })] });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));

    await expect(removeStravaConnection('user-1', { reason: 'deauthorized' })).rejects.toThrow('boom');

    expect(tables.strava_tokens).toHaveLength(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1); // the totals were still tried (recomputeAfterRemoval)
  });

  it('a rerun after a failed reprocess recomputes from the earliest run of any source and then deletes the row', async () => {
    const { tables } = setup({
      runs: [
        run({ id: 'a', external_id: '1', date: '2026-10-05' }),
        run({ id: 'm-late', source: 'manual', external_id: null, date: '2026-10-09' }),
        run({ id: 'm-early', source: 'manual', external_id: null, date: '2026-09-20' }),
      ],
    });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));

    await expect(removeStravaConnection('user-1', { reason: 'deauthorized' })).rejects.toThrow('boom');
    expect(tables.runs.map((r) => r.id).sort()).toEqual(['m-early', 'm-late']);
    expect(tables.strava_tokens).toHaveLength(1);

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    // Nothing was deleted on the second call, but the row says the first attempt never finished: the manual runs' streak and XP are repaired.
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(2);
    expect(reprocessRunsFromDate).toHaveBeenLastCalledWith('user-1', '2026-09-20');
    expect(calculateUserTotals).toHaveBeenCalledTimes(2);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('a rerun that fails the reprocess again throws and keeps the row', async () => {
    const { tables } = setup({ runs: [run({ id: 'm', source: 'manual', external_id: null, date: '2026-09-20' })] });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('again'), { code: 'XX000' }));

    await expect(removeStravaConnection('user-1', { reason: 'deauthorized' })).rejects.toThrow('again');

    expect(tables.strava_tokens).toHaveLength(1);
  });

  it('an unfinished earlier attempt with no run left only recalculates the totals', async () => {
    const { tables } = setup({ runs: [] });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1', { emitRankNews: false });
    expect(tables.strava_tokens).toEqual([]);
  });

  it('a rerun after a completed removal does no recompute and makes no write queries', async () => {
    const { tables, db } = setup({
      runs: [run({ id: 'manual', source: 'manual', external_id: null, date: '2026-08-01' })],
      tokens: [],
    });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(db.queries.filter((q) => q.mutation !== undefined)).toEqual([]);
    expect(tables.runs).toHaveLength(1);
  });

  it('deauthorize purge finishes within the 48 h window', async () => {
    // One call deletes everything, with one delete query and no paging. PostgREST max-rows (1000) can cap the rows a delete hands
    // back, and in no particular order: the date to recompute from must still be the true earliest.
    const runs = Array.from({ length: 1500 }, (_, index) =>
      run({ id: `run-${index}`, external_id: String(index), date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10) }),
    );
    const { tables, db } = setup({ runs, hooks: { returnCap: 1000 } });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
    expect(db.queries.filter((q) => q.table === 'runs' && q.mutation === 'delete')).toHaveLength(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2024-01-01');
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('keeps the token row and fails when Strava runs are left after the delete', async () => {
    // A run that lands behind the delete (or a delete that is capped): the row must not go, so the rerun finishes it.
    const { tables } = setup({
      runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' })],
      hooks: { afterDelete: (t) => { if (!t.runs.some((r) => r.id === 'late')) t.runs.push(run({ id: 'late', external_id: '9', date: '2026-10-07' })); } },
    });

    await expect(removeStravaConnection('user-1', { reason: 'deauthorized' })).rejects.toMatchObject({ code: 'strava_runs_remaining' });

    expect(tables.strava_tokens).toHaveLength(1);
  });

  it('runs inside the caller lock without taking one itself', async () => {
    setup({ runs: [run({ id: 'a', external_id: '1' })] });

    await expect(
      withUserLock('user-1', () => removeStravaConnection('user-1', { reason: 'user_disconnect' })),
    ).resolves.toBeUndefined();
    await expect(
      withUserLock('user-1', () => removeStravaConnection('user-1', { reason: 'deauthorized' })),
    ).resolves.toBeUndefined();
  });
});

describe('the recalculation marks of a disconnect', () => {
  const twoRuns = () => [run({ id: 'a', external_id: '1', date: '2026-10-05' }), run({ id: 'b', external_id: '2', date: '2026-09-01' })];

  it('marks the user from the oldest Strava run before the delete, and clears the mark when the recalculation worked', async () => {
    const marks = createInMemoryMarkStore();
    let markedWhenDeleting: unknown = 'the delete was never seen';
    setup({
      runs: twoRuns(),
      options: {
        failWhen: (q) => {
          if (q.table === 'runs' && q.mutation === 'delete') markedWhenDeleting = marks.rows(); // seen before the delete is applied
          return null;
        },
      },
    });

    await removeStravaConnection('user-1', { reason: 'user_disconnect', marks });

    expect(markedWhenDeleting).toEqual([{ userId: 'user-1', fromDate: '2026-09-01', version: 1 }]);
    expect(marks.calls).toEqual(['mark:user-1:2026-09-01', 'clear:user-1:1']);
    expect(marks.rows()).toEqual([]);
  });

  it('leaves the mark when the reprocess fails, so the recovery job finishes what the rerun would', async () => {
    const marks = createInMemoryMarkStore();
    setup({ runs: twoRuns() });
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));

    await expect(removeStravaConnection('user-1', { reason: 'user_disconnect', marks })).rejects.toThrow('boom');

    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-09-01', version: 1 }]);
  });

  it('leaves the mark when only the totals fail, which the disconnect itself does not throw for, and the recovery job recalculates', async () => {
    const marks = createInMemoryMarkStore();
    const { tables } = setup({ runs: twoRuns() });
    vi.mocked(calculateUserTotals).mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57014' }));

    await removeStravaConnection('user-1', { reason: 'user_disconnect', marks });

    expect(tables.strava_tokens).toEqual([]); // the connection is gone: nothing else will ever come back to this user
    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-09-01', version: 1 }]);

    vi.mocked(reprocessRunsFromDate).mockClear();
    vi.mocked(calculateUserTotals).mockClear();
    const recovered = await createRecalculationRecovery({
      store: marks,
      recompute: { reprocessFrom: reprocessRunsFromDate, recalculateTotals: async (userId) => { await calculateUserTotals(userId); } },
    }).run();

    expect(recovered).toEqual({ found: 1, recalculated: 1, failed: 0 });
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-09-01');
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(marks.rows()).toEqual([]);
  });

  it('leaves the mark when the totals run RETURNS false, which is how calculateUserTotals reports that it failed, and the recovery job finishes', async () => {
    const marks = createInMemoryMarkStore();
    const { tables } = setup({ runs: twoRuns() });
    vi.mocked(calculateUserTotals).mockResolvedValueOnce(false);

    await removeStravaConnection('user-1', { reason: 'user_disconnect', marks });

    expect(tables.strava_tokens).toEqual([]);
    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-09-01', version: expect.any(Number) }]);

    vi.mocked(calculateUserTotals).mockResolvedValue(true);
    const recovered = await createRecalculationRecovery({
      store: marks,
      recompute: { reprocessFrom: reprocessRunsFromDate, recalculateTotals: (userId) => calculateUserTotals(userId) },
    }).run();
    expect(recovered).toEqual({ found: 1, recalculated: 1, failed: 0 });
    expect(marks.rows()).toEqual([]);
  });

  it('only logs and finishes when the mark cannot be cleared: the connection is still removed', async () => {
    const marks = createInMemoryMarkStore();
    marks.failClear = Object.assign(new Error('clear failed for user abc@example.com'), { code: '57P01' });
    const { tables } = setup({ runs: twoRuns() });

    await expect(removeStravaConnection('user-1', { reason: 'user_disconnect', marks })).resolves.toBeUndefined();

    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
    expect(marks.rows()).toHaveLength(1); // the recovery job repeats the recalculation once
    const log = lines.join('\n');
    expect(log).toContain('57P01');
    expect(log).not.toContain('abc@example.com');
  });

  it('does not let a mark that cannot be written stop the disconnect, which has its own recovery and a deadline of its own', async () => {
    const marks = createInMemoryMarkStore();
    marks.failMark = Object.assign(new Error('function does not exist for user abc@example.com'), { code: '42883' });
    const { tables } = setup({ runs: twoRuns() });

    await removeStravaConnection('user-1', { reason: 'deauthorized', marks });

    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-09-01');
    const log = lines.join('\n');
    expect(log).toContain('42883');
    expect(log).not.toContain('abc@example.com');
  });

  it('does not clear a mark that a newer change wrote during the recalculation', async () => {
    const marks = createInMemoryMarkStore();
    setup({ runs: twoRuns() });
    vi.mocked(reprocessRunsFromDate).mockImplementationOnce(async (userId) => {
      await marks.mark(userId, '2026-08-01');
    });

    await removeStravaConnection('user-1', { reason: 'user_disconnect', marks });

    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-08-01', version: 2 }]);
  });

  it('marks from the earliest run of any source when it finishes an earlier attempt, and clears the mark afterwards', async () => {
    const marks = createInMemoryMarkStore();
    setup({ runs: [run({ id: 'm', source: 'manual', external_id: null, date: '2026-09-20' })] });

    await removeStravaConnection('user-1', { reason: 'user_disconnect', marks });

    expect(marks.calls).toEqual(['mark:user-1:2026-09-20', 'clear:user-1:1']);
    expect(marks.rows()).toEqual([]);
  });

  it('writes no mark when there is nothing to recalculate: a user without Strava runs and without a connection row', async () => {
    const marks = createInMemoryMarkStore();
    setup({ runs: [run({ id: 'manual', source: 'manual', external_id: null, date: '2026-08-01' })], tokens: [] });

    await removeStravaConnection('user-1', { reason: 'deauthorized', marks });

    expect(marks.calls).toEqual([]);
  });

  it('writes no mark for a connection row with no run at all, where only the totals are recalculated', async () => {
    const marks = createInMemoryMarkStore();
    setup({ runs: [] });

    await removeStravaConnection('user-1', { reason: 'deauthorized', marks });

    expect(marks.calls).toEqual([]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });
});

describe('the revoke hook', () => {
  it('user_disconnect revokes first, then deletes the runs, then the token row', async () => {
    const { tables } = setup({ runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' })] });
    const seen: Array<{ runs: number; tokens: number }> = [];
    const revoke = vi.fn(async () => { seen.push({ runs: tables.runs.length, tokens: tables.strava_tokens.length }); });

    await removeStravaConnection('user-1', { reason: 'user_disconnect', revoke });

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('user-1');
    expect(seen).toEqual([{ runs: 1, tokens: 1 }]);
    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('a failing revoke is logged with its code and the disconnect continues', async () => {
    const { tables } = setup({ runs: [run({ id: 'a', external_id: '1', date: '2026-10-05' })] });
    const revoke = vi.fn().mockRejectedValue(Object.assign(new Error('401 for athlete 424242 token SECRET-ACCESS'), { code: 'strava_401' }));

    await removeStravaConnection('user-1', { reason: 'user_disconnect', revoke });

    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
    const text = lines.join('\n');
    expect(text).toContain('strava_401');
    expect(text).not.toContain('SECRET-ACCESS');
    expect(text).not.toContain('424242');
  });

  it('deauthorized never revokes, even when a hook is given', async () => {
    setup({ runs: [run({ id: 'a', external_id: '1' })] });
    const revoke = vi.fn().mockResolvedValue(undefined);

    await removeStravaConnection('user-1', { reason: 'deauthorized', revoke });

    expect(revoke).not.toHaveBeenCalled();
  });

  it('user_disconnect without a hook just removes the connection', async () => {
    const { tables } = setup({ runs: [run({ id: 'a', external_id: '1' })] });

    await removeStravaConnection('user-1', { reason: 'user_disconnect' });

    expect(tables.runs).toEqual([]);
    expect(tables.strava_tokens).toEqual([]);
  });
});

describe('the consent trace and the log', () => {
  it('writes user id, consent_version and consented_at before the row goes, never a token or the athlete id', async () => {
    const { tables } = setup({ runs: [run({ id: 'a', external_id: '987654321', date: '2026-10-05', title: 'Secret run' })] });
    let rowWhenLogged: number | null = null;
    vi.mocked(logger.info).mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(' ');
      lines.push(text);
      if (text.includes('2026-10-14T09:30:00.000Z')) rowWhenLogged = tables.strava_tokens.length;
    });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    const text = lines.join('\n');
    expect(text).toContain('user-1');
    expect(text).toContain('2026-10-14');
    expect(text).toContain('2026-10-14T09:30:00.000Z');
    expect(rowWhenLogged).toBe(1);
    for (const secret of ['SECRET-ACCESS', 'SECRET-REFRESH', '424242', '987654321', 'Secret run']) expect(text).not.toContain(secret);
  });

  it('logs a connection from before the consent log (null consent) without failing', async () => {
    const { tables } = setup({ tokens: [token({ consent_version: null, consented_at: null })] });

    await removeStravaConnection('user-1', { reason: 'deauthorized' });

    expect(tables.strava_tokens).toEqual([]);
    expect(lines.join('\n')).toContain('user-1');
  });

  it('a database error is thrown with its code only', async () => {
    setup({
      runs: [run({ id: 'a', external_id: '987654321' })],
      options: { failWhen: (q) => (q.table === 'strava_tokens' && q.mutation === undefined ? ({ message: 'x 424242', code: '42501' } as never) : null) },
    });

    const failure = await removeStravaConnection('user-1', { reason: 'deauthorized' }).catch((error: Error & { code?: string }) => error);

    expect((failure as Error & { code?: string }).code).toBe('42501');
    expect((failure as Error).message).not.toContain('424242');
    expect(lines.join('\n')).not.toContain('424242');
  });

  it('refuses an empty user id before touching anything', async () => {
    const { db } = setup({ runs: [run({ id: 'a' })] });

    await expect(removeStravaConnection('', { reason: 'deauthorized' })).rejects.toThrow(TypeError);

    expect(db.queries).toHaveLength(0);
  });
});
