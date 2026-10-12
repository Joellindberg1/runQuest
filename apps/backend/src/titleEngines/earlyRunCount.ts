import type { TitleEngine, RunData, UserStats } from './types';
import { wallClockMinutes } from '@runquest/shared';

export const earlyRunCountEngine: TitleEngine = {
  metricKey: 'earlyRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => {
      if (!r.start_time) return false;
      const m = wallClockMinutes(r.start_time);
      return m !== null && m >= 4 * 60 && m < 6 * 60;
    }).length;
  }
};
