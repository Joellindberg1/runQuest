import type { TitleEngine, RunData, UserStats } from './types';
import { wallClockMinutes } from '@runquest/shared';

export const lunchRunCountEngine: TitleEngine = {
  metricKey: 'lunchRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => {
      if (!r.start_time) return false;
      const m = wallClockMinutes(r.start_time);
      return m !== null && m >= 11 * 60 && m < 13 * 60;
    }).length;
  }
};
