// GET /api/challenges/group-history och /api/challenges/head-to-head/:userId (ADR 007 B5–B6).
// Fältstil snake_case. Nya endpoints: { success, data, meta? } / { error }.
import type { ApiSuccess, OffsetPageMeta } from './common.js';

export type ChallengeTier = 'minor' | 'major' | 'legendary';
export type ChallengeMetric = 'km' | 'runs' | 'total_xp';
export type ChallengeOutcome = 'challenger_wins' | 'opponent_wins' | 'draw';

export interface ChallengeParty {
  id: string;
  name: string;
  profile_picture: string | null;
  /** Nivå vid utmaningens start (challenger_level / opponent_level). */
  level: number;
}

export interface ChallengeBoost {
  type: string;
  delta: number;
  duration: number | null;
}

export interface ChallengeHistoryItem {
  id: string;
  tier: ChallengeTier;
  metric: ChallengeMetric;
  duration_days: number;
  start_date: string | null;
  end_date: string | null;
  /** determine_at: schemalagd avgörandetid, används som avslutstid (ingen settled_at-kolumn finns). */
  ended_at: string | null;
  outcome: ChallengeOutcome;
  winner_id: string | null;
  challenger: ChallengeParty;
  opponent: ChallengeParty;
  challenger_value: number | null;
  opponent_value: number | null;
  winner_boost: ChallengeBoost;
  loser_boost: ChallengeBoost;
}

export interface ChallengeGroupHistoryResponse {
  items: ChallengeHistoryItem[];
}

export type ChallengeGroupHistoryApiResponse = ApiSuccess<ChallengeGroupHistoryResponse, OffsetPageMeta>;

export interface HeadToHeadOpponent {
  id: string;
  name: string;
  profile_picture: string | null;
}

export interface HeadToHeadRecord {
  /** Anroparens perspektiv. */
  wins: number;
  draws: number;
  losses: number;
  total: number;
}

export interface HeadToHeadActiveChallenge {
  id: string;
  status: 'pending' | 'active';
  challenger_id: string;
}

export interface HeadToHeadResponse {
  opponent: HeadToHeadOpponent;
  record: HeadToHeadRecord;
  /** Senaste mötena, nyast först. */
  history: ChallengeHistoryItem[];
  active: HeadToHeadActiveChallenge | null;
}

export type HeadToHeadApiResponse = ApiSuccess<HeadToHeadResponse>;
