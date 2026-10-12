/**
 * RUN-214: loggarna (Railway sparar dem) får aldrig innehålla e-postadresser,
 * hela req.user-objektet eller någon del av en OAuth-token.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Allt som loggades, som en enda sträng (objekt expanderas som console skulle visa dem). */
const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
const loggedObjects = () => spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');

function useDb(data: Parameters<typeof createFakeDb>[0]) {
  const db = createFakeDb(data);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('auth routes', () => {
  const adminToken = () => mintToken({ user_id: 'admin-1' }); // bär e-posten test@example.com

  it('auth routes never log email or the full user object', async () => {
    useDb({ users: [{ id: 'admin-1', is_admin: true }] });

    const list = await server.request('GET', '/api/auth/users', { token: adminToken() });
    expect(list.status).toBe(200);

    const create = await server.request('POST', '/api/auth/users', {
      token: adminToken(), body: { name: 'Newbie', email: 'new.person@example.com', password: 'hunter22' },
    });
    expect(create.status).toBe(200);

    const login = await server.request('POST', '/api/auth/login', { body: { email: 'login.person@example.com', password: 'pw' } });
    expect(login.status).toBe(401);

    const out = logged();
    expect(out).not.toContain('test@example.com');
    expect(out).not.toContain('new.person@example.com');
    expect(out).not.toContain('login.person@example.com');
    expect(loggedObjects().some((o: any) => 'user_id' in o || 'group_id' in o)).toBe(false);
  });
});

describe('strava routes', () => {
  it('strava routes never log any part of a token', async () => {
    const access = 'ACCESSTOKENVALUE0123456789';
    const refresh = 'REFRESHTOKENVALUE9876543210';
    useDb({ strava_tokens: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: access, refresh_token: refresh, expires_at: 1900000000, athlete: { id: 7 } }),
    }));

    const res = await server.request('POST', '/api/strava/callback', { token: mintToken(), body: { code: 'oauth-code' } });
    expect(res.status).toBe(200);

    const out = logged();
    expect(out).not.toContain(access.slice(0, 5));
    expect(out).not.toContain(refresh.slice(0, 5));
    expect(out).not.toContain('oauth-code');
  });
});
