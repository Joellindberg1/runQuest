import type { TitleEngine, RunData, UserStats } from './types';
import { utcMinutes } from './_utils';

export const nightRunCountEngine: TitleEngine = {
  metricKey: 'nightRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => {
      if (!r.start_time) return false;
      const m = utcMinutes(r.start_time);
      return m >= 21 * 60 + 30 && m < 24 * 60;
    }).length;
  }
};
