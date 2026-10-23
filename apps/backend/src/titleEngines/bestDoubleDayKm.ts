import type { TitleEngine, RunData, UserStats } from './types';
import { hasDoubleRunGap } from '@runquest/shared';

const MIN_DISTANCE_KM = 5;

/**
 * Bästa dubbeldagen i km. Bara en dag som uppfyller regeln räknas: minst två rundor på minst 5 km var, med giltig starttid,
 * och minst 4 timmar mellan starterna (delade `hasDoubleRunGap`). Dagens värde är summan av de kvalificerande rundorna
 * (rundor under 5 km eller utan giltig starttid räknas inte). Bästa kvalificerande dagen vinner.
 * Kvalar ingen dag finns inget värde: motorn ger 0, som ligger under varje tröskel, så titeln blir vakant.
 */
export const bestDoubleDayKmEngine: TitleEngine = {
  metricKey: 'bestDoubleDayKm',
  calculate(runs: RunData[], _: UserStats): number {
    const byDate = new Map<string, RunData[]>();
    for (const run of runs) {
      if (!byDate.has(run.date)) byDate.set(run.date, []);
      byDate.get(run.date)!.push(run);
    }

    let best = 0;
    for (const dayRuns of byDate.values()) {
      const qualifying = dayRuns.filter(r => r.distance_km >= MIN_DISTANCE_KM && r.start_time && Number.isFinite(new Date(r.start_time).getTime()));
      if (qualifying.length < 2) continue;
      if (!hasDoubleRunGap(qualifying.map(r => new Date(r.start_time!).getTime()))) continue;

      const total = qualifying.reduce((sum, r) => sum + r.distance_km, 0);
      if (total > best) best = total;
    }
    return best;
  }
};
