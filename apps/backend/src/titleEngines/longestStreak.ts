import type { TitleEngine, RunData, UserStats } from './types';

export const longestStreakEngine: TitleEngine = {
  metricKey: 'longestStreak',
  calculate(_runs: RunData[], userStats: UserStats): number {
    return userStats.longestStreak;
  }
};
