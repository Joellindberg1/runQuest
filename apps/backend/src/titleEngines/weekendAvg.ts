import type { TitleEngine, RunData, UserStats } from './types';
import { weekendAverageKm } from '@runquest/shared';

// Snittet av km per helg (lördag + söndag i samma vecka). Regeln ligger i shared/titleMetrics och delas med Runner card.
export const weekendAvgEngine: TitleEngine = {
  metricKey: 'weekendAvg',
  calculate(runs: RunData[], _userStats: UserStats): number {
    return weekendAverageKm(runs.map(run => ({ day: run.date, km: run.distance_km })));
  }
};
