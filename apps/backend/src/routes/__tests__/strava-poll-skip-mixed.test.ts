/**
 * The polling with a mix of results in one list: an activity the detail call says is gone (skipped), one that another import
 * inserted first (exists) and one that is new (imported). A skip is neither a failure nor a reason to recalculate further back.
 * Database: createFakeDb. Network: installFakeStravaFetch. Mocked at the edge: reprocessRunsFromDate (asserted as a call),
 * calculateUserTotals, event qualification, weather and the XP configuration.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../runs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs.js')>()),
  reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { reprocessRunsFromDate } from '../runs.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { installFakeStravaFetch, stravaActivity, type FakeStrava } from '../../test-utils/fakeStrava.js';

let server: TestServer;
let strava: FakeStrava | undefined;
let errorLines: string[];
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  errorLines = [];
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation((...args: unknown[]) => { errorLines.push(args.map(String).join(' ')); });
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01' };
const on = (day: string, id: number) => stravaActivity({ id, start_date: `${day}T05:30:00Z`, start_date_local: `${day}T07:30:00Z` });

function use() {
  const t: Record<string, Row[]> = { strava_tokens: [{ ...TOKEN_ROW }], runs: [], user_boosts: [] };
  const db = createFakeDb(t, {
    autoIds: true,
    primaryKeys: { strava_tokens: ['user_id'] },
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return t;
}

const sync = () => server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });

describe('the polling with skipped, existing and new activities in one list', () => {
  it('a skip is not a failure, and the recalculation starts at the earliest day that is not a skip', async () => {
    const t = use();
    const gone = on('2026-10-05', 2001); // the earliest, but the detail call says 404
    const raced = on('2026-10-08', 2002); // another import inserts it between the list and our insert
    const fresh = on('2026-10-10', 2003);
    strava = installFakeStravaFetch({
      athleteActivities: [gone, raced, fresh],
      activities: {
        2002: () => {
          t.runs.push({ id: 'run-raced', user_id: 'user-1', source: 'strava', external_id: '2002', date: '2026-10-08', distance: 5, xp_gained: 30, streak_day: 1 });
          return raced;
        },
        2003: fresh,
      },
    });

    const res = await sync();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 1, totalActivities: 3 });
    expect(t.runs.map((run) => run.external_id).sort()).toEqual(['2002', '2003']); // the gone one was never written
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-10-08'); // not the skipped 2026-10-05, not only the new 2026-10-10
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(errorLines).toEqual([]); // no "failed to insert" for the skip
  });

  it('a list where every activity is skipped recalculates nothing and still succeeds', async () => {
    const t = use();
    strava = installFakeStravaFetch({ athleteActivities: [on('2026-10-05', 2001), on('2026-10-06', 2004)], activities: {} });

    const res = await sync();

    expect(res.body).toMatchObject({ success: true, newRuns: 0, totalActivities: 2 });
    expect(t.runs).toEqual([]);
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(errorLines).toEqual([]);
  });
});
