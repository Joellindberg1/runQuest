/**
 * RUN-215 T2 — settleChallenge sväljer inte fel efter claim.
 *
 * Tidigare: claim-felet, challenge_active-återställningen, W/D/L-uppdateringarna och boost-insertet kontrollerades
 * inte. Ett misslyckat boost-insert gav en "avgjord" utmaning utan boostar, och en trasig progress-läsning gav
 * 0 mot 0 — alltså oavgjort — som sparades som facit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { settleChallenge } from '../challengeService.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';

function baseTables(): Record<string, Row[]> {
  return {
    activity_log: [],
    challenges: [{
      id: 'c1', group_id: 'g1', status: 'active', tier: 'major', metric: 'km', duration_days: 3,
      challenger_id: 'a', opponent_id: 'b', start_date: '2026-10-01', end_date: '2026-10-03',
      winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
      loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
      created_at: '2026-09-29T10:00:00.000Z', winner_id: null, outcome: null,
    }],
    users: [
      { id: 'a', wins: 0, draws: 0, losses: 0, challenge_active: true },
      { id: 'b', wins: 0, draws: 0, losses: 0, challenge_active: true },
    ],
    runs: [
      { id: 'r1', user_id: 'a', date: '2026-10-01', distance: 8 },
      { id: 'r2', user_id: 'a', date: '2026-10-02', distance: 7 },
      { id: 'r3', user_id: 'b', date: '2026-10-02', distance: 5 },
    ],
    user_boosts: [],
    user_challenge_tokens: [],
  };
}

function use(tables: Record<string, Row[]>, failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], failWhen });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const hasOp = (q: RecordedQuery, op: string) => q.filters.some((f) => f.op === op);
const fail = (message: string) => ({ message });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('settleChallenge — fel efter claim', () => {
  it('settleChallenge does not mark settled when boost insert fails', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'user_boosts' && q.mutation === 'insert' ? fail('boost insert failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/boost/i);

    // Claimen släpps: utmaningen är active igen och schedulern tar den nästa varv.
    expect(tables.challenges[0]).toMatchObject({ status: 'active', winner_id: null, outcome: null });
    // Inget annat har delats ut, så omförsöket kan inte dubbelräkna.
    expect(tables.users.map((u) => [u.wins, u.losses, u.draws])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('boost-insert som misslyckas OCH en claim som inte kan släppas ger ett fel som nämner båda', async () => {
    const tables = baseTables();
    use(tables, (q) => {
      if (q.table === 'user_boosts' && q.mutation === 'insert') return fail('boost insert failed');
      if (q.table === 'challenges' && q.mutation === 'update' && hasOp(q, 'eq') && q.filters.some((f) => f.column === 'status' && f.value === 'completed')) {
        return fail('release failed');
      }
      return null;
    });

    await expect(settleChallenge('c1')).rejects.toThrow(/boost insert failed.*release failed|release failed.*boost insert failed/s);
  });

  it('settleChallenge surfaces a failed W/D/L update', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'eq') ? fail('wdl failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/W\/D\/L/);
    // Boostarna är redan utdelade — avgörandet står kvar som completed (att släppa det skulle dubbelräkna vid omförsök).
    expect(tables.challenges[0].status).toBe('completed');
    expect(tables.user_boosts).toHaveLength(2);
  });

  it('settleChallenge surfaces a failed challenge_active reset', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'users' && q.mutation === 'update' && hasOp(q, 'in') ? fail('reset failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/challenge_active/);
  });

  it('ett fel i claimen kastas (inte en tyst return som ser ut som "redan avgjord")', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'challenges' && q.mutation === 'update' ? fail('claim failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/claim failed/);
    expect(tables.challenges[0].status).toBe('active');
    expect(tables.user_boosts).toHaveLength(0);
  });

  it('en trasig progress-läsning avgör inte utmaningen som 0–0-oavgjort', async () => {
    const tables = baseTables();
    use(tables, (q) => (q.table === 'runs' ? fail('runs read failed') : null));

    await expect(settleChallenge('c1')).rejects.toThrow(/runs read failed/);
    expect(tables.challenges[0].status).toBe('active');
    expect(tables.users.map((u) => u.draws)).toEqual([0, 0]);
  });

  it('en trasig läsning av utmaningen själv kastas, men "finns inte" är fortfarande en tyst return', async () => {
    const broken = baseTables();
    use(broken, (q) => (q.table === 'challenges' && q.select ? fail('read failed') : null));
    await expect(settleChallenge('c1')).rejects.toThrow(/read failed/);

    const missing = baseTables();
    use(missing);
    await expect(settleChallenge('nope')).resolves.toBeUndefined();
  });
});

describe('settleChallenge — lyckad väg oförändrad', () => {
  it('vinnare: completed, boostar åt båda, W/L, news-rad', async () => {
    const tables = baseTables();
    use(tables);

    await expect(settleChallenge('c1')).resolves.toBeUndefined();

    expect(tables.challenges[0]).toMatchObject({ status: 'completed', outcome: 'challenger_wins', winner_id: 'a', challenger_final_value: 15, opponent_final_value: 5 });
    expect(tables.users).toEqual([
      expect.objectContaining({ id: 'a', wins: 1, losses: 0, challenge_active: false }),
      expect.objectContaining({ id: 'b', wins: 0, losses: 1, challenge_active: false }),
    ]);
    expect(tables.user_boosts.map((b) => [b.user_id, b.outcome, b.delta])).toEqual([['a', 'winner', 0.2], ['b', 'loser', -0.1]]);
    expect(tables.activity_log).toHaveLength(1);
  });

  it('oavgjort: draws räknas, inga boostar', async () => {
    const tables = baseTables();
    tables.runs = [];
    use(tables);

    await expect(settleChallenge('c1')).resolves.toBeUndefined();

    expect(tables.challenges[0]).toMatchObject({ status: 'completed', outcome: 'draw' });
    expect(tables.users.map((u) => u.draws)).toEqual([1, 1]);
    expect(tables.user_boosts).toHaveLength(0);
  });

  it('redan avgjord → ingen dubbel utdelning', async () => {
    const tables = baseTables();
    use(tables);
    await settleChallenge('c1');
    await settleChallenge('c1');

    expect(tables.user_boosts).toHaveLength(2);
    expect(tables.users.map((u) => u.wins + u.losses)).toEqual([1, 1]);
  });
});
