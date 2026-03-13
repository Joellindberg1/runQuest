import type { TitleEngine, RunData, UserStats } from './types';
import { stockholmMinutes } from './_utils';

export const earlyRunCountEngine: TitleEngine = {
  metricKey: 'earlyRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => r.start_time && stockholmMinutes(r.start_time) < 6 * 60).length;
  }
};
