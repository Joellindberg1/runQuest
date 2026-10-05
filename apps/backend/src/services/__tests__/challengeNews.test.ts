/**
 * Pack News-skrivpunkter för utmaningar (ADR 008 beslut 5):
 *  - settleChallenge → exakt EN challenge_won/challenge_draw-rad (även vid omkörning)
 *  - autoDeclinePendingChallenges → challenge_received återkallas (retract)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { settleChallenge } from '../challengeService.js';
import { autoDeclinePendingChallenges } from '../../scheduler/challengeScheduler.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function baseTables(challengeOverrides: Row = {}): Record<string, Row[]> {
  return {
    activity_log: [],
    challenges: [{
      id: 'c1', group_id: 'g1', status: 'active', tier: 'major', metric: 'km', duration_days: 3,
      challenger_id: 'a', opponent_id: 'b', start_date: '2026-10-01', end_date: '2026-10-03',
      winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
      loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
      created_at: '2026-09-29T10:00:00.000Z', ...challengeOverrides,
    }],
    users: [
      { id: 'a', wins: 0, draws: 0, losses: 0, challenge_active: true },
      { id: 'b', wins: 0, draws: 0, losses: 0, challenge_active: true },
    ],
    runs: [
      { id: 'r1', user_id: 'a', date: '2026-10-01', distance: 8 },
      { id: 'r2', user_id: 'a', date: '2026-10-02', distance: 7 },
      { id: 'r3', user_id: 'b', date: '2026-10-02', distance: 5 },
      { id: 'r4', user_id: 'a', date: '2026-10-09', distance: 100 }, // utanför fönstret
    ],
    user_boosts: [],
    user_challenge_tokens: [],
  };
}

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('settleChallenge → activity_log', () => {
  it('avgörs → exakt en challenge_won-rad: vinnare → förlorare, värden och boostar ur raden', async () => {
    const tables = baseTables();
    use(tables);
    await settleChallenge('c1');

    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      id: 1, group_id: 'g1', type: 'challenge_won', actor_user_id: 'a', target_user_id: 'b',
      dedupe_key: 'challenge_settled:c1', is_backfill: false, payload_version: 1,
      payload: {
        challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 3, winner_value: 15, loser_value: 5,
        winner_boost: { type: 'multiplier_days', delta: 0.2, duration: 3 },
        loser_boost: { type: 'multiplier_days', delta: -0.1, duration: 2 },
      },
    });
    // den underliggande kedjan är oförändrad
    expect(tables.challenges[0]).toMatchObject({ status: 'completed', outcome: 'challenger_wins', winner_id: 'a' });
    expect(tables.user_boosts).toHaveLength(2);
  });

  it('motståndaren vinner → aktör/target byter plats', async () => {
    const tables = baseTables();
    tables.runs = [{ id: 'r', user_id: 'b', date: '2026-10-02', distance: 9 }, { id: 'r2', user_id: 'a', date: '2026-10-02', distance: 1 }];
    use(tables);
    await settleChallenge('c1');
    expect(tables.activity_log[0]).toMatchObject({ type: 'challenge_won', actor_user_id: 'b', target_user_id: 'a' });
  });

  it('oavgjort → challenge_draw (utmanaren → motståndaren) utan boostar', async () => {
    const tables = baseTables();
    tables.runs = [{ id: 'r', user_id: 'a', date: '2026-10-02', distance: 5 }, { id: 'r2', user_id: 'b', date: '2026-10-02', distance: 5 }];
    use(tables);
    await settleChallenge('c1');
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'challenge_draw', actor_user_id: 'a', target_user_id: 'b', dedupe_key: 'challenge_settled:c1',
      payload: { challenger_value: 5, opponent_value: 5 },
    });
    expect(tables.user_boosts).toHaveLength(0);
  });

  it('avgör två gånger → exakt en rad (claim-vakten)', async () => {
    const tables = baseTables();
    use(tables);
    await settleChallenge('c1');
    await settleChallenge('c1');
    expect(tables.activity_log).toHaveLength(1);
  });

  it('omkörning även när claim-vakten släpper igenom (status återställd) → dedupe_key håller raden unik', async () => {
    const tables = baseTables();
    use(tables);
    await settleChallenge('c1');
    tables.challenges[0].status = 'active'; // t.ex. två instanser som båda passerat statuskollen
    await settleChallenge('c1');
    expect(tables.activity_log).toHaveLength(1);
  });

  it('en trasig logg fäller inte avgörandet', async () => {
    const tables = baseTables();
    const db = createFakeDb(tables, { errors: { activity_log: { message: 'relation "activity_log" does not exist' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await expect(settleChallenge('c1')).resolves.toBeUndefined();
    expect(tables.challenges[0].status).toBe('completed');
    expect(tables.user_boosts).toHaveLength(2);
    expect(tables.users.find((u) => u.id === 'a')!.wins).toBe(1);
  });

  it('en utmaning som inte är active loggas aldrig', async () => {
    const tables = baseTables({ status: 'pending' });
    use(tables);
    await settleChallenge('c1');
    expect(tables.activity_log).toHaveLength(0);
  });
});

describe('autoDeclinePendingChallenges → retract', () => {
  it('raderar utmaningen OCH dess challenge_received-rad; andra rader står kvar', async () => {
    const old = new Date(Date.now() - 4 * 86400000).toISOString();
    const tables: Record<string, Row[]> = {
      activity_log: [
        { id: 1, dedupe_key: 'challenge_received:old1', type: 'challenge_received' },
        { id: 2, dedupe_key: 'challenge_received:fresh', type: 'challenge_received' },
        { id: 3, dedupe_key: 'level_up:a:2', type: 'level_up' },
      ],
      challenges: [
        { id: 'old1', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b', created_at: old },
        { id: 'fresh', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b', created_at: new Date().toISOString() },
      ],
      user_challenge_tokens: [{ id: 't1', challenge_id: 'old1', sent_at: old }],
      users: [{ id: 'a', challenge_active: true }, { id: 'b', challenge_active: true }],
    };
    use(tables);
    await autoDeclinePendingChallenges();

    expect(tables.challenges.map((c) => c.id)).toEqual(['fresh']);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:fresh', 'level_up:a:2']);
  });

  it('misslyckad radering → raden återkallas inte', async () => {
    const old = new Date(Date.now() - 4 * 86400000).toISOString();
    const tables: Record<string, Row[]> = {
      activity_log: [{ id: 1, dedupe_key: 'challenge_received:old1', type: 'challenge_received' }],
      challenges: [{ id: 'old1', status: 'pending', tier: 'minor', challenger_id: 'a', opponent_id: 'b', created_at: old }],
      user_challenge_tokens: [], users: [],
    };
    const db = createFakeDb(tables, { failWhen: (q) => (q.table === 'challenges' && q.mutation === 'delete' ? { message: 'delete failed' } : null) });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await autoDeclinePendingChallenges();
    expect(tables.activity_log).toHaveLength(1);
  });
});
