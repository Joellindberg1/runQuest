import type { TitleEngine, RunData, UserStats } from './types';

export const weekendAvgEngine: TitleEngine = {
  metricKey: 'weekendAvg',
  calculate(runs: RunData[], _userStats: UserStats): number {
    // Filter weekend runs (Saturday = 6, Sunday = 0)
    const weekendRuns = runs.filter(run => {
      const day = new Date(run.date).getDay();
      return day === 0 || day === 6;
    });

    if (weekendRuns.length === 0) return 0;

    // Group by weekend using Monday of that week as key
    const weekendTotals = new Map<string, number>();

    for (const run of weekendRuns) {
      const date = new Date(run.date);
      const dayOfWeek = date.getDay();
      const monday = new Date(date);
      monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      monday.setHours(0, 0, 0, 0);
      const weekKey = monday.toISOString().split('T')[0];
      weekendTotals.set(weekKey, (weekendTotals.get(weekKey) ?? 0) + run.distance_km);
    }

    const totals = Array.from(weekendTotals.values());
    return totals.reduce((sum, t) => sum + t, 0) / totals.length;
  }
};
