/**
 * The backend reads the Strava rules from packages/shared/src/rules.ts and has no copy of its own. Every constant is replaced here by
 * a value no code has ever hard-coded; if a route, the lookback or the validation still uses a literal, the behaviour does not follow
 * and the test fails. (The real values are covered by strava-import-rules.test.ts and by rules.test.ts in shared.)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('@runquest/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@runquest/shared')>()),
  STRAVA_RUN_SPORT_TYPES: ['Kayaking', 'Rowing'],
  STRAVA_LEGACY_RUN_TYPE: 'Hike',
  STRAVA_DISTANCE_MUST_EXCEED_KM: 2,
  STRAVA_TREADMILL_FLAG: 'indoor',
  STRAVA_LOOKBACK_BUFFER_DAYS: 3,
  MANUAL_RUN_MIN_DISTANCE_KM: 2.5,
}));
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
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
import { checkEventQualification } from '../../services/eventService.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const activity = (id: number, over: Record<string, unknown> = {}) => ({
  id, type: 'Kayaking', sport_type: 'Kayaking', distance: 5000, moving_time: 1500, start_date_local: '2026-10-01T07:00:00Z', trainer: false, ...over,
});

let listUrls: string[];
function stubStrava(activities: unknown[]) {
  listUrls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/athlete/activities')) {
      listUrls.push(String(url));
      return { ok: true, status: 200, json: async () => activities };
    }
    return { ok: false, status: 500, json: async () => ({}) }; // not 404: a 404 means gone and the poll skips the activity
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function use(runs: Row[] = []) {
  const tables: Record<string, Row[]> = {
    strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01' }],
    runs,
    user_boosts: [],
  };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { autoIds: true }).client as any);
  return tables;
}

const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });
const sync = () => server.request('POST', '/api/strava/sync', { token });
const importedIds = (tables: Record<string, Row[]>) => tables.runs.map((run) => run.external_id).sort();

describe('the Strava import takes its rules from shared', () => {
  it('imports exactly the sport types in STRAVA_RUN_SPORT_TYPES', async () => {
    stubStrava([activity(1, { sport_type: 'Kayaking' }), activity(2, { sport_type: 'Rowing' }), activity(3, { type: 'Run', sport_type: 'Run' })]);
    const tables = use();

    await sync();

    expect(importedIds(tables)).toEqual(['1', '2']);
  });

  it('uses STRAVA_LEGACY_RUN_TYPE for an activity without sport_type', async () => {
    stubStrava([activity(1, { sport_type: undefined, type: 'Hike' }), activity(2, { sport_type: undefined, type: 'Run' })]);
    const tables = use();

    await sync();

    expect(importedIds(tables)).toEqual(['1']);
  });

  it('skips an activity whose distance does not exceed STRAVA_DISTANCE_MUST_EXCEED_KM', async () => {
    stubStrava([activity(1, { distance: 2000 }), activity(2, { distance: 2100 })]);
    const tables = use();

    await sync();

    expect(importedIds(tables)).toEqual(['2']);
  });

  it('reads the treadmill flag named by STRAVA_TREADMILL_FLAG', async () => {
    stubStrava([activity(1, { trainer: true, indoor: false, distance: 5000 }), activity(2, { trainer: false, indoor: true, distance: 6000 })]);
    const tables = use();

    await sync();

    expect(tables.runs.find((run) => run.external_id === '1')?.is_treadmill).toBe(false);
    expect(tables.runs.find((run) => run.external_id === '2')?.is_treadmill).toBe(true);
    // Event qualification gets the same verdict as the saved row.
    const qualified = vi.mocked(checkEventQualification).mock.calls.map(([args]) => [args.distanceKm, args.isTreadmill]);
    expect(qualified).toEqual([[5, false], [6, true]]);
  });

  it('looks back STRAVA_LOOKBACK_BUFFER_DAYS before the most recent imported run', async () => {
    stubStrava([]);
    use([{ id: 'r', user_id: 'user-1', source: 'strava', external_id: '900', date: '2026-10-10', distance: 5, xp_gained: 10, streak_day: 1 }]);

    await sync();

    const after = Number(new URL(listUrls[0]).searchParams.get('after'));
    expect(new Date(after * 1000).toISOString()).toBe('2026-10-06T22:00:00.000Z'); // 2026-10-07 00:00 Stockholm
  });
});

describe('manual runs take their minimum from shared', () => {
  it('rejects a manual run shorter than MANUAL_RUN_MIN_DISTANCE_KM and accepts one at the limit', async () => {
    const tables = use();

    const tooShort = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-02', distance: 2.4 } });
    const atLimit = await server.request('POST', '/api/runs', { token, body: { date: '2026-10-02', distance: 2.5 } });

    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error).toBe('Distance must be at least 2.5 km');
    expect(atLimit.status).toBe(200);
    expect(tables.runs).toHaveLength(1);
  });
});
