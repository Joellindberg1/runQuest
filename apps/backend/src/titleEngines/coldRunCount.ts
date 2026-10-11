import type { TitleEngine, RunData, UserStats } from './types';
import { countRunsWhere } from './_utils';

/** Temperatur (°C) vid eller under vilken en runda räknas som kall. Verklig temperatur, inte upplevd. */
export const ICE_TEMP_C = 5;

/** Iceborn: antal rundor med temperature_c <= ICE_TEMP_C. Saknad temperatur (null) är inte 0 °C och räknas inte. */
export const coldRunCountEngine: TitleEngine = {
  metricKey: 'coldRunCount',
  calculate(runs: RunData[], _: UserStats): number {
    return countRunsWhere(runs, r => r.temperature_c != null && r.temperature_c <= ICE_TEMP_C);
  }
};
