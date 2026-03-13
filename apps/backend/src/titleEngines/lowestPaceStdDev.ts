import type { TitleEngine, RunData, UserStats } from './types';

// Invert so that higher value = more consistent (lower std dev).
// Value = 10000 / min_pace_std_dev across qualifying runs (≥ 5 km).
export const lowestPaceStdDevEngine: TitleEngine = {
  metricKey: 'lowestPaceStdDev',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(
      r => r.distance_km >= 5 && r.pace_std_dev != null && r.pace_std_dev > 0
    );
    if (qualifying.length === 0) return 0;
    const minStdDev = Math.min(...qualifying.map(r => r.pace_std_dev!));
    return 10000 / minStdDev;
  }
};
