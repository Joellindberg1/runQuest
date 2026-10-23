import type { TitleEngine, RunData, UserStats } from './types';
import { countedElevationGain } from '@runquest/shared';

export const bestSingleRunElevationEngine: TitleEngine = {
  metricKey: 'bestSingleRunElevation',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.reduce((max, r) => Math.max(max, countedElevationGain(r)), 0);
  }
};
