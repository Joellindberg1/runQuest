/**
 * What the Strava import accepts, as behaviour: which activities become runs, the distance limit, the treadmill flag, the lookback
 * window and the order weather -> totals -> event qualification. The values come from packages/shared/src/rules.ts;
 * strava-import-rules-single-source.test.ts proves the import reads them from there.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

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
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { checkEventQualification } from '../../services/eventService.js';
import { WeatherService } from '../../services/weatherService.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const activity = (id: number, over: Record<string, unknown> = {}) => ({
  id, type: 'Run', sport_type: 'Run', distance: 5000, moving_time: 1500, start_date_local: '2026-10-01T07:00:00Z', trainer: false, ...over,
});

let listUrls: string[];
/** Strava's API: the activity list answers with `activities`; the detail calls fail (the code falls back on the summary). */
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
    strava_tokens: [{ user_id: 'user-1', ...tokenCols('user-1', 'at', 'rt'), expires_at: 9999999999, connection_date: '2026-09-01' }],
    runs,
    user_boosts: [],
  };
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return tables;
}

const sync = () => server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: 'group-1' }) });
const importedIds = (tables: Record<string, Row[]>) => tables.runs.map((run) => run.external_id).sort();

describe('Strava import — which activities become runs', () => {
  it('imports Run, TrailRun and VirtualRun and skips other sports', async () => {
    stubStrava([
      activity(1, { sport_type: 'Run' }),
      activity(2, { sport_type: 'TrailRun' }),
      activity(3, { sport_type: 'VirtualRun' }),
      activity(4, { type: 'Ride', sport_type: 'Ride' }),
      activity(5, { type: 'Walk', sport_type: 'Walk' }),
    ]);
    const tables = use();

    const res = await sync();

    expect(res.status).toBe(200);
    expect(importedIds(tables)).toEqual(['1', '2', '3']);
  });

  it('an activity without sport_type counts as a run only when its type is Run', async () => {
    stubStrava([activity(1, { sport_type: undefined, type: 'Run' }), activity(2, { sport_type: undefined, type: 'TrailRun' })]);
    const tables = use();

    await sync();

    expect(importedIds(tables)).toEqual(['1']);
  });
});

describe('Strava import — distance', () => {
  it('saves any run longer than zero and skips an activity with distance 0', async () => {
    stubStrava([activity(1, { distance: 0 }), activity(2, { distance: 10 }), activity(3, { distance: 400 })]);
    const tables = use();

    await sync();

    expect(importedIds(tables)).toEqual(['2', '3']);
    expect(tables.runs.find((run) => run.external_id === '2')?.distance).toBeCloseTo(0.01);
  });
});

describe('Strava import — treadmill', () => {
  it('marks a run as treadmill when Strava sets the trainer flag', async () => {
    stubStrava([activity(1, { trainer: true }), activity(2, { trainer: false })]);
    const tables = use();

    await sync();

    expect(tables.runs.find((run) => run.external_id === '1')?.is_treadmill).toBe(true);
    expect(tables.runs.find((run) => run.external_id === '2')?.is_treadmill).toBe(false);
    expect(vi.mocked(checkEventQualification).mock.calls.map(([args]) => [args.runDate, args.isTreadmill])).toEqual([['2026-10-01', true], ['2026-10-01', false]]);
  });
});

describe('Strava import — lookback window', () => {
  it('asks Strava from Stockholm midnight seven days before the most recent imported run', async () => {
    stubStrava([]);
    use([{ id: 'r', user_id: 'user-1', source: 'strava', external_id: '900', date: '2026-10-10', distance: 5, xp_gained: 10, streak_day: 1 }]);

    await sync();

    const after = Number(new URL(listUrls[0]).searchParams.get('after'));
    expect(new Date(after * 1000).toISOString()).toBe('2026-10-02T22:00:00.000Z'); // 2026-10-03 00:00 Stockholm (summer time)
  });
});

describe('Strava import — order after saving', () => {
  it('fetches weather before the totals, and event qualification carries no run-date window', async () => {
    stubStrava([activity(1)]);
    use();

    await sync();

    const weatherAt = vi.mocked(WeatherService.fetchAndSaveWeatherForRuns).mock.invocationCallOrder[0];
    const totalsAt = vi.mocked(calculateUserTotals).mock.invocationCallOrder[0];
    expect(weatherAt).toBeLessThan(totalsAt);
    expect(vi.mocked(checkEventQualification)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkEventQualification).mock.calls[0][0]).not.toHaveProperty('enforceRunDateWindow');
  });
});
