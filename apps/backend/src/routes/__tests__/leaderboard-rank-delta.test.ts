/**
 * GET /api/leaderboard/rank-delta (ADR 007 B2) — route-test med fake-DB.
 * Veckogräns och rank-regler testas rent i packages/shared; här: HTTP-form,
 * gruppavgränsning och att runda- och event-XP läses in i liggaren.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T10:00:00Z')); // torsdag; veckostart 2026-09-28
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const G1 = 'group-1';
const G2 = 'group-2';

function user(id: string, name: string, group_id: string, total_xp: number, created_at = '2026-01-01T08:00:00Z'): Row {
  return { id, name, group_id, total_xp, created_at };
}
function run(id: string, user_id: string, group_id: string, date: string, xp_gained: number): Row {
  return { id, user_id, date, xp_gained, users: { group_id } };
}
function entryRow(id: string, user_id: string, group_id: string, xp_awarded: number | null, ev: Row): Row {
  return {
    id, user_id, event_id: `ev-${id}`, xp_awarded,
    qualified_at: ev.qualified_at ?? null,
    events: { type: ev.type, ends_at: ev.ends_at, settled_at: ev.settled_at ?? null, group_id },
  };
}

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

// Före veckostart: Anna 400, Bertil 300. Denna vecka: Bertil +100 (runda) +50 (event) -> 450; Anna +0.
const tables = () => ({
  users: [
    user('u-anna', 'Anna', G1, 400),
    user('u-bertil', 'Bertil', G1, 450),
    user('u-x', 'Främling', G2, 9999),
  ],
  runs: [
    run('r0', 'u-anna', G1, '2026-09-20', 40),   // före veckostart
    run('r1', 'u-bertil', G1, '2026-09-29', 100),
    run('rx', 'u-x', G2, '2026-09-29', 500),
  ],
  event_entries: [
    entryRow('e1', 'u-bertil', G1, 50, { type: 'participation', qualified_at: '2026-09-30T10:00:00Z', ends_at: '2026-10-02T21:59:59Z' }),
    entryRow('e2', 'u-anna', G1, 100, { type: 'competition', ends_at: '2026-09-27T21:59:59Z', settled_at: '2026-09-27T21:55:00Z' }), // före veckostart
    entryRow('ex', 'u-x', G2, 300, { type: 'participation', qualified_at: '2026-09-30T10:00:00Z', ends_at: '2026-10-02T21:59:59Z' }),
  ],
});

describe('GET /api/leaderboard/rank-delta', () => {
  it('kräver token (401)', async () => {
    const res = await server.request('GET', '/api/leaderboard/rank-delta');
    expect(res.status).toBe(401);
  });

  it('svarar {success,data} med as_of = veckans måndag och kontraktsform per användare', async () => {
    useDb(tables());
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(res.body.data.as_of).toBe('2026-09-28');
    expect(res.body.data.users).toEqual([
      // Bertil: 450 nu, 450 - (100 runda + 50 event) = 300 före -> 2:a före, 1:a nu
      { user_id: 'u-bertil', xp: 450, rank: 1, previous_xp: 300, previous_rank: 2, rank_delta: 1 },
      { user_id: 'u-anna', xp: 400, rank: 2, previous_xp: 400, previous_rank: 1, rank_delta: -1 },
    ]);
  });

  it('visar aldrig en annan grupps användare och räknar inte dess XP', async () => {
    useDb(tables());
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    expect(JSON.stringify(res.body)).not.toContain('u-x');
  });

  it('event-XP daterad före veckostart räknas inte bort (Annas competition avräknad söndag)', async () => {
    useDb(tables());
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    const anna = res.body.data.users.find((u: any) => u.user_id === 'u-anna');
    expect(anna.previous_xp).toBe(400);
  });

  it('saknad group_id i token ger tom lista och rör inte databasen', async () => {
    const db = useDb(tables());
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ as_of: '2026-09-28', users: [] });
    expect(db.queries).toHaveLength(0);
  });

  it('filtrerar alla tre queries på gruppen (join-filter för runs och event_entries)', async () => {
    const db = useDb(tables());
    await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    const by = (t: string) => db.queries.find((q) => q.table === t)!;
    expect(by('users').filters).toContainEqual({ op: 'eq', column: 'group_id', value: G1 });
    expect(by('runs').filters).toContainEqual({ op: 'eq', column: 'users.group_id', value: G1 });
    expect(by('runs').filters).toContainEqual({ op: 'gte', column: 'date', value: '2026-09-28' });
    expect(by('event_entries').filters).toContainEqual({ op: 'eq', column: 'events.group_id', value: G1 });
  });

  it('500 med {error} vid databasfel', async () => {
    useDb(tables(), { errors: { event_entries: { message: 'boom internal' } } });
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch rank delta' });
  });
});
