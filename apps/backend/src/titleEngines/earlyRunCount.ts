import type { TitleEngine, RunData, UserStats } from './types';
import { utcMinutes } from './_utils';

export const earlyRunCountEngine: TitleEngine = {
  metricKey: 'earlyRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => {
      if (!r.start_time) return false;
      const m = utcMinutes(r.start_time);
      return m >= 4 * 60 && m < 6 * 60;
    }).length;
  }
};
