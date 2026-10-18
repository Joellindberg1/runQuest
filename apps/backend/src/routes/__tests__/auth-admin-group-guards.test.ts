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
import { mintToken, startServer, type TestServer } from './helpers/http.js';

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
  { id: 'member-a', name: 'Member A', email: 'member-a@example.com', is_admin: false, group_id: GROUP_A, password_hash: OLD_HASH },
  { id: 'member-b', name: 'Member B', email: 'member-b@example.com', is_admin: false, group_id: GROUP_B, password_hash: OLD_HASH },
];

function useDb(users: Row[] = people()) {
  const tables: Record<string, Row[]> = { users };
  const db = createFakeDb(tables, { autoIds: true });
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
    const res = await reset('member-a', adminToken(GROUP_A));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const member = db.tables.users.find((u) => u.id === 'member-a')!;
    expect(await bcrypt.compare('brand-new-secret', member.password_hash)).toBe(true);
  });

  it('answers 404 and writes nothing when the user is in another group', async () => {
    const db = useDb();
    const res = await reset('member-b', adminToken(GROUP_A));
    expect(res.status).toBe(404);
    expect(writesTo(db, 'users')).toEqual([]);
    expect(db.tables.users.find((u) => u.id === 'member-b')!.password_hash).toBe(OLD_HASH);
  });

  it('answers the same 404 for a user in another group as for a user that does not exist', async () => {
    useDb();
    const otherGroup = await reset('member-b', adminToken(GROUP_A));
    const missing = await reset('no-such-user', adminToken(GROUP_A));
    expect(missing.status).toBe(404);
    expect(otherGroup.status).toBe(missing.status);
    expect(otherGroup.body).toEqual(missing.body);
  });

  it('answers 403 and touches no user when the admin token has no group', async () => {
    const db = useDb();
    const res = await reset('member-a', adminToken(null));
    expect(res.status).toBe(403);
    expect(writesTo(db, 'users')).toEqual([]);
    // requireAdmin slår upp is_admin; målanvändaren får inte ens läsas
    expect(db.queries.filter((q) => q.table === 'users' && q.select !== 'is_admin')).toEqual([]);
    expect(db.tables.users.find((u) => u.id === 'member-a')!.password_hash).toBe(OLD_HASH);
  });
});
