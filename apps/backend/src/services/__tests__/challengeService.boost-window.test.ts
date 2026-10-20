/**
 * Boostens expires_at sätts konsekvent med fönstret (boostWindow i shared): samma väggklocka n kalenderdagar senare i gruppens
 * tidszon, så att fönstret är n + 1 dagar även över ett sommartidsskifte, och created_at är samma ögonblick som expires_at räknas från.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { boostWindow, type BoostRow } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { settleChallenge } from '../challengeService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function tables(): Record<string, Row[]> {
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
      { id: 'r2', user_id: 'b', date: '2026-10-02', distance: 5 },
    ],
    user_boosts: [],
    user_challenge_tokens: [],
  };
}

async function settleAt(now: string, zone?: (groupId: string) => string): Promise<{ winner: Row; loser: Row }> {
  const t = tables();
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(t, { numericIds: ['activity_log'] }).client as any);
  if (zone) setGroupTimeZoneSource(zone);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  await settleChallenge('c1');
  return { winner: t.user_boosts.find((b) => b.outcome === 'winner')!, loser: t.user_boosts.find((b) => b.outcome === 'loser')! };
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
  it('stores created_at as the instant expires_at is counted from', async () => {
    const { winner, loser } = await settleAt('2026-10-14T10:00:00.000Z');
    expect(winner.created_at).toBe('2026-10-14T10:00:00.000Z');
    expect(loser.created_at).toBe('2026-10-14T10:00:00.000Z');
  });

  it('sets expires_at so the window is n + 1 calendar days: created day to created day + n', async () => {
    const { winner, loser } = await settleAt('2026-10-14T10:00:00.000Z');
    expect(winner.expires_at).toBe('2026-10-17T10:00:00.000Z');
    expect(boostWindow(winner as BoostRow)).toEqual({ startDay: '2026-10-14', endDay: '2026-10-17' });
    expect(boostWindow(loser as BoostRow)).toEqual({ startDay: '2026-10-14', endDay: '2026-10-16' });
  });

  it('keeps the window at n + 1 days over the spring change for a boost created near midnight', async () => {
    // 23:30 svensk tid den 27:e; created + 72 h hade blivit 00:30 sommartid den 31:a, en femte dag.
    const { winner } = await settleAt('2026-03-27T22:30:00.000Z');
    expect(winner.expires_at).toBe('2026-03-30T21:30:00.000Z');
    expect(boostWindow(winner as BoostRow)).toEqual({ startDay: '2026-03-27', endDay: '2026-03-30' });
  });

  it('counts in the time zone of the group of the duel', async () => {
    const { winner } = await settleAt('2026-10-20T02:30:00.000Z', (groupId) => (groupId === 'g1' ? 'America/New_York' : 'Europe/Stockholm'));
    expect(winner.expires_at).toBe('2026-10-23T02:30:00.000Z');
    expect(boostWindow(winner as BoostRow, 'America/New_York')).toEqual({ startDay: '2026-10-19', endDay: '2026-10-22' });
  });

  it('gives a run boost no expires_at', async () => {
    const t = tables();
    Object.assign(t.challenges[0], { winner_type: 'multiplier_runs', winner_duration: 3 });
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(t, { numericIds: ['activity_log'] }).client as any);
    await settleChallenge('c1');
    expect(t.user_boosts.find((b) => b.outcome === 'winner')).toMatchObject({ type: 'multiplier_runs', remaining: 3, expires_at: null });
  });
});
