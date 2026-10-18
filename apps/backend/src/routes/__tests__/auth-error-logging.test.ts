/**
 * Auth-routes loggar bara en felkod när databasen eller ett bibliotek (bcrypt, JWT, supabase-js) felar, aldrig meddelandet eller
 * hela felobjektet: ett PostgREST-meddelande kan bära radvärden (e-post, titlar) och går via Sentry-kopplingen vidare som log_detail.
 * Konventionen är densamma som i strava.ts: `errorCode(...)` i utils/errorCode.ts.
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
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { startFakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { vi.restoreAllMocks(); });

const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
const loggedObjects = () => spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');

const LEAK = 'LEAKMARKER-row-value-4711';
const GROUP = 'group-1';
const CURRENT_PASSWORD = 'current-secret';

const users = (): Row[] => [
  { id: 'admin-1', name: 'Admin', email: 'admin@example.com', is_admin: true, group_id: GROUP, password_hash: bcrypt.hashSync(CURRENT_PASSWORD, 4) },
  { id: '00000000-0000-4000-8000-0000000000c3', name: 'Member', email: 'member@example.com', is_admin: false, group_id: GROUP, password_hash: bcrypt.hashSync(CURRENT_PASSWORD, 4) },
];

const adminToken = () => mintToken({ user_id: 'admin-1', group_id: GROUP });

/** requireAdmin slår upp is_admin på users; den frågan får aldrig felas, felet ska komma från routen själv. */
const isAdminLookup = (q: RecordedQuery) => q.table === 'users' && q.select === 'is_admin';

type FailWhen = (q: RecordedQuery) => boolean;
type Case = { name: string; method: string; path: string; body?: unknown; fails: FailWhen; status: number };

const readsUsers: FailWhen = (q) => q.table === 'users' && !q.mutation && !isAdminLookup(q);

/** Varje väg där routen loggar ett fel från databasen (felobjekt med meddelande + kod) och svarar generiskt. */
const databaseErrorCases: Case[] = [
  { name: 'login lookup', method: 'POST', path: '/api/auth/login', body: { email: 'member@example.com', password: 'x' }, fails: readsUsers, status: 401 },
  { name: 'change-password lookup', method: 'POST', path: '/api/auth/change-password', body: { currentPassword: CURRENT_PASSWORD, newPassword: 'another-secret' }, fails: readsUsers, status: 404 },
  { name: 'change-password update', method: 'POST', path: '/api/auth/change-password', body: { currentPassword: CURRENT_PASSWORD, newPassword: 'another-secret' }, fails: (q) => q.mutation === 'update', status: 500 },
  { name: 'user list', method: 'GET', path: '/api/auth/users', fails: readsUsers, status: 500 },
  { name: 'user create', method: 'POST', path: '/api/auth/users', body: { name: 'Newbie', email: 'newbie@example.com', password: 'secret123' }, fails: (q) => q.mutation === 'insert', status: 500 },
  { name: 'password reset lookup', method: 'PUT', path: '/api/auth/users/00000000-0000-4000-8000-0000000000c3/password', body: { newPassword: 'another-secret' }, fails: readsUsers, status: 500 },
  { name: 'password reset update', method: 'PUT', path: '/api/auth/users/00000000-0000-4000-8000-0000000000c3/password', body: { newPassword: 'another-secret' }, fails: (q) => q.mutation === 'update', status: 500 },
  { name: 'displayed titles', method: 'PUT', path: '/api/auth/me/displayed-titles', body: { title_ids: ['t1'] }, fails: (q) => q.mutation === 'update', status: 500 },
  { name: 'users with runs', method: 'GET', path: '/api/auth/users-with-runs', fails: readsUsers, status: 500 },
  { name: 'admin settings read', method: 'GET', path: '/api/auth/admin-settings', fails: (q) => q.table === 'admin_settings', status: 500 },
  { name: 'admin settings write', method: 'PUT', path: '/api/auth/admin-settings', body: { base_xp: 10, xp_per_km: 5 }, fails: (q) => q.table === 'admin_settings', status: 500 },
  { name: 'streak multipliers read', method: 'GET', path: '/api/auth/streak-multipliers', fails: (q) => q.table === 'streak_multipliers', status: 500 },
  { name: 'streak multipliers write', method: 'PUT', path: '/api/auth/streak-multipliers', body: { multipliers: [{ days: 1, multiplier: 1.1 }] }, fails: (q) => q.table === 'streak_multipliers', status: 500 },
];

function useDb(fails: FailWhen, failure: () => unknown) {
  const tables: Record<string, Row[]> = { users: users(), admin_settings: [{ id: 'settings-1', base_xp: 10, xp_per_km: 5 }], streak_multipliers: [] };
  const db = createFakeDb(tables, {
    autoIds: true,
    failWhen: (q) => {
      if (!fails(q)) return null;
      return failure() as { message: string };
    },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const send = (c: Case) => server.request(c.method, c.path, { token: adminToken(), body: c.body });

function expectOnlyTheCodeWasLogged(code: string) {
  const out = logged();
  expect(out).toContain(code);
  expect(out).not.toContain(LEAK);
  expect(loggedObjects().some((o: any) => o instanceof Error || 'message' in o || 'stack' in o || 'details' in o)).toBe(false);
}

describe('auth routes when the database fails', () => {
  it.each(databaseErrorCases)('$name logs the error code and not the database message', async (c) => {
    useDb(c.fails, () => ({ message: `duplicate key value violates unique constraint (email)=(${LEAK})`, details: `Key (email)=(${LEAK}) already exists.`, code: '23505' }));
    const res = await send(c);
    expect(res.status).toBe(c.status);
    expect(JSON.stringify(res.body)).not.toContain(LEAK);
    expectOnlyTheCodeWasLogged('23505');
  });
});

describe('auth routes when a call throws', () => {
  // Alla vägar har en catch: bcrypt, JWT och supabase-js kan kasta ett Error vars meddelande bär indata.
  it.each(databaseErrorCases)('$name logs the error code and not the error object', async (c) => {
    useDb(c.fails, () => { throw Object.assign(new Error(`socket hang up near ${LEAK}`), { code: 'ECONNRESET' }); });
    const res = await send(c);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(LEAK);
    expectOnlyTheCodeWasLogged('ECONNRESET');
  });
});

describe('auth routes that answer 500 when the database fails', () => {
  // En 500 är vårt fel och ska bli en Sentry-händelse (logger.error), med felkoden och utan databasmeddelandet.
  it.each(databaseErrorCases.filter((c) => c.status === 500))('$name is reported to Sentry with the error code only', async (c) => {
    const sentry = startFakeSentry();
    try {
      useDb(c.fails, () => ({ message: `duplicate key value violates unique constraint (email)=(${LEAK})`, details: `Key (email)=(${LEAK}) already exists.`, code: '23505' }));
      const res = await send(c);
      expect(res.status).toBe(500);
      const events = JSON.stringify(await sentry.drain());
      expect(events).toContain('23505');
      expect(events).not.toContain(LEAK);
    } finally {
      await sentry.stop();
    }
  });
});
