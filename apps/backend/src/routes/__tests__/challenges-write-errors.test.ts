/**
 * RUN-215 T6 — routes/challenges.ts svarar inte 200/201 när en skrivning misslyckats.
 *
 * Tidigare: token-markeringen i POST /send, token/challenge_active-återställningen i decline/withdraw och
 * status/challenge_active-uppdateringen i accept kontrollerades inte. Klienten fick 201/200 för en utmaning vars
 * token aldrig markerades som skickad (kan skickas igen) eller som aldrig blev aktiv.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row, type RecordedQuery } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

function use(tables: Record<string, Row[]>, failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'], failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const fail = (message: string) => ({ message });
// Riktiga uuid: /send avvisar opponent_id som inte är ett uuid.
const A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';


const sendTables = (): Record<string, Row[]> => ({
  activity_log: [],
  user_challenge_tokens: [{ id: 't1', user_id: A_ID, tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null, challenge_id: null }],
  users: [{ id: A_ID, current_level: 6, group_id: 'g1' }, { id: B_ID, current_level: 7, group_id: 'g1' }],
  challenges: [],
  challenge_rewards: [{
    id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
    loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
  }],
});

const pendingTables = (): Record<string, Row[]> => ({
  activity_log: [
    { id: 1, dedupe_key: 'challenge_received:c1', type: 'challenge_received' },
  ],
  challenges: [{ id: 'c1', status: 'pending', tier: 'minor', duration_days: 3, challenger_id: A_ID, opponent_id: B_ID }],
  user_challenge_tokens: [{ id: 't1', challenge_id: 'c1', sent_at: '2026-10-05T10:00:00.000Z' }],
  users: [{ id: A_ID, challenge_active: true }, { id: B_ID, challenge_active: true }],
});

const asA = () => mintToken({ user_id: A_ID, group_id: 'g1' });
const asB = () => mintToken({ user_id: B_ID, group_id: 'g1' });

describe('POST /api/challenges/send', () => {
  it('challenge routes return 500 when the write fails (token mark)', async () => {
    const tables = sendTables();
    use(tables, (q) => (q.table === 'user_challenge_tokens' && q.mutation === 'update' ? fail('token update failed') : null));

    const res = await server.request('POST', '/api/challenges/send', { token: asA(), body: { token_id: 't1', opponent_id: B_ID } });

    expect(res.status).toBe(500);
    // Utmaningen som inte kunde knytas till sin token lämnas inte kvar: tokenen förblir oskickad OCH utan utmaning.
    expect(tables.challenges).toHaveLength(0);
    expect(tables.user_challenge_tokens[0].sent_at).toBeNull();
    expect(tables.activity_log).toHaveLength(0);
  });

  it('lyckad väg oförändrad: 201, token markerad, utmaning skapad', async () => {
    const tables = sendTables();
    use(tables);

    const res = await server.request('POST', '/api/challenges/send', { token: asA(), body: { token_id: 't1', opponent_id: B_ID } });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { challenge_id: 'gen-1' } });
    expect(tables.user_challenge_tokens[0]).toMatchObject({ challenge_id: 'gen-1' });
    expect(tables.user_challenge_tokens[0].sent_at).toBeTruthy();
    expect(tables.challenges).toHaveLength(1);
  });
});

describe('PUT /api/challenges/:id/respond — decline', () => {
  it('challenge routes return 500 when the decline restore fails (token)', async () => {
    const tables = pendingTables();
    use(tables, (q) => (q.table === 'user_challenge_tokens' && q.mutation === 'update' ? fail('restore failed') : null));

    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'decline' } });

    expect(res.status).toBe(500);
    // Utmaningen raderas inte med en token som fortfarande pekar på den; flödesraden står kvar.
    expect(tables.challenges).toHaveLength(1);
    expect(tables.activity_log).toHaveLength(1);
  });

  it('challenge routes return 500 when the decline challenge_active reset fails', async () => {
    const tables = pendingTables();
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' ? fail('reset failed') : null));

    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'decline' } });

    expect(res.status).toBe(500);
    expect(tables.challenges).toHaveLength(1);
  });

  it('lyckad decline oförändrad: 200, utmaningen borta, token återställd', async () => {
    const tables = pendingTables();
    use(tables);

    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'decline' } });

    expect(res.status).toBe(200);
    expect(tables.challenges).toHaveLength(0);
    expect(tables.user_challenge_tokens[0]).toMatchObject({ sent_at: null, challenge_id: null });
    expect(tables.users.map((u) => u.challenge_active)).toEqual([false, false]);
  });
});

describe('PUT /api/challenges/:id/respond — accept', () => {
  it('challenge routes return 500 when the accept status update fails', async () => {
    const tables = pendingTables();
    use(tables, (q) => (q.table === 'challenges' && q.mutation === 'update' ? fail('status update failed') : null));

    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'accept' } });

    expect(res.status).toBe(500);
    expect(tables.challenges[0].status).toBe('pending');
    expect(tables.users.map((u) => u.challenge_active)).toEqual([true, true]); // orörda
  });

  it('challenge routes return 500 when the accept challenge_active update fails — and the challenge is not left half-activated', async () => {
    const tables = pendingTables();
    tables.users.forEach((u) => { u.challenge_active = false; });
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' ? fail('flag failed') : null));

    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'accept' } });

    expect(res.status).toBe(500);
    expect(tables.challenges[0]).toMatchObject({ status: 'pending' });
  });

  it('lyckad accept oförändrad: 200, active, datum satta, challenge_active på', async () => {
    const tables = pendingTables();
    use(tables);

    const res = await server.request('PUT', '/api/challenges/c1/respond', { token: asB(), body: { action: 'accept' } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Challenge accepted' });
    expect(tables.challenges[0]).toMatchObject({ status: 'active' });
    expect(tables.challenges[0].start_date).toBe(res.body.data.start_date);
    expect(tables.users.map((u) => u.challenge_active)).toEqual([true, true]);
  });
});

describe('PUT /api/challenges/:id/withdraw', () => {
  it('challenge routes return 500 when the withdraw restore fails', async () => {
    const tables = pendingTables();
    use(tables, (q) => (q.table === 'user_challenge_tokens' && q.mutation === 'update' ? fail('restore failed') : null));

    const res = await server.request('PUT', '/api/challenges/c1/withdraw', { token: asA() });

    expect(res.status).toBe(500);
    expect(tables.challenges).toHaveLength(1);
  });

  it('lyckad withdraw oförändrad', async () => {
    const tables = pendingTables();
    use(tables);

    const res = await server.request('PUT', '/api/challenges/c1/withdraw', { token: asA() });

    expect(res.status).toBe(200);
    expect(tables.challenges).toHaveLength(0);
    expect(tables.user_challenge_tokens[0]).toMatchObject({ sent_at: null, challenge_id: null });
  });
});

describe('GET /api/challenges/:id/progress', () => {
  it('en misslyckad auto-settle fäller inte läsningen — schedulern tar om den', async () => {
    const tables: Record<string, Row[]> = {
      challenges: [{
        id: 'c1', status: 'active', metric: 'km', challenger_id: 'a', opponent_id: 'b',
        start_date: '2026-10-01', end_date: '2026-10-03', determine_at: '2000-01-01T00:00:00Z',
        winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3, loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
      }],
      runs: [{ id: 'r1', user_id: 'a', date: '2026-10-01', distance: 8 }],
      users: [{ id: 'a', wins: 0, draws: 0, losses: 0 }, { id: 'b', wins: 0, draws: 0, losses: 0 }],
      user_boosts: [], activity_log: [],
    };
    use(tables, (q) => (q.table === 'user_boosts' && q.mutation === 'insert' ? fail('boost insert failed') : null));

    const res = await server.request('GET', '/api/challenges/c1/progress', { token: asA() });

    expect(res.status).toBe(200);
    expect(res.body.data.progress).toEqual([{ user_id: 'a', value: 8 }, { user_id: 'b', value: 0 }]);
    expect(tables.challenges[0].status).toBe('active');
  });
});

