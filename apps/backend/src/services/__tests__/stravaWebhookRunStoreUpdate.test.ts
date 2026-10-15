/**
 * RunStore.updateStravaRun of the Supabase adapter and of the in-memory store: the one write path of the update handler.
 * The rules of WHAT differs are decideAction's (stravaDecideAction.test.ts); here is how the write is made and what it refuses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../routes/runs.js', () => ({ reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../weatherService.js', () => ({ WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../eventService.js', () => ({ checkEventQualification: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseClient } from '../../config/database.js';
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryRunStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { extractExtendedFields } from '../stravaImport.js';
import { assertUpdatableRunPatch, UPDATABLE_RUN_COLUMNS } from '../stravaWebhook/runPatch.js';
import { createRunStore } from '../stravaWebhook/supabaseAdapters.js';
import { stravaActivity } from '../../test-utils/fakeStrava.js';

const XP_COLUMNS = ['xp_gained', 'base_xp', 'km_xp', 'distance_bonus', 'streak_bonus', 'multiplier', 'streak_day'];
const run = (over: Row = {}): Row => ({
  id: 'r', user_id: 'user-1', source: 'strava', external_id: '9001', date: '2026-10-10', distance: 5, xp_gained: 20, streak_day: 3, base_xp: 20, ...over,
});

function useDb(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

describe('Supabase run store update', () => {
  it('updates the Strava run of (user, external id) with the patch and reports the date it had', async () => {
    const tables = {
      runs: [run(), run({ id: 'other-activity', external_id: '9002' }), run({ id: 'other-user', user_id: 'user-2' }), run({ id: 'manual', source: 'manual' })],
    };
    useDb(tables);

    const result = await createRunStore().updateStravaRun('user-1', '9001', { distance: 8, date: '2026-10-11', total_elevation_gain: 40 });

    expect(result).toEqual({ updated: true, previousDate: '2026-10-10' });
    expect(tables.runs.find((r) => r.id === 'r')).toMatchObject({ distance: 8, date: '2026-10-11', total_elevation_gain: 40 });
    for (const untouched of ['other-activity', 'other-user', 'manual']) expect(tables.runs.find((r) => r.id === untouched)).toMatchObject({ distance: 5, date: '2026-10-10' });
  });

  it('writes no XP or streak column and does no recalculation of its own', async () => {
    const tables = { runs: [run()] };
    useDb(tables);

    await createRunStore().updateStravaRun('user-1', '9001', { distance: 8 });

    expect(tables.runs[0]).toMatchObject({ xp_gained: 20, base_xp: 20, streak_day: 3 });
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('only ever touches a run whose source is strava', async () => {
    const tables = { runs: [run({ source: 'manual' })] };
    const db = useDb(tables);

    const result = await createRunStore().updateStravaRun('user-1', '9001', { distance: 8 }, { clearWeather: true });

    expect(result).toEqual({ updated: false, previousDate: null });
    expect(tables.runs[0].distance).toBe(5);
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });

  it.each([...XP_COLUMNS, 'user_id', 'id', 'source', 'external_id', 'created_at', 'unknown_column'])(
    'refuses a patch that contains %s, before anything is read or written',
    async (column) => {
      const tables = { runs: [run()], run_weather: [{ run_id: 'r' }] };
      const db = useDb(tables);

      await expect(createRunStore().updateStravaRun('user-1', '9001', { distance: 8, [column]: 99 } as never, { clearWeather: true })).rejects.toMatchObject({
        code: 'run_patch_forbidden_column',
      });

      expect(db.queries).toEqual([]);
      expect(tables.runs[0]).toMatchObject({ distance: 5 });
      expect(tables.run_weather).toHaveLength(1);
    },
  );

  it('names only the column in the error, never a value', async () => {
    useDb({ runs: [run()] });
    const error = await createRunStore().updateStravaRun('user-1', '9001', { xp_gained: 123456 } as never).catch((e: Error) => e);
    expect((error as Error).message).toContain('xp_gained');
    expect((error as Error).message).not.toContain('123456');
  });

  it('accepts every column the decision can produce: date, distance and each extended field', () => {
    const everything = { date: '2026-10-10', distance: 5, ...extractExtendedFields({}) };
    expect(Object.keys(assertUpdatableRunPatch(everything)).sort()).toEqual([...UPDATABLE_RUN_COLUMNS].sort());
    expect([...UPDATABLE_RUN_COLUMNS].sort()).toEqual(['date', 'distance', ...Object.keys(extractExtendedFields({}))].sort());
  });

  it('accepts every column extractExtendedFields returns for a rich activity, not only for an empty one', () => {
    const rich = stravaActivity({ id: 9001, average_heartrate: 150, max_heartrate: 180, suffer_score: 40, trainer: true, start_latlng: [59.3, 18.0] });
    const columns = Object.keys(extractExtendedFields(rich));
    expect(columns.sort()).toEqual(Object.keys(extractExtendedFields({})).sort()); // the shape does not depend on what the activity carries
    expect(() => assertUpdatableRunPatch({ date: '2026-10-10', distance: 5, ...extractExtendedFields(rich) })).not.toThrow();
    for (const column of columns) expect(UPDATABLE_RUN_COLUMNS).toContain(column);
  });

  it('builds the patch from the validated columns only and treats undefined as absent', () => {
    const hidden = Symbol('hidden');
    const patch = { distance: 8, moving_time: undefined, [hidden]: 'x' } as never;
    const checked = assertUpdatableRunPatch(patch);
    expect(checked).toEqual({ distance: 8 });
    expect(Object.getOwnPropertySymbols(checked)).toEqual([]);
    expect(checked).not.toBe(patch);
    expect(assertUpdatableRunPatch({ xp_gained: undefined } as never)).toEqual({}); // absent, not a write of the XP column
  });

  it('writes nothing for a patch whose values are all undefined', async () => {
    const db = useDb({ runs: [run()] });
    await expect(createRunStore().updateStravaRun('user-1', '9001', { distance: undefined }, { clearWeather: true })).resolves.toEqual({ updated: false, previousDate: null });
    expect(db.queries).toEqual([]);
    const memory = createInMemoryRunStore();
    await expect(memory.updateStravaRun('user-1', '9001', { distance: undefined })).resolves.toEqual({ updated: false, previousDate: null });
    expect(memory.updateCalls).toEqual([]);
  });

  it('only looks at the run of the given user, even when another user has the same external id', async () => {
    // The other user's row comes FIRST: a select without the user filter would find it (or, as PostgREST does, fail on two matches).
    const tables = { runs: [run({ id: 'other-user', user_id: 'user-2', date: '2026-01-01' }), run()] };
    useDb(tables);

    const result = await createRunStore().updateStravaRun('user-1', '9001', { distance: 8 });

    expect(result).toEqual({ updated: true, previousDate: '2026-10-10' });
    expect(tables.runs.find((r) => r.id === 'other-user')!.distance).toBe(5);
    expect(tables.runs.find((r) => r.id === 'r')!.distance).toBe(8);
  });

  it('reports updated:false when the run disappears between the read and the update', async () => {
    const tables: Record<string, Row[]> = { runs: [run()], run_weather: [] };
    const db = useDb(tables, {
      // Evaluated when the update runs, i.e. after the select found the row: another writer deleted it in between.
      failWhen: (q) => {
        if (q.table === 'runs' && q.mutation === 'update') tables.runs.splice(0);
        return null;
      },
    });

    const result = await createRunStore().updateStravaRun('user-1', '9001', { distance: 8 });

    expect(result).toEqual({ updated: false, previousDate: '2026-10-10' });
    expect(db.queries.filter((q) => q.mutation === 'update')).toHaveLength(1);
  });

  it('deletes the weather row of the run before the update, when asked', async () => {
    const tables = { runs: [run(), run({ id: 'r2', external_id: '9002' })], run_weather: [{ run_id: 'r', temperature_c: 9 }, { run_id: 'r2', temperature_c: 7 }] };
    const db = useDb(tables);

    await createRunStore().updateStravaRun('user-1', '9001', { start_lat: 60 }, { clearWeather: true });

    expect(tables.run_weather).toEqual([{ run_id: 'r2', temperature_c: 7 }]);
    expect(db.queries.filter((q) => q.mutation).map((q) => `${q.table}:${q.mutation}`)).toEqual(['run_weather:delete', 'runs:update']);
  });

  it('keeps the weather row when not asked to clear it', async () => {
    const tables = { runs: [run()], run_weather: [{ run_id: 'r', temperature_c: 9 }] };
    useDb(tables);

    await createRunStore().updateStravaRun('user-1', '9001', { distance: 8 });
    await createRunStore().updateStravaRun('user-1', '9001', { distance: 9 }, { clearWeather: false });

    expect(tables.run_weather).toHaveLength(1);
  });

  it('writes nothing for an empty patch', async () => {
    const db = useDb({ runs: [run()] });
    await expect(createRunStore().updateStravaRun('user-1', '9001', {}, { clearWeather: true })).resolves.toEqual({ updated: false, previousDate: null });
    expect(db.queries).toEqual([]);
  });

  it('reports that nothing was updated when there is no such Strava run', async () => {
    const tables = { runs: [] as Row[], run_weather: [{ run_id: 'r' }] };
    const db = useDb(tables);
    await expect(createRunStore().updateStravaRun('user-1', '9001', { distance: 8 }, { clearWeather: true })).resolves.toEqual({ updated: false, previousDate: null });
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });

  it('throws with the database error code on a failed update, a failed weather delete or a failed read', async () => {
    for (const failing of ['update', 'delete', 'select'] as const) {
      useDb({ runs: [run()], run_weather: [{ run_id: 'r' }] }, {
        failWhen: (q) => ((failing === 'select' ? !q.mutation && q.table === 'runs' : q.mutation === failing) ? ({ message: 'secret 5.2 km', code: '57P01' } as never) : null),
      });
      const error = await createRunStore().updateStravaRun('user-1', '9001', { distance: 8 }, { clearWeather: true }).catch((e: Error) => e);
      expect(error, failing).toMatchObject({ code: '57P01' });
      expect((error as Error).message, failing).not.toContain('secret');
    }
  });

  it('does not touch the run when the weather row cannot be deleted', async () => {
    const tables = { runs: [run()], run_weather: [{ run_id: 'r' }] };
    useDb(tables, { failWhen: (q) => (q.table === 'run_weather' && q.mutation === 'delete' ? ({ message: 'down', code: '57P01' } as never) : null) });

    await expect(createRunStore().updateStravaRun('user-1', '9001', { distance: 8 }, { clearWeather: true })).rejects.toMatchObject({ code: '57P01' });

    expect(tables.runs[0].distance).toBe(5); // the retry finds the run still differing and clears again
  });
});

describe('in-memory run store update', () => {
  const seeded = () => {
    const store = createInMemoryRunStore();
    store.runs.push({ userId: 'user-1', externalId: '9001', date: '2026-10-10', run: { source: 'strava', date: '2026-10-10', distance: 5 } as never });
    return store;
  };

  it('applies the patch to a Strava run and reports the previous date', async () => {
    const store = seeded();
    const result = await store.updateStravaRun('user-1', '9001', { distance: 8, date: '2026-10-12' }, { clearWeather: true });

    expect(result).toEqual({ updated: true, previousDate: '2026-10-10' });
    expect(store.runs[0]).toMatchObject({ date: '2026-10-12', run: { distance: 8, date: '2026-10-12' } });
    expect(store.updateCalls).toEqual([{ userId: 'user-1', externalId: '9001', patch: { distance: 8, date: '2026-10-12' }, clearWeather: true }]);
  });

  it('refuses the same columns as the Supabase store', async () => {
    const store = seeded();
    await expect(store.updateStravaRun('user-1', '9001', { xp_gained: 1 } as never)).rejects.toMatchObject({ code: 'run_patch_forbidden_column' });
    expect(store.updateCalls).toEqual([]);
    expect(store.runs[0].run).toMatchObject({ distance: 5 });
  });

  it('leaves a manual run alone', async () => {
    const store = createInMemoryRunStore();
    store.runs.push({ userId: 'user-1', externalId: '9001', date: '2026-10-10', run: { source: 'manual', date: '2026-10-10', distance: 5 } as never });
    await expect(store.updateStravaRun('user-1', '9001', { distance: 8 })).resolves.toEqual({ updated: false, previousDate: null });
    expect(store.runs[0].run).toMatchObject({ distance: 5 });
  });
});
