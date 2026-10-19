// Klientens namn för rundor och användare. Formerna är serverns svar och bor i @runquest/shared (contracts/); här finns bara aliasen.
import type { RunRow, UserWithRuns } from '@runquest/shared';

/** En rad ur `runs` som servern skickar (RunRow i @runquest/shared). */
export type Run = RunRow;

/** En gruppmedlem med sina rundor, som GET /auth/users-with-runs skickar den (UserWithRuns i @runquest/shared). */
export type User = UserWithRuns;

export interface RunData {
  date: string;
  distance: number;
}

// ─── Challenge System ──────────────────────────────────────────────────────────
export type ChallengeTier = 'minor' | 'major' | 'legendary';
export type ChallengeMetric = 'km' | 'runs' | 'total_xp';
export type ChallengeStatus = 'pending' | 'active' | 'completed' | 'declined';

export interface Challenge {
  id: string;
  group_id: string;
  token_id?: string;
  tier: ChallengeTier;
  challenger_id: string;
  challenger_name: string;
  opponent_id: string;
  opponent_name: string;
  metric: ChallengeMetric;
  duration_days: number;
  winner_delta: number;
  winner_duration: number;
  winner_type: string;
  loser_delta: number;
  loser_duration: number;
  loser_type: string;
  challenger_level: number;
  opponent_level: number;
  start_date?: string;
  end_date?: string;
  determine_at?: string;
  legendary_sent_at?: string;
  status: ChallengeStatus;
  winner_id?: string;
  outcome?: string;
  challenger_final_value?: number;
  opponent_final_value?: number;
  created_at: string;
}

export interface ChallengeToken {
  id: string;
  user_id: string;
  tier: ChallengeTier;
  metric: ChallengeMetric;
  duration_days: number;
  winner_delta: number;
  winner_duration: number;
  loser_delta: number;
  loser_duration: number;
  earned_at: string;
  sent_at?: string;
  challenge_id?: string;
}

export interface UserBoost {
  id: string;
  user_id: string;
  challenge_id: string;
  outcome: 'winner' | 'loser';
  type: string;
  delta: number;
  remaining?: number;
  expires_at?: string;
  created_at: string;
}
