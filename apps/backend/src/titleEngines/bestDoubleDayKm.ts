import type { TitleEngine, RunData, UserStats } from './types';

const MIN_DISTANCE_KM = 5;
const MIN_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

export const bestDoubleDayKmEngine: TitleEngine = {
  metricKey: 'bestDoubleDayKm',
  calculate(runs: RunData[], _: UserStats): number {
    // Group runs by date
    const byDate = new Map<string, RunData[]>();
    for (const run of runs) {
      if (!byDate.has(run.date)) byDate.set(run.date, []);
      byDate.get(run.date)!.push(run);
    }

    let best = 0;

    for (const dayRuns of byDate.values()) {
      const qualifying = dayRuns.filter(
        r => r.distance_km >= MIN_DISTANCE_KM && r.start_time
      );
      if (qualifying.length < 2) continue;

      // Sort by start_time
      const sorted = [...qualifying].sort(
        (a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime()
      );

      // Check if any pair has at least 4 h gap
      let validDay = false;
      outer: for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const gap = new Date(sorted[j].start_time!).getTime() - new Date(sorted[i].start_time!).getTime();
          if (gap >= MIN_GAP_MS) { validDay = true; break outer; }
        }
      }

      if (validDay) {
        const total = qualifying.reduce((sum, r) => sum + r.distance_km, 0);
        if (total > best) best = total;
      }
    }

    return best;
  }
};
