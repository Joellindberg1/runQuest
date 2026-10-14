/**
 * DELETE /api/strava/disconnect is rate limited (10 per minute and IP), after the sign-in check: a request without a token is
 * turned away with 401 and never uses the budget. Its own file because the limiter's counter lives as long as the module, and the
 * real limiter is the point here (strava-disconnect.test.ts replaces it with a pass-through).
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
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { installFakeStravaFetch, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
let strava: FakeStrava | undefined;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  strava?.restore();
  strava = undefined;
});

describe('DELETE /api/strava/disconnect rate limit', () => {
  it('answers 401 without a token and without using the budget, and 429 on the 11th signed-in call', async () => {
    const tables = {
      strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9_999_999_999, connection_date: '2026-09-01', consent_version: '2026-10-14', consented_at: '2026-10-14T09:30:00.000Z' }],
      runs: [],
    };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] } }).client as any);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'at' } });
    const token = mintToken({ user_id: 'user-1', group_id: 'group-1' });

    for (let i = 0; i < 15; i++) {
      expect((await server.request('DELETE', '/api/strava/disconnect')).status).toBe(401);
    }

    for (let i = 1; i <= 10; i++) {
      const res = await server.request('DELETE', '/api/strava/disconnect', { token });
      expect(res.status, `call ${i}`).toBe(200); // the first does the work, the rest are idempotent
    }

    const eleventh = await server.request('DELETE', '/api/strava/disconnect', { token });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual({ error: 'Too many attempts, try again later' });
    expect(strava.calls.oauthDeauthorize).toBe(1); // only the first call had a connection to revoke
  });
});
