
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
