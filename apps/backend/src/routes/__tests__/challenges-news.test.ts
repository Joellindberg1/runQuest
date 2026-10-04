/**
 * Pack News-skrivpunkter i routes/challenges.ts (ADR 008 beslut 5):
 *  - POST /send → challenge_received
 *  - PUT /:id/respond (decline) och PUT /:id/withdraw → raden återkallas (retract)
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

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const sendTables = (): Record<string, Row[]> => ({
  activity_log: [],
  user_challenge_tokens: [{ id: 't1', user_id: 'a', tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null }],
  users: [{ id: 'a', current_level: 6, group_id: 'g1' }, { id: 'b', current_level: 7, group_id: 'g1' }],
  challenges: [],
  challenge_rewards: [{
    id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
    loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
  }],
});

describe('POST /api/challenges/send → challenge_received', () => {
  it('loggar exakt en challenge_received: utmanaren → motståndaren, utan att ändra svaret', async () => {
    const tables = sendTables();
    use(tables);
    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: 'a', group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: 'b' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { challenge_id: 'gen-1' } });
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      group_id: 'g1', type: 'challenge_received', actor_user_id: 'a', target_user_id: 'b', is_backfill: false,
      dedupe_key: 'challenge_received:gen-1',
      payload: { challenge_id: 'gen-1', tier: 'major', metric: 'km', duration_days: 5 },
    });
  });

  it('en trasig logg fäller inte utskicket (utmaningen skapas ändå, 201)', async () => {
    const tables = sendTables();
    const db = createFakeDb(tables, { autoIds: true, errors: { activity_log: { message: 'relation does not exist' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: 'a', group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: 'b' },
    });
    expect(res.status).toBe(201);
    expect(tables.challenges).toHaveLength(1);
  });

  it('avvisat utskick (opponent i annan grupp) ger ingen rad', async () => {
    const tables = sendTables();
    tables.users[1].group_id = 'other-group';
    use(tables);
    const res = await server.request('POST', '/api/challenges/send', {
      token: mintToken({ user_id: 'a', group_id: 'g1' }),
      body: { token_id: 't1', opponent_id: 'b' },
    });
    expect(res.status).toBe(400);
    expect(tables.activity_log).toHaveLength(0);
  });
});

const pendingTables = (): Record<string, Row[]> => ({
  activity_log: [
    { id: 1, dedupe_key: 'challenge_received:c1', type: 'challenge_received' },
    { id: 2, dedupe_key: 'challenge_received:c2', type: 'challenge_received' },
  ],
  challenges: [
    { id: 'c1', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b' },
    { id: 'c2', status: 'pending', tier: 'minor', challenger_id: 'x', opponent_id: 'y' },
  ],
  user_challenge_tokens: [{ id: 't1', challenge_id: 'c1', sent_at: '2026-10-05T10:00:00.000Z' }],
  users: [{ id: 'a', challenge_active: true }, { id: 'b', challenge_active: true }],
});

describe('återkallad/avböjd utmaning → challenge_received återkallas', () => {
  it('PUT /:id/respond decline tar bort raden för just den utmaningen', async () => {
    const tables = pendingTables();
    use(tables);
    const res = await server.request('PUT', '/api/challenges/c1/respond', {
      token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'decline' },
    });
    expect(res.status).toBe(200);
    expect(tables.challenges.map((c) => c.id)).toEqual(['c2']);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:c2']);
  });

  it('PUT /:id/withdraw tar bort raden för just den utmaningen', async () => {
    const tables = pendingTables();
    use(tables);
    const res = await server.request('PUT', '/api/challenges/c1/withdraw', { token: mintToken({ user_id: 'a', group_id: 'g1' }) });
    expect(res.status).toBe(200);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:c2']);
  });

  it('accept lämnar raden kvar (utmaningen finns ju)', async () => {
    const tables = pendingTables();
    tables.challenges[0].duration_days = 3;
    use(tables);
    const res = await server.request('PUT', '/api/challenges/c1/respond', {
      token: mintToken({ user_id: 'b', group_id: 'g1' }), body: { action: 'accept' },
    });
    expect(res.status).toBe(200);
    expect(tables.activity_log).toHaveLength(2);
  });
});
