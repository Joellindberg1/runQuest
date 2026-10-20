// Utmaningar: GET /api/challenges/group-history och /api/challenges/head-to-head/:userId (ADR 007 B5–B6) samt de äldre my, send, respond, withdraw,
// :id/progress och group-stats. Fältstil snake_case. Nya endpoints: { success, data, meta? } / { error }.
// ChallengeTier och ChallengeMetric har sin enda definition här (klienten importerar dem därifrån, inte ur @runquest/types).
import type { ApiSuccess, OffsetPageMeta } from './common.js';

export type ChallengeTier = 'minor' | 'major' | 'legendary';
export type ChallengeMetric = 'km' | 'runs' | 'total_xp';
export type ChallengeOutcome = 'challenger_wins' | 'opponent_wins' | 'draw';
export type ChallengeStatus = 'pending' | 'active' | 'completed' | 'declined';

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

// ─── GET /api/challenges/my ──────────────────────────────────────────────────────────────────────────────────

/**
 * En rad ur `challenges` (select *) som GET /api/challenges/my skickar. Namnen på parterna följer bara med i `group_active` (servern slår upp dem);
 * övriga listor bär id:n och klienten slår upp namnet i gruppens lista. Kolumnerna utan NOT NULL i schemat (005, 011) skickas som `null` när de är tomma:
 * token_id, winner_duration, loser_duration, start_date, end_date, determine_at, legendary_sent_at, winner_id, outcome och slutvärdena.
 */
export interface ChallengeRow {
  id: string;
  group_id: string;
  token_id?: string | null;
  tier: ChallengeTier;
  challenger_id: string;
  challenger_name?: string;
  opponent_id: string;
  opponent_name?: string;
  metric: ChallengeMetric;
  duration_days: number;
  winner_delta: number;
  winner_duration: number | null;
  winner_type: string;
  loser_delta: number;
  loser_duration: number | null;
  loser_type: string;
  challenger_level: number;
  opponent_level: number;
  start_date?: string | null;
  end_date?: string | null;
  determine_at?: string | null;
  legendary_sent_at?: string | null;
  status: ChallengeStatus;
  winner_id?: string | null;
  outcome?: string | null;
  challenger_final_value?: number | null;
  opponent_final_value?: number | null;
  outdoor_only?: boolean;
  created_at: string;
}

/** En osänd token med belöningen inplattad (challenge_rewards): det klienten ritar i send-arket. Tokenraden har inget `user_id` här. */
export interface MyChallengeToken {
  id: string;
  tier: ChallengeTier;
  metric: ChallengeMetric;
  duration_days: number;
  earned_at: string;
  reward_id: string;
  winner_delta: number;
  winner_duration: number;
  winner_type: string;
  loser_delta: number;
  loser_duration: number;
  loser_type: string;
}

/** En aktiv boost (user_boosts) hos anroparen. Bara de kolumner routen väljer; ingen `user_id`. */
export interface MyBoost {
  id: string;
  challenge_id: string;
  outcome: 'winner' | 'loser';
  type: string;
  delta: number;
  remaining?: number | null;
  expires_at?: string | null;
  created_at: string;
}

export interface MyChallengesData {
  tokens: MyChallengeToken[];
  /** Den väntande utmaning anroparen skickat (aktiva ligger i `group_active`). */
  sent_challenge: ChallengeRow | null;
  received_challenges: ChallengeRow[];
  boosts: MyBoost[];
  /** De 20 senaste avslutade, nyast först. */
  history: ChallengeRow[];
  /** Alla aktiva utmaningar i gruppen (Ongoing), med parternas namn. Tom utan grupp. */
  group_active: ChallengeRow[];
}

/** Svar för GET /api/challenges/my. */
export type MyChallengesResponse = ApiSuccess<MyChallengesData>;

// ─── POST /api/challenges/send, PUT /:id/respond och PUT /:id/withdraw ──────────────────────────────────────

/** Brödtext till POST /api/challenges/send. */
export interface SendChallengeRequest {
  token_id: string;
  opponent_id: string;
}

/** Svar för POST /api/challenges/send (201). */
export type SendChallengeResponse = ApiSuccess<{ challenge_id: string }>;

export type ChallengeResponseAction = 'accept' | 'decline';

/** Brödtext till PUT /api/challenges/:id/respond. */
export interface RespondChallengeRequest {
  action: ChallengeResponseAction;
}

/** Svar för PUT /api/challenges/:id/respond. `data` (datumen) följer bara med när utmaningen accepterades. */
export interface RespondChallengeResponse {
  success: true;
  message: string;
  data?: { start_date: string; end_date: string };
}

/** Svar för PUT /api/challenges/:id/withdraw. */
export interface WithdrawChallengeResponse {
  success: true;
  message: string;
}

// ─── GET /api/challenges/:id/progress ───────────────────────────────────────────────────────────────────────

export interface ChallengeProgressEntry {
  user_id: string;
  value: number;
}

export interface ChallengeProgressData {
  challenge_id: string;
  metric: ChallengeMetric;
  start_date: string | null;
  end_date: string | null;
  /** [utmanare, motståndare]; tom lista om utmaningen inte har startat. */
  progress: ChallengeProgressEntry[];
}

/** Svar för GET /api/challenges/:id/progress. */
export type ChallengeProgressResponse = ApiSuccess<ChallengeProgressData>;

// ─── GET /api/challenges/group-stats ────────────────────────────────────────────────────────────────────────

/** En rad per gruppmedlem: W/D/L, poäng (avrundad för visning) och om medlemmen är upptagen. */
export interface ChallengeGroupStat {
  user_id: string;
  name: string;
  wins: number;
  draws: number;
  losses: number;
  total: number;
  points: number;
  challenge_active: boolean;
  /** Medlemmen har skickat en väntande utmaning (mottagare räknas inte). */
  has_pending_challenge: boolean;
  current_level: number;
  profile_picture: string | null;
}

/** Svar för GET /api/challenges/group-stats (sorterad som tabellen, ADR 011 beslut 6). */
export type ChallengeGroupStatsResponse = ApiSuccess<ChallengeGroupStat[]>;
