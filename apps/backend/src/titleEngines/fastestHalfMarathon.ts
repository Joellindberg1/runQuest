import type { TitleEngine, RunData, UserStats } from './types';

// Value = 360 - moving_time_minutes (reference 6 h).
// Higher value = faster runner. Returns -9999 when no qualifying run.
export const fastestHalfMarathonEngine: TitleEngine = {
  metricKey: 'fastestHalfMarathon',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(r => r.distance_km >= 21.1 && r.distance_km < 42.0 && r.moving_time && r.moving_time > 0);
    if (qualifying.length === 0) return -9999;
    const fastestSeconds = Math.min(...qualifying.map(r => r.moving_time!));
    return 360 - fastestSeconds / 60;
  }
};
