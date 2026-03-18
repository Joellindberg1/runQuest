import type { TitleEngine, RunData, UserStats } from './types';

export const maxKmRolling30Engine: TitleEngine = {
  metricKey: 'maxKmRolling30',
  calculate(runs: RunData[], _: UserStats): number {
    if (runs.length === 0) return 0;

    // Previous calendar month (title changes hands once per month, not daily)
    const now = new Date();
    const prevMonthYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    const prefix = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}`;

    return runs
      .filter(r => r.date.startsWith(prefix))
      .reduce((sum, r) => sum + r.distance_km, 0);
  }
};
