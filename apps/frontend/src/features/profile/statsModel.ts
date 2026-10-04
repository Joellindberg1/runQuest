import type { Run, User } from '@runquest/types';
import { stockholmClock } from '@/app-shell/rightNowItems';
import { daysBetween } from '@/features/leaderboard/boardFormat';
import { buildDistanceRows, buildStreakRows, favouriteWeekday, marathonEquivalents, type StatRow } from '@/features/runner/runnerModel';
import { formatDays } from './profileFormat';

// Statflikarna Distance · Streak · Fun facts (Consistency har heatmapModel). Distance och Streak är samma rader som
// Runner card (EN definition i runnerModel, med trappan ur /config/xp); Fun facts skiljer sig mot Runner card:
// profilen visar "Longest gap between runs" där Runner card visar "Double-run days" (App Prototype, båda skärmarna).

export type { StatRow };
export { buildDistanceRows, buildStreakRows };

/** `?view=` på /profile (ADR 006 beslut 2). */
export const STAT_VIEWS = ['distance', 'streak', 'fun', 'consistency'] as const;
export type StatView = (typeof STAT_VIEWS)[number];
export const DEFAULT_STAT_VIEW: StatView = 'distance';

const dayOf = (run: Pick<Run, 'date'>): string => run.date.slice(0, 10);

/**
 * Längsta uppehållet mellan två rundor, i dagar mellan rundornas datum (löpning två dagar i rad = 1 dag). Bara avslutade
 * uppehåll räknas — tiden sedan senaste rundan är inte ett "uppehåll mellan rundor" än. null med färre än två löpardagar.
 */
export function longestGapDays(runs: Pick<Run, 'date'>[]): number | null {
  const days = [...new Set(runs.map(dayOf))].sort();
  if (days.length < 2) return null;
  let longest = 0;
  for (let i = 1; i < days.length; i += 1) longest = Math.max(longest, daysBetween(days[i - 1], days[i]));
  return longest;
}

export function buildFunRows(user: User, now: Date): StatRow[] {
  const runs = user.runs ?? [];
  const year = stockholmClock(now).date.slice(0, 4);
  const yearKm = runs.filter((run) => dayOf(run).startsWith(year)).reduce((sum, run) => sum + run.distance, 0);
  const gap = longestGapDays(runs);

  return [
    { label: 'Marathon equivalents total', value: String(marathonEquivalents(user.total_km)), tone: 'default' },
    { label: `Marathon equivalents ${year}`, value: String(marathonEquivalents(yearKm)), tone: 'default' },
    { label: 'Longest gap between runs', value: gap === null ? '—' : formatDays(gap), tone: 'muted' },
    { label: 'Favourite day to run', value: favouriteWeekday(runs) ?? '—', tone: 'gold' },
  ];
}
