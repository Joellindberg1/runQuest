import type { Challenge, ChallengeToken, UserBoost } from '@runquest/types';
import type { ChallengeHistoryItem } from '@runquest/shared';
import type { GroupStat } from './duelsModel';

// Gemensamma testdata för Duels-testerna (modell + skärm). Fasta id:n och klockslag så att inget beror på dagens datum.

/** 2026-10-04 12:00 i Stockholm (CEST) — sommartid slutar först 25 oktober. */
export const NOW = new Date('2026-10-04T10:00:00Z');

export const ME = 'u-me';
export const KARL = 'u-karl';
export const ADAM = 'u-adam';
export const NICK = 'u-nick';
export const DAN = 'u-dan';

export const NAMES: Record<string, string> = {
  [ME]: 'Joel Lindberg',
  [KARL]: 'Karl Persson',
  [ADAM]: 'Adam Einstein',
  [NICK]: 'Nicklas von Elling',
  [DAN]: 'Daniel Lindblad Lüthje',
};

const MINOR = { winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days' };
const MAJOR = { winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days', loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days' };
const LEGENDARY = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };
export const STAKES = { minor: MINOR, major: MAJOR, legendary: LEGENDARY };

export function challenge(over: Partial<Challenge> & Pick<Challenge, 'id' | 'challenger_id' | 'opponent_id'>): Challenge {
  const tier = over.tier ?? 'minor';
  return {
    group_id: 'g1',
    tier,
    challenger_name: NAMES[over.challenger_id],
    opponent_name: NAMES[over.opponent_id],
    metric: 'km',
    duration_days: 7,
    ...STAKES[tier],
    challenger_level: 20,
    opponent_level: 20,
    status: 'pending',
    created_at: '2026-10-03T08:00:00Z',
    ...over,
  };
}

export function token(over: Partial<ChallengeToken> & Pick<ChallengeToken, 'id'>): ChallengeToken & { winner_type: string; loser_type: string } {
  const tier = over.tier ?? 'minor';
  return {
    user_id: ME,
    tier,
    metric: 'km',
    duration_days: 7,
    earned_at: '2026-09-01T08:00:00Z',
    ...STAKES[tier],
    ...over,
  };
}

export function boost(over: Partial<UserBoost> & Pick<UserBoost, 'id'>): UserBoost {
  return {
    user_id: ME,
    challenge_id: 'c-old',
    outcome: 'winner',
    type: 'multiplier_days',
    delta: 0.25,
    created_at: '2026-09-30T03:00:00Z',
    expires_at: '2026-10-08T03:00:00Z',
    ...over,
  };
}

export function stat(user_id: string, over: Partial<GroupStat> = {}): GroupStat {
  return {
    user_id,
    name: NAMES[user_id],
    wins: 0,
    draws: 0,
    losses: 0,
    total: 0,
    points: 0,
    challenge_active: false,
    has_pending_challenge: false,
    current_level: 20,
    profile_picture: null,
    ...over,
  };
}

export function historyItem(over: Partial<ChallengeHistoryItem> & Pick<ChallengeHistoryItem, 'id'>): ChallengeHistoryItem {
  return {
    tier: 'major',
    metric: 'runs',
    duration_days: 5,
    start_date: '2026-08-16',
    end_date: '2026-08-21',
    ended_at: '2026-08-21T01:00:00Z',
    outcome: 'challenger_wins',
    winner_id: ME,
    challenger: { id: ME, name: NAMES[ME], profile_picture: null, level: 24 },
    opponent: { id: ADAM, name: NAMES[ADAM], profile_picture: null, level: 23 },
    challenger_value: 6,
    opponent_value: 4,
    winner_boost: { type: 'multiplier_days', delta: 0.25, duration: 10 },
    loser_boost: { type: 'multiplier_days', delta: -0.12, duration: 10 },
    ...over,
  };
}
