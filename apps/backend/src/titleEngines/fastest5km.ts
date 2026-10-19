import type { TitleEngine, RunData, UserStats } from './types';
import { encodeTitleMetric, noValueFor } from '@runquest/shared';

// Value = encodeTitleMetric('fastest5km', moving_time_s), i.e. 60 - moving_time_minutes (kodningen ligger i shared/titleMetrics).
// Higher value = faster runner. Returns the no-time sentinel when no qualifying run.
// Qualifying run: 4.9–10.0 km (accounts for GPS variance around 5 km).
export const fastest5kmEngine: TitleEngine = {
  metricKey: 'fastest5km',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(
      r => r.distance_km >= 4.9 && r.distance_km < 10.0 && r.moving_time && r.moving_time > 0
    );
    if (qualifying.length === 0) return noValueFor('fastest5km');
    const fastestSeconds = Math.min(...qualifying.map(r => r.moving_time!));
    return encodeTitleMetric('fastest5km', fastestSeconds);
  }
};
