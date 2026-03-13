import type { TitleEngine, RunData, UserStats } from './types';

export const totalKmEngine: TitleEngine = {
  metricKey: 'totalKm',
  calculate(_runs: RunData[], userStats: UserStats): number {
    return userStats.totalKm;
  }
};
