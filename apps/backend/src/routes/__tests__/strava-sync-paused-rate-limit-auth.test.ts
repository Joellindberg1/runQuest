/**
 * The rate limiter of PUT /api/strava/sync-paused sits AFTER the authentication: requests that fail authentication are not
 * counted, so an unauthenticated flood from one IP cannot use up the budget of a real user behind the same IP.
 * Own file: the limiter's counter lives as long as the module.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  server = await startServer(app);
});
afterAll(async () => { await server.close(); });

describe('PUT /api/strava/sync-paused rate limit and authentication', () => {
  it('unauthenticated calls answer 401 however many there are and do not use up the budget of an authenticated call', async () => {
    const tables = { strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, sync_paused: false, paused_at: null }] };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables).client as any);

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await server.request('PUT', '/api/strava/sync-paused', { body: { paused: true } })).status);
    }
    const authenticated = await server.request('PUT', '/api/strava/sync-paused', { token: mintToken({ user_id: 'user-1' }), body: { paused: true } });

    expect(statuses.every((status) => status === 401)).toBe(true);
    expect(authenticated.status).toBe(200);
  });
});
