import type { TitleEngine, RunData, UserStats } from './types';
import { utcHour } from './_utils';

export const earlyRunCountEngine: TitleEngine = {
  metricKey: 'earlyRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => r.start_time && utcHour(r.start_time) < 6).length;
  }
};
