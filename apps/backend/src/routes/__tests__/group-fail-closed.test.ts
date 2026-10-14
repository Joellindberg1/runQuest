/**
 * Saknad group_id i token ger tom data, aldrig andra gruppers rader (ADR 007 A6, fail-closed).
 *
 * Tre läs-routes (GET /auth/users, GET /auth/users-with-runs, GET /challenges/group-stats) lade tidigare på
 * gruppfiltret bara när group_id fanns, så en token utan group_id fick alla gruppers användare. POST /challenges/send
 * hade samma mönster (`groupId && opponent.group_id !== groupId`) och släppte igenom en utmaning över gruppgränsen.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import jwt from 'jsonwebtoken';
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

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const adminToken = (group_id: string | null) => mintToken({ user_id: 'admin-1', group_id });

/** Admin-routen kräver is_admin i users-tabellen; middleware slår upp raden på user_id. */
const usersTables = (): Record<string, Row[]> => ({
  users: [
    { id: 'admin-1', name: 'Admin', email: 'a@x.se', is_admin: true, group_id: G1, runs: [{ count: 2 }] },
    { id: 'u2', name: 'Same group', email: 'b@x.se', is_admin: false, group_id: G1, runs: [{ count: 1 }] },
    { id: 'u3', name: 'Other group', email: 'c@x.se', is_admin: false, group_id: G2, runs: [{ count: 5 }] },
  ],
});

const runsTables = (): Record<string, Row[]> => ({
  users: [
    { id: 'u1', name: 'Anna', group_id: G1, total_xp: 30, runs: [{ id: 'r1', date: '2026-10-01', distance: 5 }] },
    { id: 'u2', name: 'Bertil', group_id: G1, total_xp: 20, runs: [] },
    { id: 'u3', name: 'Stranger', group_id: G2, total_xp: 99, runs: [{ id: 'r9', date: '2026-10-01', distance: 9 }] },
  ],
  user_challenge_tokens: [],
});

const statsTables = (): Record<string, Row[]> => ({
  users: [
    { id: 'u1', name: 'Anna', group_id: G1, wins: 2, draws: 0, losses: 1, challenge_active: false, current_level: 5, profile_picture: null },
    { id: 'u2', name: 'Bertil', group_id: G1, wins: 0, draws: 0, losses: 0, challenge_active: false, current_level: 3, profile_picture: null },
    { id: 'u3', name: 'Stranger', group_id: G2, wins: 9, draws: 0, losses: 0, challenge_active: false, current_level: 9, profile_picture: null },
  ],
  challenges: [{ id: 'c-other', status: 'pending', challenger_id: 'u3', opponent_id: 'u9', group_id: G2 }],
});

describe('GET /api/auth/users (admin)', () => {
  it('token utan group_id ger tom lista, aldrig andra gruppers användare', async () => {
    use(usersTables());
    const res = await server.request('GET', '/api/auth/users', { token: adminToken(null) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('token med group_id ger bara den egna gruppens användare, oförändrat', async () => {
    use(usersTables());
    const res = await server.request('GET', '/api/auth/users', { token: adminToken(G1) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((u: any) => u.id).sort()).toEqual(['admin-1', 'u2']);
    expect(res.body.data.find((u: any) => u.id === 'u2')).toMatchObject({ name: 'Same group', total_runs: 1 });
  });
});

describe('GET /api/auth/users-with-runs', () => {
  it('token utan group_id ger tom lista utan att fråga users, aldrig andra gruppers användare', async () => {
    const db = use(runsTables());
    const res = await server.request('GET', '/api/auth/users-with-runs', { token: mintToken({ group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(db.queries.some((q) => q.table === 'users')).toBe(false);
  });

  it('token med group_id ger bara den egna gruppens användare med sina rundor, oförändrat', async () => {
    const db = use(runsTables());
    const res = await server.request('GET', '/api/auth/users-with-runs', { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: any) => u.id).sort()).toEqual(['u1', 'u2']);
    expect(res.body.data.find((u: any) => u.id === 'u1').runs).toHaveLength(1);
    expect(res.body.data[0].challenge_counts).toEqual({ minor: 0, major: 0, legendary: 0 });
    const usersQuery = db.queries.find((q) => q.table === 'users')!;
    expect(usersQuery.filters).toContainEqual({ op: 'eq', column: 'group_id', value: G1 });
  });
});

describe('GET /api/challenges/group-stats', () => {
  it('token utan group_id ger tom lista, aldrig andra gruppers användare', async () => {
    use(statsTables());
    const res = await server.request('GET', '/api/challenges/group-stats', { token: mintToken({ group_id: null }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('token med group_id ger bara den egna gruppens statistik, sorterad som förut', async () => {
    use(statsTables());
    const res = await server.request('GET', '/api/challenges/group-stats', { token: mintToken({ group_id: G1 }) });
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: any) => s.user_id)).toEqual(['u1', 'u2']);
    expect(res.body.data[0]).toMatchObject({ user_id: 'u1', wins: 2, losses: 1, total: 3, points: 0.667 });
  });
});

describe('POST /api/challenges/send', () => {
  const sendTables = (opponentGroup: string): Record<string, Row[]> => ({
    activity_log: [],
    user_challenge_tokens: [{ id: 't1', user_id: 'a', tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null, challenge_id: null }],
    users: [{ id: 'a', current_level: 6, group_id: G1 }, { id: 'b', current_level: 7, group_id: opponentGroup }],
    challenges: [],
    challenge_rewards: [{
      id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
      loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
    }],
  });
  const send = (group_id: string | null) =>
    server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: 'a', group_id }),
      body: { token_id: 't1', opponent_id: 'b' },
    });

  it('token utan group_id kan inte utmana någon: 400 och ingen utmaning skapas', async () => {
    const tables = sendTables(G2);
    use(tables);
    const res = await send(null);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Opponent is not in your group' });
    expect(tables.challenges).toHaveLength(0);
    expect(tables.user_challenge_tokens[0].sent_at).toBeNull();
  });

  it('token med group_id och motståndare i samma grupp: 201 med gruppen från token, oförändrat', async () => {
    const tables = sendTables(G1);
    use(tables);
    const res = await send(G1);
    expect(res.status).toBe(201);
    expect(tables.challenges).toHaveLength(1);
    expect(tables.challenges[0]).toMatchObject({ group_id: G1, challenger_id: 'a', opponent_id: 'b' });
  });

  it('token med group_id och motståndare i en annan grupp: 400, oförändrat', async () => {
    const tables = sendTables(G2);
    use(tables);
    const res = await send(G1);
    expect(res.status).toBe(400);
    expect(tables.challenges).toHaveLength(0);
  });
});

describe('token med group_id: null i JWT-claimet', () => {
  it('behandlas som saknad grupp (inte som en grupp som heter "null")', async () => {
    use(runsTables());
    const token = jwt.sign(
      { user_id: 'u1', name: 'Anna', email: 'a@x.se', group_id: null },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' },
    );
    const res = await server.request('GET', '/api/auth/users-with-runs', { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });
});
