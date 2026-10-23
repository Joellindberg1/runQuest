import type { TitleEngine, RunData, UserStats } from './types';
import { encodeTitleMetric, noValueFor } from '@runquest/shared';

// Invert so that higher value = more consistent (lower std dev); kodningen (10000 / std dev) ligger i shared/titleMetrics.
// Value = encodeTitleMetric over the lowest pace std dev across qualifying runs (≥ 5 km).
export const lowestPaceStdDevEngine: TitleEngine = {
  metricKey: 'lowestPaceStdDev',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(
      r => r.distance_km >= 5 && r.pace_std_dev != null && r.pace_std_dev > 0
    );
    if (qualifying.length === 0) return noValueFor('lowestPaceStdDev');
    const minStdDev = Math.min(...qualifying.map(r => r.pace_std_dev!));
    return encodeTitleMetric('lowestPaceStdDev', minStdDev);
  }
};
