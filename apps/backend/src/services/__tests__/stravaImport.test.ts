/**
 * The shared Strava import (ADR 010 decision 7): the same activity becomes the same row whether polling or the webhook worker
 * imports it. Database: createFakeDb with the real unique index on (user_id, external_id). Network: installFakeStravaFetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaActivity, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { buildStravaRunRow, exceedsImportDistance, importStravaActivity, isRunningActivity } from '../stravaImport.js';

let strava: FakeStrava | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

function use(runs: Row[] = [], options: { failInsert?: boolean } = {}) {
  const t: Record<string, Row[]> = { runs };
  const db = createFakeDb(t, {
    autoIds: true,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    failWhen: (q) => (options.failInsert && q.table === 'runs' && q.mutation === 'insert' ? { message: 'insert failed' } : null),
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

describe('importStravaActivity', () => {
  it('importStravaActivity is idempotent on duplicate external_id (23505 is not an error)', async () => {
    const activity = stravaActivity({ id: 4001 });
    strava = installFakeStravaFetch({ activities: { 4001: activity } });
    const tables = use();

    const first = await importStravaActivity('user-1', activity, 'at');
    const second = await importStravaActivity('user-1', activity, 'at');

    expect(first).toMatchObject({ status: 'imported', run: { external_id: '4001' } });
    expect(second).toEqual({ status: 'exists' });
    expect(tables.runs).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('writes the row with placeholder xp and fields from the detailed activity', async () => {
    const summary = stravaActivity({ id: 4002, splits_metric: [] });
    const detailed = stravaActivity({ id: 4002, suffer_score: 17 });
    strava = installFakeStravaFetch({ activities: { 4002: detailed } });
    const tables = use();

    await importStravaActivity('user-1', summary, 'at');

    expect(tables.runs[0]).toMatchObject({
      user_id: 'user-1', source: 'strava', external_id: '4002', date: '2026-10-12', distance: 5, start_time: '2026-10-12T07:30:00Z',
      suffer_score: 17, xp_gained: 0, base_xp: 0, km_xp: 0, distance_bonus: 0, streak_bonus: 0, multiplier: 1, streak_day: 1,
    });
  });

  it('inserts exactly the row buildStravaRunRow builds, with no column of its own', async () => {
    const summary = stravaActivity({ id: 4005, splits_metric: [] });
    const detailed = stravaActivity({ id: 4005, average_heartrate: 151, suffer_score: 9 });
    strava = installFakeStravaFetch({ activities: { 4005: detailed } });
    const tables = use();

    await importStravaActivity('user-1', summary, 'at');

    const { id: _generatedId, ...stored } = tables.runs[0];
    expect(stored).toEqual({ ...buildStravaRunRow('user-1', summary, detailed), created_at: expect.any(String) });
  });

  it('falls back to the summary when the detail call fails', async () => {
    const summary = stravaActivity({ id: 4003, average_heartrate: 144 });
    strava = installFakeStravaFetch({ activities: {} }); // 404 for every id
    const tables = use();

    const result = await importStravaActivity('user-1', summary, 'at');

    expect(result).toMatchObject({ status: 'imported' });
    expect(tables.runs[0]).toMatchObject({ external_id: '4003', avg_heartrate: 144 });
  });

  it('rejects, logging the failed fields, on any other database error', async () => {
    const activity = stravaActivity({ id: 4004 });
    strava = installFakeStravaFetch({ activities: { 4004: activity } });
    use([], { failInsert: true });

    await expect(importStravaActivity('user-1', activity, 'at')).rejects.toMatchObject({ message: 'insert failed' });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('the import rules', () => {
  it('isRunningActivity prefers sport_type and falls back to the legacy type', () => {
    expect(isRunningActivity({ sport_type: 'TrailRun', type: 'Run' })).toBe(true);
    expect(isRunningActivity({ sport_type: 'Ride', type: 'Run' })).toBe(false);
    expect(isRunningActivity({ type: 'Run' })).toBe(true);
    expect(isRunningActivity({ type: 'Ride' })).toBe(false);
  });

  it('exceedsImportDistance requires more than zero distance', () => {
    expect(exceedsImportDistance({ distance: 0 })).toBe(false);
    expect(exceedsImportDistance({ distance: 10 })).toBe(true);
  });

  it('buildStravaRunRow keeps the local start date and nulls what Strava did not send', () => {
    const row = buildStravaRunRow('user-1', { id: 9, distance: 4200, start_date_local: '2026-10-12T00:30:00Z', sport_type: 'Run' });

    expect(row).toMatchObject({ user_id: 'user-1', source: 'strava', external_id: '9', date: '2026-10-12', distance: 4.2, start_time: '2026-10-12T00:30:00Z', avg_heartrate: null, pace_std_dev: null });
  });
});
