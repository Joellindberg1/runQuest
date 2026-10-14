/**
 * The sync that "Turn sync back on" starts runs in the background (ADR 010 decision 7.5). It must never be able to take the
 * process down or leak a token, however it ends: a sync that rejects is caught and logged with the user id and an error name only.
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
// The lock is the only way the background sync can reject (the sync itself catches its own errors), so the test breaks it.
vi.mock('../../utils/keyedMutex.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/keyedMutex.js')>('../../utils/keyedMutex.js');
  return { ...actual, withUserLock: vi.fn(actual.withUserLock) };
});

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const SECRET_ACCESS_TOKEN = 'secret-access-token-value';
const SECRET_REFRESH_TOKEN = 'secret-refresh-token-value';
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  vi.clearAllMocks();
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.restoreAllMocks();
});

function use(): Record<string, Row[]> {
  const tables: Record<string, Row[]> = {
    strava_tokens: [{
      user_id: 'user-1',
      access_token: SECRET_ACCESS_TOKEN,
      refresh_token: SECRET_REFRESH_TOKEN,
      expires_at: 9999999999,
      sync_paused: true,
      paused_at: '2026-10-01T08:00:00.000Z',
    }],
  };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables).client as any);
  return tables;
}

describe('the sync that resume starts in the background', () => {
  it('a rejecting sync is caught: the response is still 200, nothing is unhandled and the log holds no token', async () => {
    const tables = use();
    vi.mocked(withUserLock).mockRejectedValueOnce(new Error(`lock failed for ${SECRET_ACCESS_TOKEN}`));

    const res = await server.request('PUT', '/api/strava/sync-paused', { token: mintToken({ user_id: 'user-1' }), body: { paused: false } });
    await new Promise<void>((resolve) => setTimeout(resolve, 50)); // an unhandled rejection surfaces on a later tick

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sync_paused: false, paused_at: null } });
    expect(tables.strava_tokens[0]).toMatchObject({ sync_paused: false, paused_at: null }); // the resume stands
    expect(withUserLock).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(unhandled).toEqual([]);

    const logged = JSON.stringify([...vi.mocked(logger.error).mock.calls, ...vi.mocked(logger.warn).mock.calls]);
    expect(logged).toContain('user-1');
    expect(logged).not.toContain(SECRET_ACCESS_TOKEN);
    expect(logged).not.toContain(SECRET_REFRESH_TOKEN);
  });
});
