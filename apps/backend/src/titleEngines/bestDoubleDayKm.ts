import type { TitleEngine, RunData, UserStats } from './types';
import { hasDoubleRunGap } from '@runquest/shared';

const MIN_DISTANCE_KM = 5;

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
    let bestAttempt = 0; // best double day even if criteria not met

    for (const dayRuns of byDate.values()) {
      if (dayRuns.length < 2) continue;

      // Track best attempt (any day with 2+ runs)
      const attemptTotal = dayRuns.reduce((sum, r) => sum + r.distance_km, 0);
      if (attemptTotal > bestAttempt) bestAttempt = attemptTotal;

      // Full qualifying check: both runs ≥5km and the shared double-run gap (shared/titleMetrics, 4 h)
      const qualifying = dayRuns.filter(
        r => r.distance_km >= MIN_DISTANCE_KM && r.start_time
      );
      if (qualifying.length < 2) continue;

      if (hasDoubleRunGap(qualifying.map(r => new Date(r.start_time!).getTime()))) {
        const total = qualifying.reduce((sum, r) => sum + r.distance_km, 0);
        if (total > best) best = total;
      }
    }

    // Return qualifying value if exists, otherwise best attempt for display
    return best > 0 ? best : bestAttempt;
  }
};
