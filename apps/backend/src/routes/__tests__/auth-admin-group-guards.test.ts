/**
 * Gruppvakter på admin-routes som tar ett användar-id eller skapar en användare.
 * En gruppadmin rör bara sin egen grupp; en token utan group_id får inte röra något alls (ADR 007 A6, fail-closed).
 * Testerna går över HTTP mot appen med fakeDb och vet inget om var gruppen kommer ifrån (token i dag), så en senare källa
 * för "den grupp admin agerar i" kan ersätta den utan att testerna ändras.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';

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
import { membershipRpc } from './helpers/fakeMembership.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { startFakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const GROUP_A = 'group-a';
const GROUP_B = 'group-b';
const OLD_HASH = 'old-hash-not-a-real-bcrypt-hash';

const adminToken = (group_id: string | null) => mintToken({ user_id: 'admin-a', group_id });

const people = (): Row[] => [
  { id: 'admin-a', name: 'Admin A', email: 'admin-a@example.com', is_admin: true, group_id: GROUP_A, password_hash: OLD_HASH },
  { id: '00000000-0000-4000-8000-0000000000a1', name: 'Member A', email: '00000000-0000-4000-8000-0000000000a1@example.com', is_admin: false, group_id: GROUP_A, password_hash: OLD_HASH },
  { id: '00000000-0000-4000-8000-0000000000b2', name: 'Member B', email: '00000000-0000-4000-8000-0000000000b2@example.com', is_admin: false, group_id: GROUP_B, password_hash: OLD_HASH },
];

function useDb(users: Row[] = people(), options: Parameters<typeof createFakeDb>[1] = {}) {
  const tables: Record<string, Row[]> = { users, groups: [{ id: GROUP_A }, { id: GROUP_B }], group_members: [] };
  const db = createFakeDb(tables, { autoIds: true, rpc: membershipRpc(tables), ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { ...db, tables };
}

const writesTo = (db: { queries: Array<{ table: string; mutation?: string }> }, table: string) =>
  db.queries.filter((q) => q.table === table && q.mutation);

describe('POST /api/auth/users (admin)', () => {
  const create = (token: string, body: Record<string, unknown> = { name: 'Newbie', email: 'newbie@example.com', password: 'secret123' }) =>
    server.request('POST', '/api/auth/users', { token, body });

  it('creates the user in the admin\'s own group', async () => {
    const db = useDb();
    const res = await create(adminToken(GROUP_A));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const created = db.tables.users.find((u) => u.email === 'newbie@example.com');
    expect(created?.group_id).toBe(GROUP_A);
    expect(db.tables.group_members).toMatchObject([{ user_id: created?.id, group_id: GROUP_A, role: 'member' }]);
  });

  it('answers 403 and creates no user when the admin token has no group', async () => {
    const db = useDb();
    const res = await create(adminToken(null));
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
    expect(writesTo(db, 'users')).toEqual([]);
    expect(db.tables.users).toHaveLength(3);
    expect(db.tables.users.some((u) => u.group_id == null)).toBe(false);
  });

  it('answers 403 for a groupless admin before it validates the body', async () => {
    const db = useDb();
    const res = await create(adminToken(null), { name: 'Newbie' });
    expect(res.status).toBe(403);
    expect(writesTo(db, 'users')).toEqual([]);
  });
});

describe('PUT /api/auth/users/:id/password (admin)', () => {
  const reset = (id: string, token: string) =>
    server.request('PUT', `/api/auth/users/${id}/password`, { token, body: { newPassword: 'brand-new-secret' } });

  it('resets the password of a user in the admin\'s own group', async () => {
    const db = useDb();
    const res = await reset('00000000-0000-4000-8000-0000000000a1', adminToken(GROUP_A));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const member = db.tables.users.find((u) => u.id === '00000000-0000-4000-8000-0000000000a1')!;
    expect(await bcrypt.compare('brand-new-secret', member.password_hash)).toBe(true);
  });

  it('answers 404 and writes nothing when the user is in another group', async () => {
    const db = useDb();
    const res = await reset('00000000-0000-4000-8000-0000000000b2', adminToken(GROUP_A));
    expect(res.status).toBe(404);
    expect(writesTo(db, 'users')).toEqual([]);
    expect(db.tables.users.find((u) => u.id === '00000000-0000-4000-8000-0000000000b2')!.password_hash).toBe(OLD_HASH);
  });

  it('answers the same 404 for a user in another group as for a user that does not exist', async () => {
    useDb();
    const otherGroup = await reset('00000000-0000-4000-8000-0000000000b2', adminToken(GROUP_A));
    const missing = await reset('00000000-0000-4000-8000-0000000000ff', adminToken(GROUP_A));
    expect(missing.status).toBe(404);
    expect(otherGroup.status).toBe(missing.status);
    expect(otherGroup.body).toEqual(missing.body);
  });

  it.each(['not-a-uuid', '12345', 'null', '00000000-0000-4000-8000-0000000000zz'])('answers the same 404 as for a missing user for the id %s, without a database error', async (badId) => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Postgres svarar 22P02 när en uuid-kolumn jämförs med en sträng som inte är ett uuid.
    const db = useDb(people(), {
      failWhen: (q) => (q.select !== 'is_admin' && q.filters.some((f) => f.column === 'id' && !UUID.test(String(f.value))) ? { message: 'invalid input syntax for type uuid', code: '22P02' } : null),
    });
    const sentry = startFakeSentry();
    try {
      const res = await reset(badId, adminToken(GROUP_A));
      const missing = await reset('00000000-0000-4000-8000-0000000000ff', adminToken(GROUP_A));
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
      expect(writesTo(db, 'users')).toEqual([]);
      expect(await sentry.drain()).toEqual([]);
    } finally {
      await sentry.stop();
    }
  });

  it('answers 500 and writes nothing when the user lookup fails in the database, not the 404 of a missing user', async () => {
    const db = useDb(people(), {
      failWhen: (q) => (q.table === 'users' && !q.mutation && q.select === 'id' ? { message: 'connection terminated', code: '57P01' } : null),
    });
    const res = await reset('00000000-0000-4000-8000-0000000000a1', adminToken(GROUP_A));
    const missing = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-0000000000ff/password', { token: adminToken(GROUP_A), body: { newPassword: 'brand-new-secret' } });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to look up the user' });
    expect(missing.status).toBe(500);
    expect(writesTo(db, 'users')).toEqual([]);
    expect(db.tables.users.find((u) => u.id === '00000000-0000-4000-8000-0000000000a1')!.password_hash).toBe(OLD_HASH);
  });

  it('answers 404 and keeps the password when the user moves to another group between the lookup and the update', async () => {
    // failWhen körs före radfiltreringen i updaten: precis då flyttas målet till en annan grupp, som vid ett samtidigt anrop.
    const db = useDb(people(), {
      failWhen: (q) => {
        if (q.table === 'users' && q.mutation === 'update') {
          db.tables.users.find((u) => u.id === '00000000-0000-4000-8000-0000000000a1')!.group_id = GROUP_B;
        }
        return null;
      },
    });
    const res = await reset('00000000-0000-4000-8000-0000000000a1', adminToken(GROUP_A));
    const missing = await reset('00000000-0000-4000-8000-0000000000ff', adminToken(GROUP_A));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing.body);
    expect(db.tables.users.find((u) => u.id === '00000000-0000-4000-8000-0000000000a1')!.password_hash).toBe(OLD_HASH);
  });

  it('answers 403 before it validates the body when the admin token has no group', async () => {
    const db = useDb();
    const noPassword = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-0000000000a1/password', { token: adminToken(null), body: {} });
    const tooShort = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-0000000000a1/password', { token: adminToken(null), body: { newPassword: '123' } });
    expect(noPassword.status).toBe(403);
    expect(tooShort.status).toBe(403);
    expect(writesTo(db, 'users')).toEqual([]);
  });

  it('answers 403 and touches no user when the admin token has no group', async () => {
    const db = useDb();
    const res = await reset('00000000-0000-4000-8000-0000000000a1', adminToken(null));
    expect(res.status).toBe(403);
    expect(writesTo(db, 'users')).toEqual([]);
    // requireAdmin slår upp is_admin; målanvändaren får inte ens läsas
    expect(db.queries.filter((q) => q.table === 'users' && q.select !== 'is_admin')).toEqual([]);
    expect(db.tables.users.find((u) => u.id === '00000000-0000-4000-8000-0000000000a1')!.password_hash).toBe(OLD_HASH);
  });
});
