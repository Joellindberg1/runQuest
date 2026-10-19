/**
 * Endpoints that were removed as unused and unsafe stay gone: an authenticated caller gets the app's ordinary 404, not a handler.
 * The titles refresh without an id (admin, used by the frontend) is a different route and must keep working.
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

const { mockRefreshTitleLeaderboard, mockPopulateTitleLeaderboard } = vi.hoisted(() => ({
  mockRefreshTitleLeaderboard: vi.fn(),
  mockPopulateTitleLeaderboard: vi.fn(),
}));
vi.mock('../../services/titleLeaderboardService', () => ({
  titleLeaderboardService: {
    refreshTitleLeaderboard: mockRefreshTitleLeaderboard,
    populateTitleLeaderboard: mockPopulateTitleLeaderboard,
  },
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { installFakeStravaFetch, type FakeStrava } from '../../test-utils/fakeStrava.js';

let server: TestServer;
let strava: FakeStrava;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  const db = createFakeDb(
    { strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, connection_date: '2026-09-01' }], runs: [], users: [{ id: 'user-1', is_admin: true }, { id: 'user-2', is_admin: false }] },
    { autoIds: true },
  );
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  strava = installFakeStravaFetch({});
});
afterEach(() => {
  strava.restore();
  vi.restoreAllMocks();
});

const token = () => mintToken({ user_id: 'user-1', group_id: 'group-1' });

describe('removed endpoints', () => {
  it('removed endpoints return 404', async () => {
    const debugActivities = await server.request('GET', '/api/strava/debug-activities', { token: token() });
    const refreshOneTitle = await server.request('POST', '/api/titles/refresh/some-title', { token: token() });

    expect(debugActivities.status).toBe(404);
    expect(refreshOneTitle.status).toBe(404);
    expect(strava.requests).toHaveLength(0);
    expect(mockRefreshTitleLeaderboard).not.toHaveBeenCalled();
  });

  it('POST /api/auth/refresh returns 404', async () => {
    const res = await server.request('POST', '/api/auth/refresh', { token: token() });

    expect(res.status).toBe(404);
  });

  it('the API info does not list a token refresh endpoint', async () => {
    const res = await server.request('GET', '/api');

    expect(res.status).toBe(200);
    expect(res.body.endpoints.auth).toEqual({ login: '/api/auth/login' });
  });

  it('the refresh of all title leaderboards is refused for a user who is not an admin', async () => {
    const res = await server.request('POST', '/api/titles/refresh', { token: mintToken({ user_id: 'user-2', group_id: 'group-1' }) });

    expect(res.status).toBe(403);
    expect(mockPopulateTitleLeaderboard).not.toHaveBeenCalled();
    expect(mockRefreshTitleLeaderboard).not.toHaveBeenCalled();
  });

  it('the admin refresh of all title leaderboards still works', async () => {
    const res = await server.request('POST', '/api/titles/refresh', { token: token() });

    expect(res.status).toBe(200);
    expect(mockPopulateTitleLeaderboard).toHaveBeenCalledTimes(1);
    expect(mockPopulateTitleLeaderboard).toHaveBeenCalledWith('group-1');
  });
});
