export interface RunData {
  date: string;
  distance_km: number;
  start_time?: string | null;
  total_elevation_gain?: number | null;
  pace_std_dev?: number | null;
  moving_time?: number | null;
}

export interface UserStats {
  totalKm: number;
  longestStreak: number;
}

export interface TitleEngine {
  metricKey: string;
  calculate(runs: RunData[], userStats: UserStats): number;
}
