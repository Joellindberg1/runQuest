import type { TitleEngine, RunData, UserStats } from './types';

// Value = 10000 / avg_pace_std_dev across all qualifying runs (≥ 5 km).
// Higher value = more consistent (lower avg std dev).
// Returns 0 when no qualifying runs.
export const avgPaceStdDevEngine: TitleEngine = {
  metricKey: 'avgPaceStdDev',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(
      r => r.distance_km >= 5 && r.pace_std_dev != null && r.pace_std_dev > 0
    );
    if (qualifying.length === 0) return 0;
    const avg = qualifying.reduce((sum, r) => sum + r.pace_std_dev!, 0) / qualifying.length;
    return 10000 / avg;
  }
};
