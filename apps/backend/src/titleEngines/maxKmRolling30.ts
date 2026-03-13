import type { TitleEngine, RunData, UserStats } from './types';

export const maxKmRolling30Engine: TitleEngine = {
  metricKey: 'maxKmRolling30',
  calculate(runs: RunData[], _: UserStats): number {
    if (runs.length === 0) return 0;
    const sorted = [...runs].sort((a, b) => a.date.localeCompare(b.date));
    const todayDate = new Date().toISOString().split('T')[0];

    const cutoff = new Date(todayDate);
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return sorted
      .filter(r => r.date >= cutoffStr)
      .reduce((sum, r) => sum + r.distance_km, 0);
  }
};
