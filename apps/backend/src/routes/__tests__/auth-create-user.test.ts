/**
 * POST /api/auth/users (admin): dubblettkontrollen får aldrig bygga ett PostgREST-filter av body-strängar.
 * fakeDb tolkar .or() som PostgREST, så ett injicerat villkor skulle ge en falsk 409 här om koden interpolerade indata.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const adminToken = () => mintToken({ user_id: 'admin-1' });

const baseUsers = (): Row[] => [
  { id: 'admin-1', is_admin: true, name: 'Admin', email: 'admin@example.com' },
  { id: 'u2', is_admin: false, name: 'Existing', email: 'existing@example.com' },
];

function useDb(users: Row[]) {
  const db = createFakeDb({ users }, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const create = (body: Record<string, unknown>) =>
  server.request('POST', '/api/auth/users', { token: adminToken(), body });

describe('POST /api/auth/users', () => {
  it('create user rejects filter injection', async () => {
    // Admin har e-posten "zzz", så det injicerade villkoret email.neq.zzz träffar exakt en obesläktad användare (u2).
    // Gammal kod: or(name.eq.x,email.neq.zzz,email.eq.fresh@...) ger då en falsk 409 för u2.
    useDb([{ id: 'admin-1', is_admin: true, name: 'Admin', email: 'zzz' }, { id: 'u2', is_admin: false, name: 'Existing', email: 'existing@example.com' }]);
    const res = await create({ name: 'x,email.neq.zzz', email: 'fresh@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('create user rejects filter injection that targets one specific user by id', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'x,id.eq.u2', email: 'fresh@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
  });

  it('create user rejects filter injection through the email field too', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Fresh', email: 'a@b.se,id.eq.u2', password: 'secret123' });
    expect(res.status).toBe(200);
  });

  it('returns 409 when the name already exists', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Existing', email: 'other@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('returns 409 when the email already exists', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Other', email: 'existing@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('returns 409 when name and email belong to two different existing users', async () => {
    useDb([...baseUsers(), { id: 'u3', is_admin: false, name: 'Second', email: 'second@example.com' }]);
    const res = await create({ name: 'Existing', email: 'second@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('returns 400 when a required field is missing', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Fresh', password: 'secret123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when name or email is not a string', async () => {
    useDb(baseUsers());
    const res = await create({ name: { 'x': 1 }, email: ['a@b.se'], password: 'secret123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the password is too short', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Fresh', email: 'fresh@example.com', password: '12345' });
    expect(res.status).toBe(400);
  });
});
