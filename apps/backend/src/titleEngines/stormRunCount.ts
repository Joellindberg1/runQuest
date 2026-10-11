import type { TitleEngine, RunData, UserStats } from './types';
import { countRunsWhere } from './_utils';

/** Vindbyar (m/s) från vilka en runda räknas som storm. Medelvinden är inte med: byarna är det man känner. */
export const STORM_GUST_MS = 12;

/** Stormborn: antal rundor med vindbyar på minst STORM_GUST_MS. Runda utan väder (null) räknas inte. */
export const stormRunCountEngine: TitleEngine = {
  metricKey: 'stormRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return countRunsWhere(runs, r => r.wind_gusts_ms != null && r.wind_gusts_ms >= STORM_GUST_MS);
  }
};
