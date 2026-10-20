/**
 * Kedjan från avgörande till XP: settleChallenge skriver boostens fönster, reprocessRunsFromDate läser det. En ny boost på n dagar ska ge XP på exakt
 * n kalenderdagar, med start dagen efter duellens sista dag, över båda sommartidsskiftena och i en annan tidszon genom resolvern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { addDays } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { settleChallenge } from '../challengeService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

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

const daily = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));

interface Duel { start_date: string; end_date: string | null; type?: 'multiplier_days' | 'multiplier_runs'; length?: number }

/** Avgör en duell (vinnare a) vid `now`, och returnerar de dagar vinnarens boost gav XP på vid en omräkning av alla hennes rundor. */
async function boostedDaysAfterSettling(duel: Duel, now: string): Promise<string[]> {
  const first = addDays(duel.start_date, -5);
  const runDates = daily(first, 22);
  const winnerRuns = (): Row[] => runDates.map((date) => ({ id: `a-${date}`, user_id: 'a', date, distance: 5, streak_day: 1, xp_gained: 0 }));
  const tables: Record<string, Row[]> = {
    activity_log: [],
    challenges: [{
      id: 'c1', group_id: 'g1', status: 'active', tier: 'major', metric: 'km', duration_days: 3,
      challenger_id: 'a', opponent_id: 'b', start_date: duel.start_date, end_date: duel.end_date,
      winner_type: duel.type ?? 'multiplier_days', winner_delta: 0.2, winner_duration: duel.length ?? 3,
      loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
      created_at: '2026-01-01T10:00:00.000Z', winner_id: null, outcome: null,
    }],
    users: [
      { id: 'a', wins: 0, draws: 0, losses: 0, challenge_active: true },
      { id: 'b', wins: 0, draws: 0, losses: 0, challenge_active: true },
    ],
    runs: [...winnerRuns(), { id: 'b-1', user_id: 'b', date: duel.start_date, distance: 1, streak_day: 1, xp_gained: 0 }],
    user_boosts: [],
    user_challenge_tokens: [],
  };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { numericIds: ['activity_log'] }).client as any);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  await settleChallenge('c1');
  const boosts = tables.user_boosts.filter((b) => b.user_id === 'a');
  expect(boosts).toHaveLength(1);

  const recalc = async (userBoosts: Row[]) => {
    const t: Record<string, Row[]> = { runs: winnerRuns(), user_boosts: userBoosts };
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(t, { autoIds: true }).client as any);
    await reprocessRunsFromDate('a', first);
    return t.runs;
  };
  const without = await recalc([]);
  const withBoost = await recalc(boosts);
  return withBoost.filter((r, i) => r.xp_gained !== without[i].xp_gained).map((r) => r.date as string);
}

describe('från avgörande till XP — en ny boost ger exakt det som står', () => {
  it('a new 3-day boost gives XP on exactly 3 days, starting the day after the end of the duel', async () => {
    expect(await boostedDaysAfterSettling({ start_date: '2026-10-01', end_date: '2026-10-03' }, '2026-10-04T01:00:00.000Z'))
      .toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  it('gives exactly 3 days across the spring clock change (2026-03-29)', async () => {
    expect(await boostedDaysAfterSettling({ start_date: '2026-03-25', end_date: '2026-03-27' }, '2026-03-28T01:00:00.000Z'))
      .toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('gives exactly 3 days across the autumn clock change (2026-10-25)', async () => {
    expect(await boostedDaysAfterSettling({ start_date: '2026-10-21', end_date: '2026-10-23' }, '2026-10-24T01:00:00.000Z'))
      .toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it.each([1, 2, 5, 10])('gives exactly %i days for a boost of that length', async (length) => {
    const days = await boostedDaysAfterSettling({ start_date: '2026-10-01', end_date: '2026-10-03', length }, '2026-10-04T01:00:00.000Z');
    expect(days).toEqual(daily('2026-10-04', length));
  });

  it('a run boost is spent on the first n runs from the day after the end of the duel', async () => {
    expect(await boostedDaysAfterSettling({ start_date: '2026-10-01', end_date: '2026-10-03', type: 'multiplier_runs', length: 2 }, '2026-10-04T01:00:00.000Z'))
      .toEqual(['2026-10-04', '2026-10-05']);
  });

  it('another time zone through the resolver moves the start day when the duel has no end date: settled 04:30 Stockholm time = 22:30 the day before in New York', async () => {
    const settledAt = '2026-10-20T02:30:00.000Z';
    expect(await boostedDaysAfterSettling({ start_date: '2026-10-15', end_date: null }, settledAt)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    setGroupTimeZoneSource((groupId) => (groupId === 'g1' ? 'America/New_York' : undefined));
    expect(await boostedDaysAfterSettling({ start_date: '2026-10-15', end_date: null }, settledAt)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  });
});
