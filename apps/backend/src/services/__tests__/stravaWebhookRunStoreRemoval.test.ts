/**
 * Coupling test: RunStore.removeStravaRun of the Supabase adapter (stravaWebhook/supabaseAdapters.ts) is the one deletion query of
 * services/stravaRemoval.ts, not a second one. The rules of the query itself are in stravaRemoval.test.ts.
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
import { createRunStore } from '../stravaWebhook/supabaseAdapters.js';

const run = (over: Row = {}): Row => ({ id: 'r', user_id: 'user-1', source: 'strava', external_id: '9001', date: '2026-10-10', distance: 5, ...over });

function useDb(runs: Row[], options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = { runs };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables, db };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

describe('Supabase run store removal', () => {
  it('deletes the Strava run of (user, external id) with one query and reports the date', async () => {
    const { tables, db } = useDb([
      run({ id: 'mine' }),
      run({ id: 'other-activity', external_id: '9002' }),
      run({ id: 'other-user', user_id: 'user-2' }),
      run({ id: 'manual', source: 'manual' }),
    ]);

    const result = await createRunStore().removeStravaRun('user-1', '9001');

    expect(result).toEqual({ removed: true, date: '2026-10-10' });
    expect(tables.runs.map((r) => r.id).sort()).toEqual(['manual', 'other-activity', 'other-user']);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].filters).toEqual([
      { op: 'eq', column: 'user_id', value: 'user-1' },
      { op: 'eq', column: 'source', value: 'strava' },
      { op: 'eq', column: 'external_id', value: '9001' },
    ]);
  });

  it('reports that nothing was removed when there is no such Strava run', async () => {
    useDb([run({ id: 'manual', source: 'manual' })]);
    await expect(createRunStore().removeStravaRun('user-1', '9001')).resolves.toEqual({ removed: false, date: null });
  });

  it('does no recalculation of its own: that is the worker\'s', async () => {
    useDb([run()]);
    await createRunStore().removeStravaRun('user-1', '9001');
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('throws on a database error', async () => {
    useDb([run()], { failWhen: (q) => (q.mutation === 'delete' ? ({ message: 'db down', code: '57P01' } as never) : null) });
    await expect(createRunStore().removeStravaRun('user-1', '9001')).rejects.toMatchObject({ code: '57P01' });
  });
});
