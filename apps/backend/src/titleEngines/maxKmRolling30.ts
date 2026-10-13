import type { TitleEngine, RunData, UserStats, TitleContext } from './types';
import { addDays, stockholmDay } from '@runquest/shared';

export const maxKmRolling30Engine: TitleEngine = {
  metricKey: 'maxKmRolling30',
  calculate(runs: RunData[], _: UserStats, ctx?: TitleContext): number {
    if (runs.length === 0) return 0;

    // Previous calendar month in Stockholm time (title changes hands once per month, not daily).
    // The day before the 1st of the current month is always in the previous month.
    const today = stockholmDay(ctx?.now ?? new Date());
    const prefix = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);

    return runs
      .filter(r => r.date.startsWith(prefix))
      .reduce((sum, r) => sum + r.distance_km, 0);
  }
};
