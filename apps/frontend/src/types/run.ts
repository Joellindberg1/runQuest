
export interface User {
  id: string;
  name: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  profile_picture?: string;
  runs?: Run[];
  wins?: number;
  draws?: number;
  losses?: number;
  challenge_active?: boolean;
  challenge_counts?: { minor?: number; major?: number; legendary?: number };
}

export interface Run {
  id: string;
  user_id: string;
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
  base_xp: number;
  km_xp: number;
  distance_bonus: number;
  streak_bonus: number;
}

export interface RunData {
  date: string;
  distance: number;
}

export interface ProcessedRun extends Run {
  calculatedXP: XPCalculation;
}

export interface XPCalculation {
  baseXP: number;
  distanceXP: number;
  distanceBonus: number;
  streakBonus: number;
  multiplier: number;
  totalXP: number;
}

export interface UserTitle {
  title_id: string;
  title_name: string;
  title_description: string;
  position: number;
  value: number;
  earned_at: string;
  is_current_holder: boolean;
  status: 'holder' | 'runner_up' | 'top_10';
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  multiplier: number;
}

// ─── Challenge System ──────────────────────────────────────────────────────────
export type ChallengeTier = 'minor' | 'major' | 'legendary';
export type ChallengeMetric = 'km' | 'runs' | 'total_xp';
export type ChallengeStatus = 'pending' | 'active' | 'completed' | 'declined';

export interface Challenge {
  id: string;
  group_id: string;
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
  status: ChallengeStatus;
  winner_id?: string;
  created_at: string;
}

export interface ChallengeStats {
  wins: number;
  draws: number;
  losses: number;
  challenge_active: boolean;
}
