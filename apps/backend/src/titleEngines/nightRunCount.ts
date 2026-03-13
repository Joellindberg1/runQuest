import type { TitleEngine, RunData, UserStats } from './types';
import { stockholmMinutes } from './_utils';

export const nightRunCountEngine: TitleEngine = {
  metricKey: 'nightRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.filter(r => r.start_time && stockholmMinutes(r.start_time) >= 21 * 60 + 30).length;
  }
};
