// Types for XP calculation system
export interface AdminSettings {
  id?: string;
  base_xp: number | null;
  xp_per_km: number | null;
  bonus_5km: number | null;
  bonus_10km: number | null;
  bonus_15km: number | null;
  bonus_20km: number | null;
  created_at: string | null;
  updated_at: string | null;
  admin_password_hash?: string;
  min_km_for_run?: number | null;
  min_km_for_streak?: number | null;
  min_run_date?: string | null;
}

export interface StreakMultiplier {
  id?: string;
  days: number;
  multiplier: number;
  created_at?: string;
}

export interface RunData {
  date: string;
  distance: number;
}

export interface ProcessedRun {
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
  calculatedXP: {
    baseXP: number;
    distanceXP: number;
    distanceBonus: number;
    streakBonus: number;
    multiplier: number;
    totalXP: number;
  };
}

export interface CalculatedXP {
  baseXP: number;
  distanceXP: number;
  distanceBonus: number;
  streakBonus: number;
  multiplier: number;
  totalXP: number;
}