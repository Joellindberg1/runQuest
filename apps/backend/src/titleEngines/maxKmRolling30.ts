import type { TitleEngine, RunData, UserStats } from './types';

export const maxKmRolling30Engine: TitleEngine = {
  metricKey: 'maxKmRolling30',
  calculate(runs: RunData[], _: UserStats): number {
    if (runs.length === 0) return 0;
    const sorted = [...runs].sort((a, b) => a.date.localeCompare(b.date));
    const latestDate = sorted[sorted.length - 1].date;

    const cutoff = new Date(latestDate);
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return sorted
      .filter(r => r.date >= cutoffStr)
      .reduce((sum, r) => sum + r.distance_km, 0);
  }
};
