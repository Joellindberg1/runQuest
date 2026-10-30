import type { Run, User } from '@runquest/types';
import { daysBetween, stockholmClock } from '@runquest/shared';
import { buildDistanceRows, buildStreakRows, favouriteWeekday, marathonEquivalents, type StatRow } from '@/features/runner/runnerModel';
import { showPositionTab } from '@/features/leaderboard/positionTab';
import { formatDays } from './profileFormat';

// Statflikarna Distance · Streak · Fun facts (Consistency har heatmapModel). Distance och Streak är samma rader som
// Runner card (EN definition i runnerModel, med trappan ur /config/xp); Fun facts skiljer sig mot Runner card:
// profilen visar "Longest gap between runs" där Runner card visar "Double-run days" (App Prototype, båda skärmarna).

export type { StatRow };
export { buildDistanceRows, buildStreakRows };

/** De fyra flikarna som alla ser, i designens ordning. Position kommer efter dem och finns bara i en grupp på minst två (`statViewsFor`). */
export const STAT_VIEWS = ['distance', 'streak', 'fun', 'consistency'] as const;
export const POSITION_VIEW = 'position';
/** `?view=` på /profile (ADR 006 beslut 2). */
export type StatView = (typeof STAT_VIEWS)[number] | typeof POSITION_VIEW;
export const DEFAULT_STAT_VIEW: StatView = 'distance';

/** De värden `?view=` får anta för en grupp av den här storleken: övriga (också `position` i en grupp på en) faller tillbaka på standardfliken. */
export function statViewsFor(memberCount: number): readonly StatView[] {
  return showPositionTab(memberCount) ? [...STAT_VIEWS, POSITION_VIEW] : STAT_VIEWS;
}

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
