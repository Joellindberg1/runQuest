import type { TitleEngine, RunData, UserStats } from './types';
import { wallClockMinutes } from '@runquest/shared';

export const nightRunCountEngine: TitleEngine = {
  metricKey: 'nightRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => {
      if (!r.start_time) return false;
      const m = wallClockMinutes(r.start_time);
      return m !== null && m >= 21 * 60 + 30 && m < 24 * 60;
    }).length;
  }
};
