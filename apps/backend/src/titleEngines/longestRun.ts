import type { TitleEngine, RunData, UserStats } from './types';

export const longestRunEngine: TitleEngine = {
  metricKey: 'longestRun',
  calculate(runs: RunData[], _userStats: UserStats): number {
    return runs.reduce((max, run) => Math.max(max, run.distance_km), 0);
  }
};
