/**
 * authenticateJWT: ogiltig/utgången token är autentisering → 401 (klienten loggar ut vid 401).
 * Ägarskaps-/IDOR-403:orna i routes är oförändrade (täcks i runs-idor/challenges-testerna).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import app from '../../app.js';
import { startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const claims = { user_id: 'user-1', name: 'T', email: 't@example.com', group_id: 'group-1' };

describe('authenticateJWT', () => {
  it('utgången token → 401 "Invalid token"', async () => {
    const expired = jwt.sign(claims, process.env.JWT_SECRET as string, { expiresIn: -60 });
    const res = await server.request('GET', '/api/news', { token: expired });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('token signerad med fel hemlighet → 401', async () => {
    const forged = jwt.sign(claims, 'some-other-secret', { expiresIn: '1h' });
    expect((await server.request('GET', '/api/news', { token: forged })).status).toBe(401);
  });

  it('skräp som token → 401', async () => {
    expect((await server.request('GET', '/api/news', { token: 'not-a-jwt' })).status).toBe(401);
  });

  it('saknad token → 401 (oförändrat)', async () => {
    expect((await server.request('GET', '/api/news')).status).toBe(401);
  });
});
