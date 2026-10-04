/**
 * GET /api/challenges/group-history och GET /api/challenges/head-to-head/:userId (ADR 007 B5–B6).
 * Route-test mot app-factoryn med fake-DB som TILLÄMPAR filter, så gruppisolering bevisas på riktiga rader.
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
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ANNA = uid(1);
const BERTIL = uid(2);
const CECILIA = uid(3);
const STRANGER = uid(9);

function user(id: string, name: string, group_id: string, extra: Row = {}): Row {
  return { id, name, group_id, profile_picture: null, current_level: 5, ...extra };
}

let seq = 0;
function challenge(extra: Row): Row {
  seq += 1;
  return {
    id: `c-${String(seq).padStart(3, '0')}`,
    group_id: G1,
    tier: 'minor',
    metric: 'km',
    duration_days: 3,
    status: 'completed',
    challenger_id: ANNA,
    opponent_id: BERTIL,
    challenger_level: 4,
    opponent_level: 6,
    start_date: '2026-09-01',
    end_date: '2026-09-04',
    determine_at: '2026-09-05T01:00:00Z',
    outcome: 'challenger_wins',
    winner_id: ANNA,
    challenger_final_value: 12.5,
    opponent_final_value: 9,
    winner_type: 'multiplier_days',
    winner_delta: 0.1,
    winner_duration: 3,
    loser_type: 'xp_flat',
    loser_delta: 5,
    loser_duration: null,
    created_at: '2026-08-31T10:00:00Z',
    ...extra,
  };
}

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const users = () => [
  user(ANNA, 'Anna', G1, { profile_picture: 'https://img/a.png' }),
  user(BERTIL, 'Bertil', G1),
  user(CECILIA, 'Cecilia', G1),
  user(STRANGER, 'Främling', G2),
];

describe('GET /api/challenges/group-history', () => {
  it('kräver token (401)', async () => {
    expect((await server.request('GET', '/api/challenges/group-history')).status).toBe(401);
  });

  it('returnerar bara gruppens avslutade utmaningar — främlingens grupp syns aldrig', async () => {
    useDb({
      users: users(),
      challenges: [
        challenge({ id: 'mine-1' }),
        challenge({ id: 'other-group', group_id: G2, challenger_id: STRANGER, opponent_id: uid(8), winner_id: STRANGER }),
        challenge({ id: 'still-active', status: 'active', outcome: null, winner_id: null }),
        challenge({ id: 'still-pending', status: 'pending', outcome: null, winner_id: null }),
      ],
    });
    const res = await server.request('GET', '/api/challenges/group-history', { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.map((i: any) => i.id)).toEqual(['mine-1']);
    expect(JSON.stringify(res.body)).not.toContain('Främling');
  });

  it('mappar svarsformen enligt ADR 007 B5', async () => {
    useDb({ users: users(), challenges: [challenge({ id: 'c-x', tier: 'major', metric: 'runs', duration_days: 7, challenger_final_value: 5, opponent_final_value: 3 })] });
    const res = await server.request('GET', '/api/challenges/group-history', { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    expect(res.body.data.items[0]).toEqual({
      id: 'c-x',
      tier: 'major',
      metric: 'runs',
      duration_days: 7,
      start_date: '2026-09-01',
      end_date: '2026-09-04',
      ended_at: '2026-09-05T01:00:00Z',
      outcome: 'challenger_wins',
      winner_id: ANNA,
      challenger: { id: ANNA, name: 'Anna', profile_picture: 'https://img/a.png', level: 4 },
      opponent: { id: BERTIL, name: 'Bertil', profile_picture: null, level: 6 },
      challenger_value: 5,
      opponent_value: 3,
      winner_boost: { type: 'multiplier_days', delta: 0.1, duration: 3 },
      loser_boost: { type: 'xp_flat', delta: 5, duration: null },
    });
    expect(res.body.meta).toEqual({ total: 1, limit: 20, offset: 0, has_more: false });
  });

  it('numeric-fält som kommer som strängar returneras som tal; saknade slutvärden som null', async () => {
    useDb({
      users: users(),
      challenges: [challenge({ challenger_final_value: '12.50', opponent_final_value: null, winner_delta: '0.10', loser_delta: '5.00' })],
    });
    const res = await server.request('GET', '/api/challenges/group-history', { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    const item = res.body.data.items[0];
    expect(item.challenger_value).toBe(12.5);
    expect(item.opponent_value).toBeNull();
    expect(item.winner_boost.delta).toBe(0.1);
    expect(item.loser_boost.delta).toBe(5);
  });

  it('saknad group_id i token ger tom data, inte alla grupper (ADR A6)', async () => {
    useDb({ users: users(), challenges: [challenge({}), challenge({ group_id: G2 })] });
    const res = await server.request('GET', '/api/challenges/group-history', { token: mintToken({ user_id: ANNA, group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.meta).toEqual({ total: 0, limit: 20, offset: 0, has_more: false });
  });

  it('sorterar nyast först (determine_at desc, id desc) med deterministisk ordning vid lika tid över sidgräns', async () => {
    const same = '2026-09-10T01:00:00Z';
    useDb({
      users: users(),
      challenges: [
        challenge({ id: 'a-old', determine_at: '2026-09-01T01:00:00Z' }),
        challenge({ id: 'b-same', determine_at: same }),
        challenge({ id: 'd-same', determine_at: same }),
        challenge({ id: 'c-same', determine_at: same }),
        challenge({ id: 'e-new', determine_at: '2026-09-20T01:00:00Z' }),
      ],
    });
    const token = mintToken({ user_id: ANNA, group_id: G1 });
    const page1 = await server.request('GET', '/api/challenges/group-history?limit=2&offset=0', { token });
    const page2 = await server.request('GET', '/api/challenges/group-history?limit=2&offset=2', { token });
    const page3 = await server.request('GET', '/api/challenges/group-history?limit=2&offset=4', { token });
    const ids = (r: any) => r.body.data.items.map((i: any) => i.id);
    expect(ids(page1)).toEqual(['e-new', 'd-same']);
    expect(ids(page2)).toEqual(['c-same', 'b-same']); // lika determine_at: id desc över sidgränsen
    expect(ids(page3)).toEqual(['a-old']);
    expect(page1.body.meta).toEqual({ total: 5, limit: 2, offset: 0, has_more: true });
    expect(page2.body.meta).toEqual({ total: 5, limit: 2, offset: 2, has_more: true });
    expect(page3.body.meta).toEqual({ total: 5, limit: 2, offset: 4, has_more: false });
  });

  it('total räknar hela gruppens avslutade, inte bara sidan', async () => {
    useDb({ users: users(), challenges: Array.from({ length: 7 }, () => challenge({})) });
    const res = await server.request('GET', '/api/challenges/group-history?limit=3', { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    expect(res.body.data.items).toHaveLength(3);
    expect(res.body.meta.total).toBe(7);
  });

  it('offset bortom sista raden (PostgREST 416) ger tom sida med korrekt total, inte 500', async () => {
    useDb({ users: users(), challenges: [challenge({}), challenge({})] });
    const res = await server.request('GET', '/api/challenges/group-history?limit=5&offset=10', { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.meta).toEqual({ total: 2, limit: 5, offset: 10, has_more: false });
  });

  it.each(['limit=0', 'limit=51', 'limit=abc', 'offset=-1', 'offset=1.5'])('ogiltig pagination (%s) ger 400', async (qs) => {
    useDb({ users: users(), challenges: [] });
    const res = await server.request('GET', `/api/challenges/group-history?${qs}`, { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('DB-fel ger 500 med { error }', async () => {
    useDb({ users: users(), challenges: [] }, { errors: { challenges: { message: 'boom' } } });
    const res = await server.request('GET', '/api/challenges/group-history', { token: mintToken({ user_id: ANNA, group_id: G1 }) });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('GET /api/challenges/head-to-head/:userId', () => {
  const tokenAnna = () => mintToken({ user_id: ANNA, group_id: G1 });

  it('kräver token (401)', async () => {
    expect((await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`)).status).toBe(401);
  });

  it('400 på ogiltigt uuid', async () => {
    useDb({ users: users(), challenges: [] });
    const res = await server.request('GET', '/api/challenges/head-to-head/not-a-uuid', { token: tokenAnna() });
    expect(res.status).toBe(400);
  });

  it('400 mot sig själv', async () => {
    useDb({ users: users(), challenges: [] });
    const res = await server.request('GET', `/api/challenges/head-to-head/${ANNA}`, { token: tokenAnna() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('404 för användare i annan grupp (läcker inte existens)', async () => {
    useDb({ users: users(), challenges: [challenge({ group_id: G2, challenger_id: STRANGER, opponent_id: uid(8) })] });
    const res = await server.request('GET', `/api/challenges/head-to-head/${STRANGER}`, { token: tokenAnna() });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Främling');
  });

  it('404 för användare som inte finns — samma svar som annan grupp', async () => {
    useDb({ users: users(), challenges: [] });
    const missing = await server.request('GET', `/api/challenges/head-to-head/${uid(77)}`, { token: tokenAnna() });
    const other = await server.request('GET', `/api/challenges/head-to-head/${STRANGER}`, { token: tokenAnna() });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(other.body);
  });

  it('404 när anroparen saknar group_id', async () => {
    useDb({ users: users(), challenges: [] });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: mintToken({ user_id: ANNA, group_id: null }) });
    expect(res.status).toBe(404);
  });

  it('räknar record ur anroparens perspektiv över båda orienteringarna', async () => {
    useDb({
      users: users(),
      challenges: [
        // Anna utmanare: vinst
        challenge({ id: 'w1', challenger_id: ANNA, opponent_id: BERTIL, outcome: 'challenger_wins', winner_id: ANNA }),
        // Anna motståndare: vinst (opponent_wins)
        challenge({ id: 'w2', challenger_id: BERTIL, opponent_id: ANNA, outcome: 'opponent_wins', winner_id: ANNA }),
        // Anna utmanare: förlust
        challenge({ id: 'l1', challenger_id: ANNA, opponent_id: BERTIL, outcome: 'opponent_wins', winner_id: BERTIL }),
        // Anna motståndare: förlust (challenger_wins)
        challenge({ id: 'l2', challenger_id: BERTIL, opponent_id: ANNA, outcome: 'challenger_wins', winner_id: BERTIL }),
        challenge({ id: 'l3', challenger_id: BERTIL, opponent_id: ANNA, outcome: 'challenger_wins', winner_id: BERTIL }),
        challenge({ id: 'd1', challenger_id: ANNA, opponent_id: BERTIL, outcome: 'draw', winner_id: null }),
        // ska inte räknas: annan motståndare, ej avslutad
        challenge({ id: 'other-pair', challenger_id: ANNA, opponent_id: CECILIA }),
        challenge({ id: 'not-done', status: 'active', outcome: null, winner_id: null }),
      ],
    });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: tokenAnna() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.record).toEqual({ wins: 2, draws: 1, losses: 3, total: 6 });
    expect(res.body.data.opponent).toEqual({ id: BERTIL, name: 'Bertil', profile_picture: null });

    // Samma par sett från Bertils håll speglar rekordet
    const mirror = await server.request('GET', `/api/challenges/head-to-head/${ANNA}`, { token: mintToken({ user_id: BERTIL, group_id: G1 }) });
    expect(mirror.body.data.record).toEqual({ wins: 3, draws: 1, losses: 2, total: 6 });
  });

  it('history = senaste limit (default 5) nyast först med stabil tie-breaker, record täcker alla', async () => {
    const rows: Row[] = [];
    for (let i = 1; i <= 7; i++) {
      rows.push(challenge({ id: `h-${i}`, determine_at: `2026-09-0${i}T01:00:00Z` }));
    }
    // exakt samma tid som h-7 — id desc avgör ('h-tie-a' > 'h-7')
    rows.push(challenge({ id: 'h-tie-a', determine_at: '2026-09-07T01:00:00Z' }));
    useDb({ users: users(), challenges: rows });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: tokenAnna() });
    expect(res.body.data.history.map((h: any) => h.id)).toEqual(['h-tie-a', 'h-7', 'h-6', 'h-5', 'h-4']);
    expect(res.body.data.record.total).toBe(8);
    expect(res.body.data.history[0].challenger).toEqual({ id: ANNA, name: 'Anna', profile_picture: 'https://img/a.png', level: 4 });

    const limited = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}?limit=2`, { token: tokenAnna() });
    expect(limited.body.data.history).toHaveLength(2);
  });

  it.each(['limit=0', 'limit=21', 'limit=x'])('ogiltig limit (%s) ger 400', async (qs) => {
    useDb({ users: users(), challenges: [] });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}?${qs}`, { token: tokenAnna() });
    expect(res.status).toBe(400);
  });

  it('active = pågående utmaning mellan paret (inte andras), annars null', async () => {
    useDb({
      users: users(),
      challenges: [
        challenge({ id: 'old' }),
        challenge({ id: 'live', status: 'active', challenger_id: BERTIL, opponent_id: ANNA, outcome: null, winner_id: null }),
        challenge({ id: 'others-active', status: 'active', challenger_id: CECILIA, opponent_id: uid(5), outcome: null, winner_id: null }),
      ],
    });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: tokenAnna() });
    expect(res.body.data.active).toEqual({ id: 'live', status: 'active', challenger_id: BERTIL });
    expect(res.body.data.history.map((h: any) => h.id)).toEqual(['old']); // active ligger inte i historiken

    useDb({ users: users(), challenges: [challenge({ id: 'old' })] });
    const none = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: tokenAnna() });
    expect(none.body.data.active).toBeNull();
  });

  it('pending utmaning mellan paret rapporteras som active med status pending', async () => {
    useDb({
      users: users(),
      challenges: [challenge({ id: 'p', status: 'pending', outcome: null, winner_id: null })],
    });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: tokenAnna() });
    expect(res.body.data.active).toEqual({ id: 'p', status: 'pending', challenger_id: ANNA });
  });

  it('inga möten ger noll-record och tom historik', async () => {
    useDb({ users: users(), challenges: [] });
    const res = await server.request('GET', `/api/challenges/head-to-head/${BERTIL}`, { token: tokenAnna() });
    expect(res.status).toBe(200);
    expect(res.body.data.record).toEqual({ wins: 0, draws: 0, losses: 0, total: 0 });
    expect(res.body.data.history).toEqual([]);
    expect(res.body.data.active).toBeNull();
  });
});
