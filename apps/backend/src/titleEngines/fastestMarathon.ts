import type { TitleEngine, RunData, UserStats } from './types';

// Value = 720 - moving_time_minutes (reference 12 h).
// Higher value = faster runner. Returns -9999 when no qualifying run.
export const fastestMarathonEngine: TitleEngine = {
  metricKey: 'fastestMarathon',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(r => r.distance_km >= 42.2 && r.moving_time && r.moving_time > 0);
    if (qualifying.length === 0) return -9999;
    const fastestSeconds = Math.min(...qualifying.map(r => r.moving_time!));
    return 720 - fastestSeconds / 60;
  }
};
