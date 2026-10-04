/**
 * ADR 007 B9–B10:
 *   GET  /api/runs/group-history  — offset-paginering, meta, stabil sortering, start_time/created_at
 *   POST /api/runs                — valfritt is_treadmill (NULL bevaras när det utelämnas)
 * Fake-DB som tillämpar filter: gruppisolering bevisas på riktiga rader.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({
  calculateUserTotals: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const G1 = 'group-1';
const G2 = 'group-2';

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

function runRow(id: string, group_id: string, extra: Row = {}): Row {
  return {
    id,
    user_id: `user-of-${group_id}`,
    date: '2026-09-20',
    distance: '5.0',
    xp_gained: 30,
    multiplier: '1.0',
    streak_day: 1,
    base_xp: 15,
    km_xp: 10,
    distance_bonus: 5,
    streak_bonus: 0,
    source: 'manual',
    is_treadmill: null,
    start_time: null,
    created_at: '2026-09-20T08:00:00Z',
    run_weather: null,
    users: { group_id, name: group_id === G1 ? 'Anna' : 'Främling', current_level: 3, profile_picture: null, total_xp: 100 },
    ...extra,
  };
}

describe('GET /api/runs/group-history', () => {
  const token = () => mintToken({ user_id: 'user-of-group-1', group_id: G1 });

  it('kräver token (401)', async () => {
    expect((await server.request('GET', '/api/runs/group-history')).status).toBe(401);
  });

  it('utan parametrar: nyckeln runs, default limit 100, additivt meta', async () => {
    const rows = Array.from({ length: 105 }, (_, i) => runRow(`r-${String(i).padStart(3, '0')}`, G1, { date: `2026-0${1 + (i % 9)}-15` }));
    useDb({ runs: rows });
    const res = await server.request('GET', '/api/runs/group-history', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(100);
    expect(res.body.meta).toEqual({ total: 105, limit: 100, offset: 0, has_more: true });
    expect(res.body.success).toBeUndefined(); // befintlig svarsform bevaras (ADR 007 A2)
  });

  it('befintliga fält bevaras och start_time/created_at tillkommer', async () => {
    useDb({
      runs: [runRow('r-1', G1, { start_time: '2026-09-20T06:30:00Z', created_at: '2026-09-20T07:45:00Z', is_treadmill: false, source: 'strava', run_weather: { weather_code: 3, temperature_c: '12.5' } })],
    });
    const res = await server.request('GET', '/api/runs/group-history', { token: token() });
    expect(res.body.runs[0]).toEqual({
      id: 'r-1',
      user_id: 'user-of-group-1',
      date: '2026-09-20',
      distance: 5,
      xp_gained: 30,
      multiplier: 1,
      streak_day: 1,
      base_xp: 15,
      km_xp: 10,
      distance_bonus: 5,
      streak_bonus: 0,
      source: 'strava',
      is_treadmill: false,
      weather_code: 3,
      temperature_c: 12.5,
      user_name: 'Anna',
      user_level: 3,
      user_total_xp: 100,
      user_profile_picture: undefined,
      start_time: '2026-09-20T06:30:00Z',
      created_at: '2026-09-20T07:45:00Z',
    });
  });

  it('start_time och created_at är null när de saknas', async () => {
    useDb({ runs: [runRow('r-1', G1, { start_time: undefined, created_at: undefined })] });
    const res = await server.request('GET', '/api/runs/group-history', { token: token() });
    expect(res.body.runs[0].start_time).toBeNull();
    expect(res.body.runs[0].created_at).toBeNull();
  });

  it('gruppisolering: annan grupps rundor syns aldrig, varken i runs eller total', async () => {
    useDb({
      runs: [
        runRow('mine-1', G1),
        runRow('mine-2', G1),
        runRow('stranger-1', G2),
        runRow('stranger-2', G2),
      ],
    });
    const res = await server.request('GET', '/api/runs/group-history', { token: token() });
    expect(res.body.runs.map((r: any) => r.id).sort()).toEqual(['mine-1', 'mine-2']);
    expect(res.body.meta.total).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain('Främling');
  });

  it('sorterar date desc, created_at desc, id desc — lika datum ger deterministisk ordning över sidgräns', async () => {
    const sameCreated = '2026-09-20T08:00:00Z';
    useDb({
      runs: [
        runRow('a', G1, { date: '2026-09-19' }),
        runRow('b', G1, { date: '2026-09-20', created_at: sameCreated }),
        runRow('c', G1, { date: '2026-09-20', created_at: sameCreated }),
        runRow('d', G1, { date: '2026-09-20', created_at: sameCreated }),
        runRow('e', G1, { date: '2026-09-20', created_at: '2026-09-20T12:00:00Z' }), // senare skapad ⇒ före b/c/d
        runRow('f', G1, { date: '2026-09-21' }),
      ],
    });
    const get = (qs: string) => server.request('GET', `/api/runs/group-history?${qs}`, { token: token() });
    const ids = (r: any) => r.body.runs.map((x: any) => x.id);

    const p1 = await get('limit=2&offset=0');
    const p2 = await get('limit=2&offset=2');
    const p3 = await get('limit=2&offset=4');
    expect(ids(p1)).toEqual(['f', 'e']);
    expect(ids(p2)).toEqual(['d', 'c']); // lika date + created_at: id desc över sidgränsen
    expect(ids(p3)).toEqual(['b', 'a']);
    expect(p1.body.meta).toEqual({ total: 6, limit: 2, offset: 0, has_more: true });
    expect(p3.body.meta).toEqual({ total: 6, limit: 2, offset: 4, has_more: false });
    // en enda sida i samma ordning som de sammanfogade sidorna
    const all = await get('limit=6');
    expect(ids(all)).toEqual([...ids(p1), ...ids(p2), ...ids(p3)]);
  });

  it('offset bortom slutet ger tom sida med korrekt total (PostgREST 416 ska inte bli 500)', async () => {
    useDb({ runs: [runRow('a', G1), runRow('b', G1)] });
    const res = await server.request('GET', '/api/runs/group-history?limit=10&offset=50', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([]);
    expect(res.body.meta).toEqual({ total: 2, limit: 10, offset: 50, has_more: false });
  });

  it('token utan group_id ger tom lista och meta, utan DB-anrop (ADR A6) — inte alla gruppers rundor', async () => {
    const db = useDb({ runs: [runRow('mine', G1), runRow('theirs', G2)] });
    const res = await server.request('GET', '/api/runs/group-history', { token: mintToken({ user_id: 'user-of-group-1', group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([]);
    expect(res.body.meta).toEqual({ total: 0, limit: 100, offset: 0, has_more: false });
    expect(db.queries).toHaveLength(0);
  });

  it('ogiltig limit utan group_id ger 400 (validering före gruppkontroll)', async () => {
    useDb({ runs: [] });
    const res = await server.request('GET', '/api/runs/group-history?limit=0', { token: mintToken({ user_id: 'user-of-group-1', group_id: null }) });
    expect(res.status).toBe(400);
  });

  it('limit upp till max 200 accepteras', async () => {
    useDb({ runs: [runRow('a', G1)] });
    const res = await server.request('GET', '/api/runs/group-history?limit=200', { token: token() });
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(200);
  });

  it.each(['limit=0', 'limit=201', 'limit=-5', 'limit=abc', 'offset=-1', 'offset=1.5', 'offset=x'])('ogiltig pagination (%s) ger 400', async (qs) => {
    useDb({ runs: [] });
    const res = await server.request('GET', `/api/runs/group-history?${qs}`, { token: token() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('DB-fel ger 500 med { error }', async () => {
    useDb({ runs: [] }, { errors: { runs: { message: 'boom' } } });
    const res = await server.request('GET', '/api/runs/group-history', { token: token() });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('POST /api/runs — is_treadmill', () => {
  const USER = 'user-1';
  const token = () => mintToken({ user_id: USER, group_id: G1 });
  const post = (body: unknown) => server.request('POST', '/api/runs', { token: token(), body });

  function freshTables(): Record<string, Row[]> {
    return { runs: [], user_boosts: [], admin_settings: [], streak_multipliers: [], users: [] };
  }

  it('is_treadmill: true sparas som true och finns i svaret', async () => {
    const tables = freshTables();
    useDb(tables, { autoIds: true });
    const res = await post({ date: '2026-09-01', distance: 5, is_treadmill: true });
    expect(res.status).toBe(200);
    expect(tables.runs).toHaveLength(1);
    expect(tables.runs[0].is_treadmill).toBe(true);
    expect(res.body.run.is_treadmill).toBe(true);
  });

  it('is_treadmill: false sparas som false (inte NULL)', async () => {
    const tables = freshTables();
    useDb(tables, { autoIds: true });
    const res = await post({ date: '2026-09-01', distance: 5, is_treadmill: false });
    expect(res.status).toBe(200);
    expect(tables.runs[0].is_treadmill).toBe(false);
    expect(res.body.run.is_treadmill).toBe(false);
  });

  it('utelämnat is_treadmill lämnar kolumnen NULL — dagens beteende, ingen regeländring', async () => {
    const tables = freshTables();
    const db = useDb(tables, { autoIds: true });
    const res = await post({ date: '2026-09-01', distance: 5 });
    expect(res.status).toBe(200);
    expect(tables.runs).toHaveLength(1);
    expect('is_treadmill' in tables.runs[0]).toBe(false); // nyckeln skickas inte alls → DB-default NULL
    expect(tables.runs[0].is_treadmill ?? null).toBeNull();
    expect(db.queries.some((q) => q.table === 'runs')).toBe(true);
  });

  it.each([['"true"', 'true'], ['1', 1], ['null', null], ['objekt', {}]])('is_treadmill av fel typ (%s) ger 400 och ingen skrivning', async (_label, value) => {
    const tables = freshTables();
    useDb(tables, { autoIds: true });
    const res = await post({ date: '2026-09-01', distance: 5, is_treadmill: value });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringContaining('is_treadmill') });
    expect(tables.runs).toHaveLength(0);
  });

  it('kräver fortfarande token (401)', async () => {
    const res = await server.request('POST', '/api/runs', { body: { date: '2026-09-01', distance: 5, is_treadmill: true } });
    expect(res.status).toBe(401);
  });

  it('PUT /runs/:id ändrar inte is_treadmill (ADR 007 B10: PUT oförändrat)', async () => {
    const tables = freshTables();
    tables.runs = [{ id: 'run-1', user_id: USER, date: '2026-09-01', distance: 5, streak_day: 1, is_treadmill: false }];
    useDb(tables, { autoIds: true });
    const res = await server.request('PUT', '/api/runs/run-1', { token: token(), body: { date: '2026-09-01', distance: 6, is_treadmill: true } });
    expect(res.status).toBe(200);
    expect(tables.runs[0].distance).toBe(6);
    expect(tables.runs[0].is_treadmill).toBe(false);
  });
});
