import type { TitleEngine, RunData, UserStats } from './types';

export const bestSingleRunElevationEngine: TitleEngine = {
  metricKey: 'bestSingleRunElevation',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.reduce((max, r) => Math.max(max, r.total_elevation_gain ?? 0), 0);
  }
};
