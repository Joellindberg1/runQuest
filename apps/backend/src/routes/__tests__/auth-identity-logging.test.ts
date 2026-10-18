/**
 * Auth-routes identifierar en användare med id i loggen, aldrig med namn eller e-post, och loggar inga titel-id från en inställning.
 * Loggen sparas i Railway och varje logger.error går vidare till Sentry.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';
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

let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { vi.restoreAllMocks(); });

const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');

const GROUP = 'group-1';
const PASSWORD = 'current-secret';
const NAMES = ['Zebulon Quux', 'Ottoline Brandt', 'Newcomer Vance'];
const EMAILS = ['zebulon.quux@example.com', 'ottoline.brandt@example.com', 'newcomer.vance@example.com'];

const users = (): Row[] => [
  { id: 'admin-1', name: NAMES[0], email: EMAILS[0], is_admin: true, group_id: GROUP, password_hash: bcrypt.hashSync(PASSWORD, 4) },
  { id: '00000000-0000-4000-8000-0000000000c3', name: NAMES[1], email: EMAILS[1], is_admin: false, group_id: GROUP, password_hash: bcrypt.hashSync(PASSWORD, 4) },
];

function useDb() {
  const db = createFakeDb({ users: users() }, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
}

const adminToken = () => mintToken({ user_id: 'admin-1', group_id: GROUP });

function expectNoIdentity() {
  const out = logged();
  for (const secret of [...NAMES, ...EMAILS, 'Zebulon', 'Ottoline', 'Newcomer']) expect(out, secret).not.toContain(secret);
}

describe('auth routes log ids, not names or e-mail addresses', () => {
  it('login logs the user id and not the name', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/login', { body: { email: EMAILS[1], password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(logged()).toContain('00000000-0000-4000-8000-0000000000c3');
    expectNoIdentity();
  });

  it('change-password logs the user id and not the name', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/change-password', { token: mintToken({ user_id: '00000000-0000-4000-8000-0000000000c3', group_id: GROUP }), body: { currentPassword: PASSWORD, newPassword: 'another-secret' } });
    expect(res.status).toBe(200);
    expect(logged()).toContain('00000000-0000-4000-8000-0000000000c3');
    expectNoIdentity();
  });

  it('create user logs the new user id and not the name or the e-mail', async () => {
    useDb();
    const res = await server.request('POST', '/api/auth/users', { token: adminToken(), body: { name: NAMES[2], email: EMAILS[2], password: 'secret123' } });
    expect(res.status).toBe(200);
    expect(logged()).toContain(res.body.data.id);
    expectNoIdentity();
  });

  it('password reset logs the target user id and not the name', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/users/00000000-0000-4000-8000-0000000000c3/password', { token: adminToken(), body: { newPassword: 'another-secret' } });
    expect(res.status).toBe(200);
    expect(logged()).toContain('00000000-0000-4000-8000-0000000000c3');
    expectNoIdentity();
  });

  it('updating the displayed titles logs the user id and not the title ids', async () => {
    useDb();
    const res = await server.request('PUT', '/api/auth/me/displayed-titles', { token: mintToken({ user_id: '00000000-0000-4000-8000-0000000000c3', group_id: GROUP }), body: { title_ids: ['title-marker-aaa', 'title-marker-bbb'] } });
    expect(res.status).toBe(200);
    expect(logged()).toContain('00000000-0000-4000-8000-0000000000c3');
    expect(logged()).not.toContain('title-marker');
  });
});
