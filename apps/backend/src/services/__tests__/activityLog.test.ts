/**
 * services/activityLog.ts (ADR 008 beslut 3–4): dedupe via dedupe_key, icke-kastande skrivning,
 * retract, samt level-/milstolpehjälparna. Kör mot fakeDb som tillämpar ON CONFLICT DO NOTHING.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import {
  recordActivity,
  recordActivities,
  retractActivity,
  recordChallengeReceived,
  retractChallengeReceived,
  recordChallengeSettled,
  recordLevelUps,
  recordRunMilestones,
} from '../activityLog.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { buildLevelUpDrafts, type ActivityDraft, type ChallengeActivityRow } from '@runquest/shared';

function setup(tables: Record<string, Row[]> = {}, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const draft = (over: Partial<ActivityDraft> = {}): ActivityDraft =>
  ({
    type: 'level_up', group_id: 'g1', actor_user_id: 'u1', target_user_id: null, payload: { level: 2 },
    payload_version: 1, dedupe_key: 'level_up:u1:2', occurred_at: '2026-10-05T10:00:00.000Z', is_backfill: false,
    ...over,
  }) as ActivityDraft;

const challenge: ChallengeActivityRow = {
  id: 'c1', group_id: 'g1', tier: 'minor', metric: 'km', duration_days: 3, challenger_id: 'a', opponent_id: 'b',
  outcome: 'challenger_wins', challenger_final_value: 10, opponent_final_value: 4,
  winner_type: 'multiplier_days', winner_delta: 0.1, winner_duration: 2, loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
};

beforeEach(() => { vi.clearAllMocks(); });

describe('recordActivity / recordActivities', () => {
  it('skriver en rad till activity_log', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    const db = setup(tables);
    await recordActivity(draft());
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({ id: 1, group_id: 'g1', type: 'level_up', dedupe_key: 'level_up:u1:2', is_backfill: false });
    expect(db.queries.map((q) => q.table)).toEqual(['activity_log']);
  });

  it('två skrivningar med samma dedupe_key → exakt en rad', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordActivity(draft());
    await recordActivity(draft({ occurred_at: '2026-10-06T10:00:00.000Z' }));
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0].occurred_at).toBe('2026-10-05T10:00:00.000Z'); // första raden står kvar oförändrad
  });

  it('samma batch med en dubblett + en ny → bara den nya läggs till', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordActivity(draft());
    await recordActivities([draft(), draft({ dedupe_key: 'level_up:u1:3', payload: { level: 3 } } as Partial<ActivityDraft>)]);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['level_up:u1:2', 'level_up:u1:3']);
  });

  it('skriver bara kända kolumner (inget extra läcker in i tabellen)', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordActivity({ ...draft(), email: 'x@y.z', password_hash: 'h' } as unknown as ActivityDraft);
    expect(Object.keys(tables.activity_log[0]).sort()).toEqual([
      'actor_user_id', 'dedupe_key', 'group_id', 'id', 'is_backfill', 'occurred_at', 'payload', 'payload_version', 'target_user_id', 'type',
    ]);
  });

  it('tom lista ger inget anrop alls', async () => {
    const db = setup({ activity_log: [] });
    await recordActivities([]);
    expect(db.queries).toHaveLength(0);
  });
});

describe('icke-kastande (loggen får aldrig fälla kedjan)', () => {
  it('databasfel (error i svaret) sväljs', async () => {
    setup({ activity_log: [] }, { errors: { activity_log: { message: 'relation "activity_log" does not exist' } } });
    await expect(recordActivity(draft())).resolves.toBeUndefined();
  });

  it('kastat undantag från klienten sväljs i varje exporterad funktion', async () => {
    vi.mocked(getSupabaseClient).mockImplementation(() => { throw new Error('boom'); });
    await expect(recordActivity(draft())).resolves.toBeUndefined();
    await expect(retractActivity('k')).resolves.toBeUndefined();
    await expect(recordLevelUps('u1', 1, 3, 'g1')).resolves.toBeUndefined();
    await expect(recordLevelUps('u1', 1, 3)).resolves.toBeUndefined(); // gruppuppslagningen kastar också
    await expect(recordRunMilestones('u1', 90, 120, 'g1')).resolves.toBeUndefined();
    await expect(recordChallengeSettled(challenge)).resolves.toBeUndefined();
    await expect(recordChallengeReceived(challenge)).resolves.toBeUndefined();
    await expect(retractChallengeReceived('c1')).resolves.toBeUndefined();
  });

  it('klient utan upsert (trasig mock) sväljs', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue({ from: () => ({}) } as any);
    await expect(recordActivity(draft())).resolves.toBeUndefined();
  });
});

describe('retractActivity', () => {
  it('tar bort exakt raden med nyckeln', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [{ id: 1, dedupe_key: 'challenge_received:c1' }, { id: 2, dedupe_key: 'challenge_received:c2' }],
    };
    setup(tables);
    await retractChallengeReceived('c1');
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(['challenge_received:c2']);
  });

  it('okänd nyckel är ofarligt', async () => {
    const tables: Record<string, Row[]> = { activity_log: [{ id: 1, dedupe_key: 'a' }] };
    setup(tables);
    await retractActivity('nope');
    expect(tables.activity_log).toHaveLength(1);
  });
});

describe('utmaningar', () => {
  it('challenge_received skrivs och kan återkallas', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordChallengeReceived(challenge, '2026-10-05T09:00:00.000Z');
    expect(tables.activity_log[0]).toMatchObject({ type: 'challenge_received', actor_user_id: 'a', target_user_id: 'b', dedupe_key: 'challenge_received:c1' });
    await retractChallengeReceived('c1');
    expect(tables.activity_log).toHaveLength(0);
  });

  it('avgörs två gånger → exakt en challenge_won-rad', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordChallengeSettled(challenge);
    await recordChallengeSettled(challenge);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({ type: 'challenge_won', actor_user_id: 'a', target_user_id: 'b', dedupe_key: 'challenge_settled:c1' });
  });

  it('okänt utfall loggas inte', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordChallengeSettled({ ...challenge, outcome: null });
    expect(tables.activity_log).toHaveLength(0);
  });
});

describe('recordLevelUps', () => {
  it('en rad per nivå i (prev, new]', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordLevelUps('u1', 2, 5, 'g1');
    expect(tables.activity_log.map((r) => r.payload.level)).toEqual([3, 4, 5]);
    expect(tables.activity_log.every((r) => r.is_backfill === false && r.actor_user_id === 'u1' && r.group_id === 'g1')).toBe(true);
  });

  it('omkörning/återtagande ger ingen andra rad (level_up:<user>:<level>)', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordLevelUps('u1', 2, 4, 'g1');
    await recordLevelUps('u1', 2, 4, 'g1');
    await recordLevelUps('u1', 3, 4, 'g1'); // regression till 3, tillbaka till 4
    expect(tables.activity_log).toHaveLength(2);
  });

  it('ingen rad (och inget DB-anrop) vid oförändrad/sänkt nivå eller okänd föregående nivå', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    const db = setup(tables);
    await recordLevelUps('u1', 4, 4, 'g1');
    await recordLevelUps('u1', 5, 4, 'g1');
    await recordLevelUps('u1', null, 9, 'g1');
    await recordLevelUps('u1', undefined, 9, 'g1');
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries).toHaveLength(0);
  });

  it('gruppen läses ur users.group_id när den inte skickas med; ingen grupp → ingen rad', async () => {
    const tables: Record<string, Row[]> = { activity_log: [], users: [{ id: 'u1', group_id: 'g7' }, { id: 'u2', group_id: null }] };
    setup(tables);
    await recordLevelUps('u1', 1, 2);
    await recordLevelUps('u2', 1, 2);
    await recordLevelUps('u2', 1, 2, null);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0].group_id).toBe('g7');
  });

  it('delar nycklar med shared-byggaren (live == backfill)', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordLevelUps('u1', 1, 3, 'g1');
    const keys = buildLevelUpDrafts('u1', 'g1', 1, 3, 'x').map((d) => d.dedupe_key);
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual(keys);
  });
});

describe('recordRunMilestones', () => {
  it('prevKm < tröskel ≤ nytt km → en rad per tröskel, och bara en gång', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordRunMilestones('u1', 95, 260, 'g1');
    await recordRunMilestones('u1', 95, 260, 'g1');
    expect(tables.activity_log.map((r) => r.payload)).toEqual([
      { kind: 'total_km', threshold: 100 }, { kind: 'total_km', threshold: 250 },
    ]);
  });

  it('ingen rad om inga trösklar passeras eller km minskar', async () => {
    const tables: Record<string, Row[]> = { activity_log: [] };
    setup(tables);
    await recordRunMilestones('u1', 101, 120, 'g1');
    await recordRunMilestones('u1', 300, 120, 'g1');
    expect(tables.activity_log).toHaveLength(0);
  });
});
