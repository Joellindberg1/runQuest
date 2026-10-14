/**
 * Every Strava call from the routes passes the one central fetch path (stravaFetch), where the rate-budget hook sits (ADR 010 decision 7).
 * A route that called fetch directly would be invisible to the hook; each test compares the requests Strava received (fakeStrava)
 * with the requests the hook saw.
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

import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { setStravaRequestHooks } from '../../services/stravaClient.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import {
  installFakeStravaFetch,
  stravaActivity,
  stravaAthlete,
  stravaTokenResponse,
  type FakeStrava,
} from '../../test-utils/fakeStrava.js';

let server: TestServer;
let strava: FakeStrava | undefined;
let restoreHooks: (() => void) | undefined;
let hookedBefore: string[];
let hookedAfter: Array<{ url: string; status: number }>;

beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  hookedBefore = [];
  hookedAfter = [];
  restoreHooks = setStravaRequestHooks({
    before: (url) => { hookedBefore.push(url); },
    after: (url, response) => { hookedAfter.push({ url, status: response.status }); },
  });
});
afterEach(() => {
  restoreHooks?.();
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01', users: { name: 'Test' } };

function use(tables: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { strava_tokens: [{ ...TOKEN_ROW }], runs: [], user_boosts: [], users: [{ id: 'user-1', is_admin: true }], ...tables };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(t, { autoIds: true, primaryKeys: { strava_tokens: ['user_id'] } }).client as any);
  return t;
}

const userToken = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });

/** What Strava received is exactly what the hook saw, before and after, and it is not nothing. */
function expectEveryRequestHooked() {
  const received = strava!.requests.map((request) => request.url);
  expect(received.length).toBeGreaterThan(0);
  expect(hookedBefore).toEqual(received);
  expect(hookedAfter.map((entry) => entry.url)).toEqual(received);
}

describe('Strava calls from the routes pass the central fetch path', () => {
  it('the callback code exchange', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ athlete: stravaAthlete() }) });
    use({ strava_tokens: [] });

    const res = await server.request('POST', '/api/strava/callback', { token: userToken(), body: { code: 'the-code', consent_version: STRAVA_CONSENT_VERSION } });

    expect(res.status).toBe(200);
    expect(strava.calls.oauthToken).toBe(1);
    expectEveryRequestHooked();
  });

  it('the sync: token refresh, activity list and detail calls', async () => {
    const activity = stravaActivity({ id: 8001 });
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at' }), athleteActivities: [activity], activities: { 8001: activity } });
    use({ strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] });

    const res = await server.request('POST', '/api/strava/sync', { token: userToken() });

    expect(res.status).toBe(200);
    expect(strava.calls).toMatchObject({ oauthToken: 1, athleteActivities: 1, activity: 1 });
    expectEveryRequestHooked();
  });

  it('GET /status refreshing an expired token', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
    use({ strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] });

    const res = await server.request('GET', '/api/strava/status', { token: userToken() });

    expect(res.body).toMatchObject({ connected: true, auto_refreshed: true });
    expectEveryRequestHooked();
  });

  it('the debug listing', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [stravaActivity({ id: 8002 })] });
    use();

    const res = await server.request('GET', '/api/strava/debug-activities', { token: userToken() });

    expect(res.status).toBe(200);
    expectEveryRequestHooked();
  });

  it('the extended-fields backfill: token refresh and detail calls', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at' }), activities: { 8003: stravaActivity({ id: 8003 }) } });
    use({
      strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }],
      runs: [{ id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '8003', date: '2026-10-01', distance: 5, xp_gained: 20 }],
    });
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, ms && ms >= 1000 ? 0 : ms)) as typeof setTimeout);

    const res = await server.request('POST', '/api/strava/backfill-extended', { token: userToken() });

    expect(res.body).toMatchObject({ success: true, totalUpdated: 1 });
    expect(strava.calls).toMatchObject({ oauthToken: 1, activity: 1 });
    expectEveryRequestHooked();
  });
});
