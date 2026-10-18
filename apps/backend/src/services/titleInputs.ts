// Vad titelmotorerna får för en medlem i en grupp (ADR 012 beslut 1.3). EN källa för omräkningen av user_titles (processGroupTitles)
// och för group-eligibility (S7), så att "Best so far" och de lagrade innehavarna räknas ur samma rundor.
//
// Utan startdag (fönstret har ingen nedre gräns, dagens läge i prod) är indata exakt det de alltid varit: alla rundor och de lagrade
// totalerna users.total_km/longest_streak (som calculateUserTotals är enda skribent till, ADR 005). Med en startdag räknas rundor, km och streak ur
// fönstret, eftersom de lagrade totalerna gäller all historik.
import { longestStreak, runsInWindow, type TitleWindow } from '@runquest/shared';
import type { UserStats } from '../titleEngines/types';

/** De lagrade totalerna ur users (numeric från PostgREST; null om kolumnen saknar värde). */
export interface StoredTotals {
  total_km: number | null;
  longest_streak: number | null;
}

export interface TitleInputs<TRun> {
  runs: TRun[];
  stats: UserStats;
}

/** Rundornas km avrundade till numeric(8,2), skalan som users.total_km har. */
function roundKm(km: number): number {
  return Math.round(km * 100) / 100;
}

export function titleInputs<TRun extends { date: string; distance_km: number | string }>(
  runs: readonly TRun[],
  window: TitleWindow,
  stored: StoredTotals,
): TitleInputs<TRun> {
  if (window.from === null) {
    return { runs: [...runs], stats: { totalKm: stored.total_km || 0, longestStreak: stored.longest_streak || 0 } };
  }
  const inWindow = runsInWindow(runs, window);
  const totalKm = inWindow.reduce((sum, run) => sum + (parseFloat(String(run.distance_km)) || 0), 0);
  return {
    runs: inWindow,
    stats: { totalKm: roundKm(totalKm), longestStreak: longestStreak(inWindow.map((run) => run.date)) },
  };
}
