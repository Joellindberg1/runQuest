/**
 * GET /api/leaderboard/week (ADR 007 B1) — route-test mot app-factoryn med fake-DB.
 * Beräkningslogiken testas i packages/shared; här: HTTP-form, validering,
 * gruppavgränsning och DB-vägen.
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
import { clearBestWeekCache } from '../leaderboard.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

// Torsdag 2026-10-01 -> veckan 2026-09-28..2026-10-04, förra veckan startar 2026-09-21
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
  clearBestWeekCache();
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const G1 = 'group-1';
const G2 = 'group-2';

function user(id: string, name: string, group_id: string, extra: Row = {}): Row {
  return { id, name, group_id, profile_picture: null, current_level: 4, created_at: '2026-01-01T08:00:00Z', ...extra };
}
function run(user_id: string, group_id: string, date: string, distance: number, xp_gained: number): Row {
  return { user_id, date, distance, xp_gained, users: { group_id } };
}

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const baseTables = () => ({
  users: [
    user('u-anna', 'Anna', G1),
    user('u-bertil', 'Bertil', G1, { current_level: 7, profile_picture: 'https://img/b.png' }),
    user('u-cecilia', 'Cecilia', G1),
    user('u-x', 'Främling', G2),
  ],
  runs: [
    // förra veckan: Bertil 1, Anna 2
    run('u-bertil', G1, '2026-09-22', 10, 90),
    run('u-anna', G1, '2026-09-23', 5, 50),
    // denna vecka: Anna 1, Bertil 2
    run('u-anna', G1, '2026-09-28', 8, 70),
    run('u-anna', G1, '2026-09-30', 4, 40),
    run('u-bertil', G1, '2026-09-29', 5, 50),
    // annan grupp — får aldrig synas
    run('u-x', G2, '2026-09-28', 100, 999),
    // äldre historik: bästa veckan någonsin för G1 (2026-06-01..07): 40 km
    run('u-anna', G1, '2026-06-02', 20, 100),
    run('u-bertil', G1, '2026-06-04', 20, 100),
  ],
});

describe('GET /api/leaderboard/week', () => {
  it('kräver token (401)', async () => {
    const res = await server.request('GET', '/api/leaderboard/week');
    expect(res.status).toBe(401);
  });

  it('svarar {success,data} med exakt kontraktsform, snake_case, rankad lista', async () => {
    useDb(baseTables());
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    const d = res.body.data;
    expect(d.week).toEqual({
      start: '2026-09-28', end: '2026-10-04', previous_start: '2026-09-21', is_current: true, today: '2026-10-01',
    });
    expect(d.users.map((u: any) => [u.name, u.rank, u.previous_rank, u.rank_delta])).toEqual([
      ['Anna', 1, 2, 1],
      ['Bertil', 2, 1, -1],
      ['Cecilia', 3, 3, 0],
    ]);
    const anna = d.users[0];
    expect(Object.keys(anna).sort()).toEqual([
      'days', 'km', 'level', 'name', 'previous_rank', 'profile_picture', 'rank', 'rank_delta', 'runs', 'user_id', 'xp',
    ]);
    expect(anna).toMatchObject({ user_id: 'u-anna', level: 4, km: 12, runs: 2, xp: 110 });
    expect(anna.days).toHaveLength(7);
    expect(anna.days[0]).toEqual({ date: '2026-09-28', km: 8, xp: 70, runs: 1 });
    expect(anna.days[2]).toEqual({ date: '2026-09-30', km: 4, xp: 40, runs: 1 });
    expect(d.users[1].profile_picture).toBe('https://img/b.png');
    expect(d.mover).toEqual({ user_id: 'u-anna', rank_delta: 1 });
  });

  it('pack-totaler: km, rundor, xp, aktiva av totala och procent av gruppens bästa vecka', async () => {
    useDb(baseTables());
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });
    expect(res.body.data.totals).toEqual({
      km: 17, runs: 3, xp: 160, active_runners: 2, members: 3,
      best_week_km: 40, pct_of_best_week: 43, // 17/40 = 42.5 -> 43
    });
  });

  it('visar aldrig en annan grupps användare eller rundor', async () => {
    useDb(baseTables());
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('u-x');
    expect(body).not.toContain('Främling');
    expect(res.body.data.totals.km).toBe(17); // utan G2:s 100 km
  });

  it('en annan grupp ser sin egen data', async () => {
    useDb(baseTables());
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G2 }) });
    expect(res.body.data.users.map((u: any) => u.user_id)).toEqual(['u-x']);
    expect(res.body.data.totals.km).toBe(100);
  });

  it('saknad group_id i token ger tom data (inte "alla") och rör inte databasen', async () => {
    const db = useDb(baseTables());
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual([]);
    expect(res.body.data.totals).toMatchObject({ km: 0, runs: 0, xp: 0, active_runners: 0, members: 0 });
    expect(res.body.data.mover).toBeNull();
    expect(res.body.data.week.start).toBe('2026-09-28');
    expect(db.queries).toHaveLength(0);
  });

  it('week_start = en tidigare måndag ger den veckan (is_current false) med förra veckan relativt den', async () => {
    useDb(baseTables());
    const res = await server.request('GET', '/api/leaderboard/week?week_start=2026-09-21', { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(200);
    expect(res.body.data.week).toMatchObject({
      start: '2026-09-21', end: '2026-09-27', previous_start: '2026-09-14', is_current: false,
    });
    expect(res.body.data.users[0]).toMatchObject({ name: 'Bertil', km: 10, xp: 90 });
  });

  it.each([
    ['inte en måndag', '2026-09-29'],
    ['i framtiden', '2026-10-05'],
    ['fel format', '28-09-2026'],
    ['omöjligt datum', '2026-02-30'],
    ['tomt värde', ''],
  ])('400 när week_start är %s', async (_label, value) => {
    useDb(baseTables());
    const res = await server.request('GET', `/api/leaderboard/week?week_start=${value}`, { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('gör en enda runs-query för veckorna (ingen N+1) filtrerad på grupp via join', async () => {
    const db = useDb(baseTables());
    await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });
    const weekRunQueries = db.queries.filter(
      (q) => q.table === 'runs' && q.filters.some((f) => f.op === 'gte' && f.column === 'date'),
    );
    expect(weekRunQueries).toHaveLength(1);
    expect(weekRunQueries[0].select).toContain('users!inner(group_id)');
    expect(weekRunQueries[0].filters).toContainEqual({ op: 'eq', column: 'users.group_id', value: G1 });
    expect(weekRunQueries[0].filters).toContainEqual({ op: 'gte', column: 'date', value: '2026-09-21' });
    expect(weekRunQueries[0].filters).toContainEqual({ op: 'lte', column: 'date', value: '2026-10-04' });
    expect(db.queries.filter((q) => q.table === 'users')).toHaveLength(1);
  });

  it('hela runs-historiken läses sidvis så att bästa veckan inte kapas vid 1000 rader', async () => {
    const tables = baseTables();
    // 1200 rundor à 1 km samma dag i en tidigare vecka -> bästa vecka 1200 km (+ ev. andra rundor den veckan: inga)
    for (let i = 0; i < 1200; i++) tables.runs.push(run('u-anna', G1, '2026-03-10', 1, 1));
    useDb(tables);
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });
    expect(res.body.data.totals.best_week_km).toBe(1200);
  });

  it('procent av bästa vecka är 100 när veckan är den bästa (aktuell vecka räknas med)', async () => {
    const tables = baseTables();
    tables.runs = tables.runs.filter((r) => r.date >= '2026-09-21');
    useDb(tables);
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });
    expect(res.body.data.totals.best_week_km).toBe(17);
    expect(res.body.data.totals.pct_of_best_week).toBe(100);
  });

  it('500 med {error} vid databasfel, utan att läcka felmeddelandet', async () => {
    useDb(baseTables(), { errors: { runs: { message: 'relation "runs" secret detail' } } });
    const res = await server.request('GET', '/api/leaderboard/week', { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch week leaderboard' });
  });
});
