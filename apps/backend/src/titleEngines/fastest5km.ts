import type { TitleEngine, RunData, UserStats } from './types';

// Value = 60 - moving_time_minutes (reference 60 min).
// Higher value = faster runner. Returns -9999 when no qualifying run.
// Qualifying run: 4.9–10.0 km (accounts for GPS variance around 5 km).
export const fastest5kmEngine: TitleEngine = {
  metricKey: 'fastest5km',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(
      r => r.distance_km >= 4.9 && r.distance_km < 10.0 && r.moving_time && r.moving_time > 0
    );
    if (qualifying.length === 0) return -9999;
    const fastestSeconds = Math.min(...qualifying.map(r => r.moving_time!));
    return 60 - fastestSeconds / 60;
  }
};
