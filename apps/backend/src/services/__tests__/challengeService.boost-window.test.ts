/**
 * settleChallenge skriver boostens fönster (ägarbeslut 2026-10-20): en dagsboost på n dagar gäller exakt n kalenderdagar i gruppens tidszon, från
 * 00:00 dagen efter duellens sista dag; en rundboost räknar de n första rundorna från samma start. Fönstret planeras och valideras FÖRE claimen, så
 * en ogiltig längd lämnar duellen orörd i stället för att kasta när den redan är avgjord.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { addDays, boostRemaining, boostWindow, type BoostRow } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { errorCode } from '../../utils/errorCode.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { settleChallenge } from '../challengeService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function tables(challenge: Row = {}): Record<string, Row[]> {
  return {
    activity_log: [],
    challenges: [{
      id: 'c1', group_id: 'g1', status: 'active', tier: 'major', metric: 'km', duration_days: 3,
      challenger_id: 'a', opponent_id: 'b', start_date: '2026-10-01', end_date: '2026-10-03',
      winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3,
      loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
      created_at: '2026-09-29T10:00:00.000Z', winner_id: null, outcome: null,
      ...challenge,
    }],
    users: [
      { id: 'a', wins: 0, draws: 0, losses: 0, challenge_active: true },
      { id: 'b', wins: 0, draws: 0, losses: 0, challenge_active: true },
    ],
    runs: [
      { id: 'r1', user_id: 'a', date: challenge.start_date ?? '2026-10-01', distance: 8 },
      { id: 'r2', user_id: 'b', date: addDays(challenge.start_date ?? '2026-10-01', 1), distance: 5 },
    ],
    user_boosts: [],
    user_challenge_tokens: [],
  };
}

function use(t: Record<string, Row[]>) {
  const db = createFakeDb(t, { numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

async function settle(challenge: Row = {}, now = '2026-10-04T01:00:00.000Z') {
  const t = tables(challenge);
  const db = use(t);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  await settleChallenge('c1');
  return { t, db, winner: t.user_boosts.find((b) => b.outcome === 'winner')!, loser: t.user_boosts.find((b) => b.outcome === 'loser')! };
}

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setGroupTimeZoneSource();
});

describe('settleChallenge — boostens fönster', () => {
  it('writes a window of exactly n calendar days from the day after the last day of the duel', async () => {
    const { winner, loser } = await settle();
    expect(winner).toMatchObject({ type: 'multiplier_days', start_date: '2026-10-04', end_date: '2026-10-06' }); // 3 dagar
    expect(loser).toMatchObject({ type: 'multiplier_days', start_date: '2026-10-04', end_date: '2026-10-05' }); // 2 dagar
  });

  it('sets expires_at to the local midnight after the end day, consistent with the stored window', async () => {
    const { winner, loser } = await settle();
    expect(winner.expires_at).toBe('2026-10-06T22:00:00.000Z'); // 00:00 den 7:e svensk sommartid
    expect(loser.expires_at).toBe('2026-10-05T22:00:00.000Z');
  });

  it('keeps 3 days across the spring change', async () => {
    const { winner } = await settle({ start_date: '2026-03-25', end_date: '2026-03-27' }, '2026-03-28T01:00:00.000Z');
    expect(winner).toMatchObject({ start_date: '2026-03-28', end_date: '2026-03-30', expires_at: '2026-03-30T22:00:00.000Z' });
  });

  it('keeps 3 days across the autumn change', async () => {
    const { winner } = await settle({ end_date: '2026-10-23' }, '2026-10-24T01:00:00.000Z');
    expect(winner).toMatchObject({ start_date: '2026-10-24', end_date: '2026-10-26', expires_at: '2026-10-26T23:00:00.000Z' });
  });

  it('shows 3 days on the start day and before it, from the stored window', async () => {
    const { winner } = await settle();
    expect(boostRemaining(winner as BoostRow, new Date('2026-10-02T10:00:00.000Z'))).toBe(3);
    expect(boostRemaining(winner as BoostRow, new Date('2026-10-04T10:00:00.000Z'))).toBe(3);
    expect(boostRemaining(winner as BoostRow, new Date('2026-10-06T10:00:00.000Z'))).toBe(1);
    expect(boostRemaining(winner as BoostRow, new Date('2026-10-06T22:00:00.000Z'))).toBe(0);
    expect(boostWindow(winner as BoostRow)).toEqual({ startDay: '2026-10-04', endDay: '2026-10-06' });
  });

  it('the time zone of the group of the duel, through the resolver, moves the end of the window', async () => {
    const { winner } = await settle({}, '2026-10-04T01:00:00.000Z');
    expect(winner.expires_at).toBe('2026-10-06T22:00:00.000Z');
    setGroupTimeZoneSource((groupId) => (groupId === 'g1' ? 'America/New_York' : undefined));
    const inNewYork = await settle();
    expect(inNewYork.winner.expires_at).toBe('2026-10-07T04:00:00.000Z'); // 00:00 den 7:e i New York (EDT)
    expect(inNewYork.winner).toMatchObject({ start_date: '2026-10-04', end_date: '2026-10-06' });
  });

  it('starts on the day of the settlement, in the zone of the group, when the duel has no end date', async () => {
    const lateEvening = '2026-10-20T02:30:00.000Z'; // 04:30 den 20:e i Stockholm, 22:30 den 19:e i New York
    expect((await settle({ end_date: null }, lateEvening)).winner.start_date).toBe('2026-10-20');
    setGroupTimeZoneSource(() => 'America/New_York');
    expect((await settle({ end_date: null }, lateEvening)).winner.start_date).toBe('2026-10-19');
  });

  it('writes a run boost with the same start, the number of runs as remaining, and no end', async () => {
    const { winner, loser } = await settle({ winner_type: 'multiplier_runs', winner_duration: 3 });
    expect(winner).toMatchObject({ type: 'multiplier_runs', remaining: 3, start_date: '2026-10-04', end_date: null, expires_at: null });
    expect(loser).toMatchObject({ type: 'multiplier_days', start_date: '2026-10-04', end_date: '2026-10-05' });
  });
});

describe('settleChallenge — ogiltig längd kastar aldrig efter claimen', () => {
  const untouched = (t: Record<string, Row[]>, db: ReturnType<typeof use>) => {
    expect(t.challenges[0]).toMatchObject({ status: 'active', winner_id: null, outcome: null });
    expect(t.user_boosts).toHaveLength(0);
    expect(t.users).toEqual([
      expect.objectContaining({ id: 'a', wins: 0, losses: 0, challenge_active: true }),
      expect.objectContaining({ id: 'b', wins: 0, losses: 0, challenge_active: true }),
    ]);
    expect(db.queries.filter((q) => q.table === 'challenges' && q.mutation === 'update')).toHaveLength(0);
  };

  it.each([
    ['winner_duration', null],
    ['winner_duration', 1.5],
    ['winner_duration', 0],
    ['loser_duration', null],
    ['loser_duration', -1],
  ])('a duel with %s = %s is rejected before the claim and left active, with nothing written', async (field, value) => {
    const t = tables({ [field]: value });
    const db = use(t);
    await expect(settleChallenge('c1')).rejects.toSatisfy((e: unknown) => errorCode(e) === 'invalid_boost_duration');
    untouched(t, db);
  });

  it('the same goes for a run boost with an invalid number of runs', async () => {
    const t = tables({ winner_type: 'multiplier_runs', winner_duration: null });
    const db = use(t);
    await expect(settleChallenge('c1')).rejects.toSatisfy((e: unknown) => errorCode(e) === 'invalid_boost_duration');
    untouched(t, db);
  });

  it('the error message carries no row values', async () => {
    const t = tables({ winner_duration: null });
    use(t);
    const error = await settleChallenge('c1').catch((e: Error) => e);
    expect(String((error as Error).message)).toBe('Challenge c1 has an invalid boost length; it was not settled and nothing was written');
  });

  it('a draw has no boosts, so an invalid length does not matter', async () => {
    const t = tables({ winner_duration: null, loser_duration: null });
    t.runs = [];
    use(t);
    await expect(settleChallenge('c1')).resolves.toBeUndefined();
    expect(t.challenges[0]).toMatchObject({ status: 'completed', outcome: 'draw' });
    expect(t.user_boosts).toHaveLength(0);
  });

  it('a boost without effect (delta 0) and without a valid length is written without a window instead of blocking the duel', async () => {
    const t = tables({ loser_delta: 0, loser_duration: null });
    use(t);
    await expect(settleChallenge('c1')).resolves.toBeUndefined();
    expect(t.challenges[0]).toMatchObject({ status: 'completed' });
    expect(t.user_boosts.find((b) => b.outcome === 'loser')).toMatchObject({ delta: 0, start_date: null, end_date: null, expires_at: null });
  });

  it('a boost that is neither a day nor a run boost gets no window', async () => {
    const t = tables({ winner_type: 'xp_flat', winner_duration: null, winner_delta: 50 });
    use(t);
    await expect(settleChallenge('c1')).resolves.toBeUndefined();
    expect(t.user_boosts.find((b) => b.outcome === 'winner')).toMatchObject({ type: 'xp_flat', start_date: null, end_date: null, expires_at: null, remaining: null });
  });
});
