/**
 * Titelrutterna (och titelservicen under dem) loggar och rapporterar bara en felkod när databasen felar, och svarar med ett
 * generiskt fel: aldrig error.message som `message` eller `details` i svaret. Ett PostgREST-fel kan bära radvärden i meddelandet.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import app from '../../app.js';
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';

const LEAK = 'LEAKMARKER users_email_key jane.doe@example.com';
const dbError = () => ({ message: `duplicate key value violates unique constraint "${LEAK}"`, details: `Key (email)=(${LEAK}) already exists.`, code: '23505' });

let server: TestServer;
let sentry: FakeSentry;
let spies: Array<ReturnType<typeof vi.spyOn>>;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
});

const logged = () => spies.flatMap((s) => s.mock.calls).map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')).join('\n');
const loggedObjects = () => spies.flatMap((s) => s.mock.calls).flat().filter((a: unknown) => a !== null && typeof a === 'object');

const isAdminLookup = (q: RecordedQuery) => q.table === 'users' && q.select === 'is_admin';
const tables = (): Record<string, Row[]> => ({ users: [{ id: 'admin-1', is_admin: true, group_id: 'g1' }], titles: [], title_leaderboard_view: [], user_titles: [], group_members: [{ user_id: 'u2', group_id: 'g1', role: 'member', left_at: null }] });

function useDb(fails: (q: RecordedQuery) => boolean, failure: () => unknown, rpcFails = false) {
  const db = createFakeDb(tables(), {
    failWhen: (q) => (!isAdminLookup(q) && fails(q) ? (failure() as { message: string }) : null),
    ...(rpcFails ? { rpc: { update_group_title_leaderboards: () => ({ error: dbError() }) } } : {}),
  });
  holder.client = db.client;
}

const token = () => mintToken({ user_id: 'admin-1', group_id: 'g1' });

type Case = { name: string; method: string; path: string; fails: (q: RecordedQuery) => boolean; rpc?: boolean; error: string };
const cases: Case[] = [
  { name: 'GET /api/titles', method: 'GET', path: '/api/titles', fails: (q) => q.table === 'titles', error: 'Failed to fetch titles' },
  { name: 'GET /api/titles/leaderboard', method: 'GET', path: '/api/titles/leaderboard', fails: (q) => q.table === 'title_leaderboard_view', error: 'Failed to fetch title leaderboard' },
  { name: 'GET /api/titles/user/:userId', method: 'GET', path: '/api/titles/user/u2', fails: () => true, error: 'Failed to fetch user titles' },
  { name: 'POST /api/titles/populate', method: 'POST', path: '/api/titles/populate', fails: () => false, rpc: true, error: 'Failed to populate title leaderboards' },
  { name: 'POST /api/titles/refresh', method: 'POST', path: '/api/titles/refresh', fails: () => false, rpc: true, error: 'Failed to refresh title leaderboards' },
];

function expectOnlyTheCode(code: string) {
  const out = logged();
  expect(out).toContain(code);
  expect(out).not.toContain('LEAKMARKER');
  expect(out).not.toContain('users_email_key');
  expect(loggedObjects().some((o: any) => o instanceof Error || 'message' in o || 'stack' in o || 'details' in o)).toBe(false);
}

describe('title routes when the database returns an error', () => {
  it.each(cases.filter((c) => c.name !== 'GET /api/titles/user/:userId'))('$name logs and reports the error code and answers with a generic error', async (c) => {
    useDb(c.fails, dbError, c.rpc);
    const res = await server.request(c.method, c.path, { token: token() });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: c.error });
    expectOnlyTheCode('23505');
    const events = JSON.stringify(await sentry.drain());
    expect(events).toContain('23505');
    expect(events).not.toContain('LEAKMARKER');
    expect(events).not.toContain('users_email_key');
    expect(events).not.toContain('jane.doe@example.com');
  });
});

describe('title routes when a call throws', () => {
  it.each(cases.filter((c) => !c.rpc))('$name logs and reports the error code and answers with a generic error', async (c) => {
    useDb(c.fails, () => { throw Object.assign(new Error(`socket hang up near ${LEAK}`), { code: 'ECONNRESET' }); });
    const res = await server.request(c.method, c.path, { token: token() });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: c.error });
    expect(JSON.stringify(res.body)).not.toContain('LEAKMARKER');
    expectOnlyTheCode('ECONNRESET');
    const events = JSON.stringify(await sentry.drain());
    expect(events).toContain('ECONNRESET');
    expect(events).not.toContain('LEAKMARKER');
    expect(events).not.toContain('jane.doe@example.com');
  });
});

describe('getUserTitles when the leaderboard read returns a database error', () => {
  it('logs only the code, keeps answering with the titles it could read and returns no database message', async () => {
    useDb((q) => q.table === 'title_leaderboard_view', dbError);
    const res = await server.request('GET', '/api/titles/user/u2', { token: token() });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('LEAKMARKER');
    expectOnlyTheCode('23505');
  });
});

describe('one failure in the titles path is one Sentry event', () => {
  // The route is the place that catches, so the route logs; the services under it rethrow without logging (a failed read of
  // /api/titles used to be three events: getAllTitles twice and the route).
  it.each(cases.filter((c) => c.name !== 'GET /api/titles/user/:userId'))('$name sends exactly one event for a database error', async (c) => {
    useDb(c.fails, dbError, c.rpc);
    const res = await server.request(c.method, c.path, { token: token() });

    expect(res.status).toBe(500);
    const events = await sentry.drain();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).toContain('23505');
  });

  it.each(cases.filter((c) => !c.rpc))('$name sends exactly one event when the call throws', async (c) => {
    useDb(c.fails, () => { throw Object.assign(new Error(`socket hang up near ${LEAK}`), { code: 'ECONNRESET' }); });
    const res = await server.request(c.method, c.path, { token: token() });

    expect(res.status).toBe(500);
    expect(await sentry.drain()).toHaveLength(1);
  });
});
