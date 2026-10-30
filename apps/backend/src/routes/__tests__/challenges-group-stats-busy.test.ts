/**
 * group-stats och /send följer samma regel för "upptagen": den som är med i en väntande eller aktiv utmaning, som
 * utmanare eller som mottagare, kan inte utmanas. Leaderboardens flaggor är det klienten bygger send-arket på.
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
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const GROUP = 'g1';
// Riktiga uuid: /send avvisar opponent_id som inte är ett uuid.
const SENDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // utmanare i den väntande utmaningen
const RECEIVER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // mottagare av den väntande utmaningen
const IDLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // inte inblandad i något
const DUELIST_ONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // aktiv duell, utmanare
const DUELIST_TWO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; // aktiv duell, mottagare
const NEWCOMER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; // har en oskickad token och försöker utmana

const member = (id: string, challengeActive = false): Row => ({
  id, name: `Runner ${id.slice(0, 1)}`, group_id: GROUP, wins: 0, draws: 0, losses: 0,
  challenge_active: challengeActive, current_level: 5, profile_picture: null,
});

const tables = (): Record<string, Row[]> => ({
  activity_log: [],
  users: [
    member(SENDER), member(RECEIVER), member(IDLE), member(DUELIST_ONE, true), member(DUELIST_TWO, true), member(NEWCOMER),
  ],
  user_challenge_tokens: [
    { id: 't1', user_id: NEWCOMER, tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: null, challenge_id: null },
    { id: 't0', user_id: SENDER, tier: 'major', metric: 'km', duration_days: 5, reward_id: 'rw1', sent_at: '2026-10-05T10:00:00.000Z', challenge_id: 'c-pending' },
  ],
  challenges: [
    { id: 'c-pending', group_id: GROUP, status: 'pending', challenger_id: SENDER, opponent_id: RECEIVER, duration_days: 3, tier: 'minor' },
    { id: 'c-active', group_id: GROUP, status: 'active', challenger_id: DUELIST_ONE, opponent_id: DUELIST_TWO, duration_days: 3, tier: 'minor' },
  ],
  challenge_rewards: [{
    id: 'rw1', winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
    loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
  }],
});

const as = (userId: string) => mintToken({ user_id: userId, group_id: GROUP });

async function groupStats(t: Record<string, Row[]>, viewer = NEWCOMER) {
  use(t);
  const res = await server.request('GET', '/api/challenges/group-stats', { token: as(viewer) });
  expect(res.status).toBe(200);
  return Object.fromEntries((res.body.data as Array<Record<string, any>>).map((s) => [s.user_id, s]));
}

describe('GET /api/challenges/group-stats — busy runners', () => {
  it('group-stats flags the receiver of a pending challenge, and leaves a runner outside it unflagged', async () => {
    const stats = await groupStats(tables());

    expect(stats[SENDER].has_pending_challenge).toBe(true);
    expect(stats[RECEIVER].has_pending_challenge).toBe(true);
    expect(stats[IDLE].has_pending_challenge).toBe(false);
  });

  it('group-stats marks both sides of an active duel through challenge_active', async () => {
    const stats = await groupStats(tables());

    expect(stats[DUELIST_ONE].challenge_active).toBe(true);
    expect(stats[DUELIST_TWO].challenge_active).toBe(true);
    expect(stats[IDLE].challenge_active).toBe(false);
  });

  it('accepting a challenge sets challenge_active for both sides in group-stats and clears the pending flag', async () => {
    const t = tables();
    use(t);
    const accepted = await server.request('PUT', '/api/challenges/c-pending/respond', { token: as(RECEIVER), body: { action: 'accept' } });
    expect(accepted.status).toBe(200);

    const stats = await groupStats(t);

    expect([stats[SENDER].challenge_active, stats[RECEIVER].challenge_active]).toEqual([true, true]);
    expect([stats[SENDER].has_pending_challenge, stats[RECEIVER].has_pending_challenge]).toEqual([false, false]);
  });

  it('group-stats busy flags match exactly the opponents /send refuses', async () => {
    const candidates = [SENDER, RECEIVER, IDLE, DUELIST_ONE, DUELIST_TWO];
    const shownBusy: string[] = [];
    const refused: string[] = [];

    const stats = await groupStats(tables());
    for (const id of candidates) {
      if (stats[id].challenge_active || stats[id].has_pending_challenge) shownBusy.push(id);

      use(tables());
      const sent = await server.request('POST', '/api/challenges/send', { token: as(NEWCOMER), body: { token_id: 't1', opponent_id: id } });
      if (sent.status === 400 && /Opponent already has an active or pending challenge/.test(sent.body.error)) refused.push(id);
      else expect(sent.status).toBe(201);
    }

    expect(refused).toEqual([SENDER, RECEIVER, DUELIST_ONE, DUELIST_TWO]);
    expect(shownBusy).toEqual(refused);
  });

  it('group-stats makes the same two queries as before, one per table', async () => {
    const db = use(tables());
    const res = await server.request('GET', '/api/challenges/group-stats', { token: as(NEWCOMER) });

    expect(res.status).toBe(200);
    expect(db.queries.map((q) => q.table).sort()).toEqual(['challenges', 'users']);
  });
});
