import type { TitleEngine, RunData, UserStats } from './types';
import { getMondayKey } from './_utils';

export const maxRunsOneWeekEngine: TitleEngine = {
  metricKey: 'maxRunsOneWeek',
  calculate(runs: RunData[], _: UserStats): number {
    const weekCounts = new Map<string, number>();
    for (const run of runs) {
      const key = getMondayKey(run.date);
      weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    }
    return weekCounts.size === 0 ? 0 : Math.max(...weekCounts.values());
  }
};
