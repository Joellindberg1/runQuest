/**
 * PUT /api/strava/sync-paused is rate limited (30 per minute and IP), so a script cannot hammer the row or the resume sync.
 * Own file: the limiter's counter lives as long as the module, and no other test should be counted against it.
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
  server = await startServer(app);
});
afterAll(async () => { await server.close(); });

describe('PUT /api/strava/sync-paused rate limit', () => {
  it('answers 429 from the 31st request within a minute', async () => {
    const tables = { strava_tokens: [{ user_id: 'user-1', access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, sync_paused: false, paused_at: null }] };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables).client as any);
    const token = mintToken({ user_id: 'user-1' });

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      // Always pause: a resume would start a background sync and this test has no Strava.
      statuses.push((await server.request('PUT', '/api/strava/sync-paused', { token, body: { paused: true } })).status);
    }

    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
