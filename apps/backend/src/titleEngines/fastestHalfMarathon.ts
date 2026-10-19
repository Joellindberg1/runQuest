import type { TitleEngine, RunData, UserStats } from './types';
import { encodeTitleMetric, noValueFor } from '@runquest/shared';

// Value = encodeTitleMetric('fastestHalfMarathon', moving_time_s), i.e. 360 - moving_time_minutes (kodningen ligger i shared/titleMetrics).
// Higher value = faster runner. Returns the no-time sentinel when no qualifying run.
export const fastestHalfMarathonEngine: TitleEngine = {
  metricKey: 'fastestHalfMarathon',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(r => r.distance_km >= 21.1 && r.distance_km < 42.0 && r.moving_time && r.moving_time > 0);
    if (qualifying.length === 0) return noValueFor('fastestHalfMarathon');
    const fastestSeconds = Math.min(...qualifying.map(r => r.moving_time!));
    return encodeTitleMetric('fastestHalfMarathon', fastestSeconds);
  }
};
