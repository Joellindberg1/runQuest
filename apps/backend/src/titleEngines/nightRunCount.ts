import type { TitleEngine, RunData, UserStats } from './types';
import { utcMinutes } from './_utils';

export const nightRunCountEngine: TitleEngine = {
  metricKey: 'nightRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => r.start_time && utcMinutes(r.start_time) >= 21 * 60 + 30).length;
  }
};
