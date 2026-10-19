import type { TitleEngine, RunData, UserStats } from './types';
import { MARATHON_TITLE_MIN_KM, encodeTitleMetric, noValueFor } from '@runquest/shared';

// Value = encodeTitleMetric('fastestMarathon', moving_time_s), i.e. 720 - moving_time_minutes (kodningen ligger i shared/titleMetrics).
// Higher value = faster runner. Returns the no-time sentinel when no qualifying run.
export const fastestMarathonEngine: TitleEngine = {
  metricKey: 'fastestMarathon',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(r => r.distance_km >= MARATHON_TITLE_MIN_KM && r.moving_time && r.moving_time > 0);
    if (qualifying.length === 0) return noValueFor('fastestMarathon');
    const fastestSeconds = Math.min(...qualifying.map(r => r.moving_time!));
    return encodeTitleMetric('fastestMarathon', fastestSeconds);
  }
};
