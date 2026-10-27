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
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
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
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); setGroupTimeZoneSource(); });

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

  it('competition avräknad måndag 00:05 Stockholm (22:05Z) men ends_at söndag 21:59:59Z räknas som krediterad FRÅN veckostart (settled_at ?? ends_at)', async () => {
    const t = tables();
    t.event_entries = [
      entryRow('e3', 'u-anna', G1, 100, { type: 'competition', ends_at: '2026-09-27T21:59:59Z', settled_at: '2026-09-27T22:05:00Z' }),
    ];
    t.runs = [];
    t.users = [user('u-anna', 'Anna', G1, 400), user('u-bertil', 'Bertil', G1, 350)];
    useDb(t);
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    const anna = res.body.data.users.find((u: any) => u.user_id === 'u-anna');
    // 22:05Z söndag = 00:05 måndag 2026-09-28 i Stockholm (UTC+2 på sommartid; datumet är måndag oavsett) -> räknas bort
    expect(anna.previous_xp).toBe(300);
    expect(anna.previous_rank).toBe(2);
    expect(anna.rank).toBe(1);
    expect(anna.rank_delta).toBe(1);
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
    // tidsgränsen (veckostart − 14 dagar) och xp > 0 får inte kunna plockas bort tyst
    expect(by('event_entries').filters).toContainEqual({ op: 'gte', column: 'events.ends_at', value: '2026-09-13T22:00:00.000Z' });
    expect(by('event_entries').filters).toContainEqual({ op: 'gt', column: 'xp_awarded', value: 0 });
  });

  it('the event window starts at the midnight of the group time zone, not at UTC midnight', async () => {
    setGroupTimeZoneSource((groupId) => (groupId === G1 ? 'America/New_York' : undefined));
    const db = useDb(tables());
    await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    const entries = db.queries.find((q) => q.table === 'event_entries')!;
    expect(entries.filters).toContainEqual({ op: 'gte', column: 'events.ends_at', value: '2026-09-14T04:00:00.000Z' });
  });

  it('rank-delta response is identical for a Stockholm group before and after', async () => {
    // Event-XP nära dygnsgränsen: söndag 23:30Z är måndag 01:30 i Stockholm, alltså krediterad från veckostart.
    const stockholmTables = () => ({
      users: [user('u-anna', 'Anna', G1, 400), user('u-bertil', 'Bertil', G1, 350)],
      runs: [run('r1', 'u-bertil', G1, '2026-09-29', 20)],
      event_entries: [
        entryRow('e1', 'u-anna', G1, 100, { type: 'participation', qualified_at: '2026-09-27T23:30:00Z', ends_at: '2026-10-02T21:59:59Z' }),
        entryRow('e2', 'u-bertil', G1, 30, { type: 'competition', ends_at: '2026-09-27T21:59:59Z', settled_at: '2026-09-27T21:55:00Z' }),
      ],
    });
    const expected = {
      success: true,
      data: {
        as_of: '2026-09-28',
        users: [
          { user_id: 'u-anna', xp: 400, rank: 1, previous_xp: 300, previous_rank: 2, rank_delta: 1 },
          { user_id: 'u-bertil', xp: 350, rank: 2, previous_xp: 330, previous_rank: 1, rank_delta: -1 },
        ],
      },
    };

    useDb(stockholmTables());
    const byDefault = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    setGroupTimeZoneSource((groupId) => (groupId === G1 ? 'Europe/Stockholm' : undefined));
    useDb(stockholmTables());
    const explicit = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });

    expect(byDefault.status).toBe(200);
    expect(byDefault.body).toEqual(expected);
    expect(explicit.body).toEqual(byDefault.body);
  });

  it("rank-delta dates the ledger in the group's zone", async () => {
    // Samma event-XP (söndag 23:30Z) är måndag 01:30 i Stockholm men söndag 19:30 i New York.
    const tablesWithLateSundayEvent = () => ({
      users: [user('u-anna', 'Anna', G1, 400), user('u-bertil', 'Bertil', G1, 350)],
      runs: [],
      event_entries: [
        entryRow('e1', 'u-anna', G1, 100, { type: 'participation', qualified_at: '2026-09-27T23:30:00Z', ends_at: '2026-10-02T21:59:59Z' }),
      ],
    });
    const annaIn = async (zone: string | undefined) => {
      setGroupTimeZoneSource(zone ? (groupId) => (groupId === G1 ? zone : undefined) : undefined);
      useDb(tablesWithLateSundayEvent());
      const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
      return res.body.data.users.find((u: any) => u.user_id === 'u-anna');
    };

    // Stockholm: krediterad från veckostart, så den räknas bort och Anna låg bakom Bertil.
    expect(await annaIn('Europe/Stockholm')).toMatchObject({ previous_xp: 300, previous_rank: 2, rank: 1, rank_delta: 1 });
    // New York: krediterad före veckostart, så den räknas inte bort.
    expect(await annaIn('America/New_York')).toMatchObject({ previous_xp: 400, previous_rank: 1, rank: 1, rank_delta: 0 });
  });

  it('500 med {error} vid databasfel', async () => {
    useDb(tables(), { errors: { event_entries: { message: 'boom internal' } } });
    const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch rank delta', code: 'internal_error' });
  });
});

describe('Boardens All-time-ordning (GET /api/auth/users-with-runs)', () => {
  it('Boardens All-time-ordning följer komparatorn vid lika XP', async () => {
    // Infogade i en ordning som INTE är komparatorns: databasens sortering på total_xp ensam ger lika XP i godtycklig ordning.
    const t = {
      users: [
        user('u-cecilia', 'Cecilia', G1, 100),
        user('u-anna-b', 'Anna', G1, 100),
        user('u-bertil', 'bertil', G1, 100),
        user('u-nils', 'Nils', G1, null as unknown as number), // saknad total_xp räknas som 0, som i rank-delta
        user('u-zed', 'Zed', G1, 50),
        user('u-anna-a', 'anna', G1, 100),
        user('u-dora', 'Dora', G1, 200),
        user('u-x', 'Främling', G2, 999),
      ],
      runs: [],
      event_entries: [],
      user_challenge_tokens: [],
    };
    useDb(t);
    const token = mintToken({ group_id: G1 });

    const board = await server.request('GET', '/api/auth/users-with-runs', { token });
    const delta = await server.request('GET', '/api/leaderboard/rank-delta', { token });

    expect(board.status).toBe(200);
    const boardOrder = board.body.data.map((u: any) => u.id);
    // xp fallande, sedan namn (skiftlägesokänsligt), sedan id: 'anna' och 'Anna' är samma namn, så id avgör
    expect(boardOrder).toEqual(['u-dora', 'u-anna-a', 'u-anna-b', 'u-bertil', 'u-cecilia', 'u-zed', 'u-nils']);
    // och är exakt den ordning som rank-delta (och därmed rank_passed) rankar efter
    expect(delta.body.data.users.map((u: any) => u.user_id)).toEqual(boardOrder);
  });
});
