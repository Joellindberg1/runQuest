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

function useDb(users: Row[], options: Parameters<typeof createFakeDb>[1] = {}) {
  const tables: Record<string, Row[]> = { users };
  const db = createFakeDb(tables, { autoIds: true, ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { ...db, tables };
}

const create = (body: Record<string, unknown>) =>
  server.request('POST', '/api/auth/users', { token: adminToken(), body });

describe('POST /api/auth/users', () => {
  it('create user rejects filter injection', async () => {
    // Admin har e-posten "zzz", så det injicerade villkoret email.neq.zzz träffar exakt en obesläktad användare (u2).
    // Gammal kod: or(name.eq.x,email.neq.zzz,email.eq.fresh@...) ger då en falsk 409 för u2.
    const db = useDb([{ id: 'admin-1', is_admin: true, name: 'Admin', email: 'zzz' }, { id: 'u2', is_admin: false, name: 'Existing', email: 'existing@example.com' }]);
    const res = await create({ name: 'x,email.neq.zzz', email: 'fresh@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Namnet sparas ordagrant: det är en vanlig sträng, aldrig ett filter.
    expect(res.body.data.name).toBe('x,email.neq.zzz');
    expect(db.tables.users.some((u) => u.name === 'x,email.neq.zzz')).toBe(true);
  });

  it('create user rejects filter injection that targets one specific user by id', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'x,id.eq.u2', email: 'fresh@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('x,id.eq.u2');
  });

  it('create user rejects filter injection through the email field too', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Fresh', email: 'a@b.se,id.eq.u2', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('a@b.se,id.eq.u2');
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

  it('returns 400 when only name is not a string', async () => {
    useDb(baseUsers());
    const res = await create({ name: { x: 1 }, email: 'fresh@example.com', password: 'secret123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when only email is not a string', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Fresh', email: ['a@b.se'], password: 'secret123' });
    expect(res.status).toBe(400);
  });

  describe.each([['name'], ['email']])('when only the %s duplicate check fails', (column) => {
    it('returns 500 without leaking the error and creates no user', async () => {
      const db = useDb(baseUsers(), {
        failWhen: (q) => (q.table === 'users' && !q.mutation && q.filters.some((f) => f.op === 'eq' && f.column === column)
          ? { message: 'secret db detail' } : null),
      });
      const res = await create({ name: 'Fresh', email: 'fresh@example.com', password: 'secret123' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(res.body)).not.toContain('secret db detail');
      expect(db.tables.users).toHaveLength(2);
    });
  });

  it('returns 400 when the password is too short', async () => {
    useDb(baseUsers());
    const res = await create({ name: 'Fresh', email: 'fresh@example.com', password: '12345' });
    expect(res.status).toBe(400);
  });
});
