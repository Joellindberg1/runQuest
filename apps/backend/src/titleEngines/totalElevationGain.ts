import type { TitleEngine, RunData, UserStats } from './types';
import { countedElevationGain } from '@runquest/shared';

export const totalElevationGainEngine: TitleEngine = {
  metricKey: 'totalElevationGain',
  calculate(runs: RunData[], _: UserStats): number {
    return runs.reduce((sum, r) => sum + countedElevationGain(r), 0);
  }
};
