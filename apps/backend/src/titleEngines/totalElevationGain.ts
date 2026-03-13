import type { TitleEngine, RunData, UserStats } from './types';

export const totalElevationGainEngine: TitleEngine = {
  metricKey: 'totalElevationGain',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.reduce((sum, r) => sum + (r.total_elevation_gain ?? 0), 0);
  }
};
