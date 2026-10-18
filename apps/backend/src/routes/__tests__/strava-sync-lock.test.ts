/**
 * The Strava sync is serialised per user by the keyed mutex (ADR 010 decision 6), whichever way it is started: the manual
 * POST /api/strava/sync or the scheduled polling (syncAllStravaUsers). Different users never wait for each other.
 *
 * Database: createFakeDb. Network: installFakeStravaFetch, wrapped so a test can hold a user's Strava list call open and see
 * what else reaches Strava meanwhile.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

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
import { plainRow, tokenCols } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { syncAllStravaUsers } from '../strava.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { installFakeStravaFetch, stravaActivity, type FakeStrava } from '../../test-utils/fakeStrava.js';

let server: TestServer;
let strava: FakeStrava | undefined;
let releaseAll: (() => void) | undefined;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  releaseAll?.(); // a failed assertion must not leave a request hanging, or afterAll's server.close() never returns
  releaseAll = undefined;
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

type UserId = 'user-1' | 'user-2';
const accessTokenOf = (userId: UserId) => `at-${userId}`;
const activityOf: Record<UserId, ReturnType<typeof stravaActivity>> = {
  'user-1': stravaActivity({ id: 4001 }),
  'user-2': stravaActivity({ id: 4002 }),
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * Fake Strava + fake database for two connected users. `hold` keeps a user's activity list call open until the returned
 * `release` is called; `listCalls` records the order in which list calls reached Strava and how many were open at once.
 */
function setup(hold: UserId[] = []) {
  const tables: Record<string, Row[]> = {
    strava_tokens: (['user-1', 'user-2'] as UserId[]).map((userId) => ({
      user_id: userId,
      ...tokenCols(userId, accessTokenOf(userId), `rt-${userId}`),
      expires_at: 9999999999,
      connection_date: '2026-09-01',
      sync_paused: false,
      users: { name: userId },
    })),
    runs: [],
    user_boosts: [],
    users: [{ id: 'user-1', is_admin: false }, { id: 'user-2', is_admin: false }],
  };
  vi.mocked(getSupabaseClient).mockReturnValue(
    createFakeDb(tables, {
      autoIds: true,
      uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
      primaryKeys: { strava_tokens: ['user_id'] },
    }).client as any,
  );

  const fake = installFakeStravaFetch({
    athleteActivities: (call) => [call.headers.authorization === `Bearer ${accessTokenOf('user-2')}` ? activityOf['user-2'] : activityOf['user-1']],
    activities: { 4001: activityOf['user-1'], 4002: activityOf['user-2'] },
  });
  strava = fake;

  const gates = new Map(hold.map((userId) => [userId, deferred()]));
  releaseAll = () => gates.forEach((gate) => gate.resolve());
  const listCalls = { order: [] as UserId[], open: 0, maxOpen: 0 };
  const stubbed = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/athlete/activities')) return stubbed(input, init);
    const userId: UserId = new Headers(init?.headers).get('authorization') === `Bearer ${accessTokenOf('user-2')}` ? 'user-2' : 'user-1';
    listCalls.order.push(userId);
    listCalls.open += 1;
    listCalls.maxOpen = Math.max(listCalls.maxOpen, listCalls.open);
    try {
      await gates.get(userId)?.promise;
      return await stubbed(input, init);
    } finally {
      listCalls.open -= 1;
    }
  }) as typeof fetch;

  return {
    tables,
    listCalls,
    fake,
    release: (userId: UserId) => gates.get(userId)?.resolve(),
  };
}

const manualSync = (userId: UserId) => server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: userId, group_id: 'group-1' }) });
// A negative ("has not reached Strava") can only be asserted after giving the competing sync time to get there.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 100));

describe('Strava sync lock', () => {
  it('manual sync and scheduled sync for the same user never overlap', async () => {
    const { tables, listCalls, release } = setup(['user-1']);

    const manual = manualSync('user-1');
    await vi.waitFor(() => expect(listCalls.order).toEqual(['user-1']));

    // The scheduled polling starts while the manual sync is still waiting on Strava.
    const scheduled = syncAllStravaUsers();
    await settle();
    expect(listCalls.order).toEqual(['user-1']); // the scheduled sync of this user has not reached Strava
    release('user-1');

    const manualResult = await manual;
    const scheduledResult = await scheduled;

    expect(listCalls.maxOpen).toBe(1);
    expect(manualResult.body).toMatchObject({ success: true, newRuns: 1 });
    // It ran after the manual sync finished, so it saw the run the manual sync imported instead of importing it twice.
    expect(scheduledResult.results.find((r) => r.userId === 'user-1')).toMatchObject({ newRuns: 0 });
    expect(tables.runs.filter((run) => run.user_id === 'user-1')).toHaveLength(1);
  });

  it('sync for one user does not wait for the sync of another user', async () => {
    const { tables, listCalls, release } = setup(['user-1']);

    let user1Done = false;
    const user1 = manualSync('user-1').then((res) => { user1Done = true; return res; });
    await vi.waitFor(() => expect(listCalls.order).toEqual(['user-1']));

    const user2 = await manualSync('user-2');

    expect(user2.body).toMatchObject({ success: true, newRuns: 1 });
    expect(user1Done).toBe(false); // user-1 is still held open at Strava
    expect(tables.runs.map((run) => run.user_id)).toEqual(['user-2']);

    release('user-1');
    expect((await user1).body).toMatchObject({ success: true, newRuns: 1 });
    expect(listCalls.order).toEqual(['user-1', 'user-2']);
  });
});
