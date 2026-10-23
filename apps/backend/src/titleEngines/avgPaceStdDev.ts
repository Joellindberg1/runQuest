import type { TitleEngine, RunData, UserStats } from './types';
import { encodeTitleMetric, noValueFor } from '@runquest/shared';

// Value = encodeTitleMetric over the average pace std dev across all qualifying runs (≥ 5 km); kodningen (10000 / std dev) ligger i shared/titleMetrics.
// Higher value = more consistent (lower avg std dev).
// Returns the no-value (0) when no qualifying runs.
export const avgPaceStdDevEngine: TitleEngine = {
  metricKey: 'avgPaceStdDev',
  calculate(runs: RunData[], _: UserStats): number {
    const qualifying = runs.filter(
      r => r.distance_km >= 5 && r.pace_std_dev != null && r.pace_std_dev > 0
    );
    if (qualifying.length === 0) return noValueFor('avgPaceStdDev');
    const avg = qualifying.reduce((sum, r) => sum + r.pace_std_dev!, 0) / qualifying.length;
    return encodeTitleMetric('avgPaceStdDev', avg);
  }
};
