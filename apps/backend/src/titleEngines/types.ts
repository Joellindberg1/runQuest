export interface RunData {
  date: string;
  distance_km: number;
}

export interface UserStats {
  totalKm: number;
  longestStreak: number;
}

export interface TitleEngine {
  metricKey: string;
  calculate(runs: RunData[], userStats: UserStats): number;
}
