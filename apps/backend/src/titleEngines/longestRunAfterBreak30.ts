import type { TitleEngine, RunData, UserStats } from './types';
import { daysBetween } from './_utils';

export const longestRunAfterBreak30Engine: TitleEngine = {
  metricKey: 'longestRunAfterBreak30',
  calculate(runs: RunData[], _: UserStats): number {
    if (runs.length < 2) return 0;
    const sorted = [...runs].sort((a, b) => a.date.localeCompare(b.date));
    let best = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(sorted[i - 1].date, sorted[i].date) >= 30) {
        best = Math.max(best, sorted[i].distance_km);
      }
    }
    return best;
  }
};
