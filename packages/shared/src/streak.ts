/**
 * Streak-räkning — EN implementation för backend (nattjobb, totaler, omräkning) och frontend (förhandsvisning,
 * deadline-pillret). RUN-216 ersatte fem egna loopar som dessutom läste "idag" olika (UTC / processens tidszon /
 * Stockholm).
 *
 * Alla dagar är Stockholm-kalenderdagar som YYYY-MM-DD-strängar; ren kalenderaritmetik, ingen systemtid. "Idag" tas
 * fram på ett enda ställe (`stockholmDay`) och skickas in — funktionerna här läser aldrig klockan själva.
 * En streak lever om dess senaste dag är idag eller igår (igår = kan räddas idag).
 */
import { addDaysToDay } from './activity.js';
import { streakSegments } from './activityBackfill.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const stockholmDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Stockholm-kalenderdagen (YYYY-MM-DD) för ett ögonblick — oberoende av processens tidszon. */
export function stockholmDay(at: Date): string {
  const part = (type: string) => stockholmDateParts.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** Heltalsdagar från `from` till `to` (negativt om `to` ligger före). NaN för ogiltiga datum. */
export function calendarDaysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Längsta obrutna följden av löpdagar (unika dagar; 0 utan dagar). */
export function longestStreak(days: ReadonlyArray<string>): number {
  return streakSegments(days).reduce((longest, segment) => Math.max(longest, segment.length), 0);
}

export type StreakStatus = 'ran_today' | 'ran_yesterday' | 'broken';

/** Läget för en streak vars senaste löpdag är `lastRunDay`. `null` (ingen runda) räknas som bruten. */
export function streakStatus(lastRunDay: string | null, today: string): StreakStatus {
  if (lastRunDay === today) return 'ran_today';
  if (lastRunDay !== null && lastRunDay === addDaysToDay(today, -1)) return 'ran_yesterday';
  return 'broken';
}

/** Nuvarande streak: längden på den senaste följden om den lever (senaste dag idag eller igår), annars 0. */
export function currentStreak(days: ReadonlyArray<string>, today: string): number {
  const segments = streakSegments(days);
  const last = segments[segments.length - 1];
  if (!last) return 0;
  return streakStatus(last.end, today) === 'broken' ? 0 : last.length;
}

/** Vilken streakdag `target` är: antal dagar i följden till och med den. 1 om dagen inte finns bland `days`. */
export function streakDayForRun(days: ReadonlyArray<string>, target: string): number {
  if (!days.includes(target)) return 1;
  const segment = streakSegments(days).find((s) => s.start <= target && target <= s.end);
  return segment ? calendarDaysBetween(segment.start, target) + 1 : 1;
}

export interface PreviousRunDay {
  /** Dagen för rundan närmast före (YYYY-MM-DD). */
  day: string;
  /** Rundans lagrade streakdag (0 om den saknas). */
  streakDay: number;
}

/** Är `to` dagen efter `from`? */
export function isNextDay(from: string, to: string): boolean {
  return calendarDaysBetween(from, to) === 1;
}

/**
 * Streakdagen en runda på `day` får efter rundan `previous` — multiplikatortrappan i omräkningen:
 * ingen föregående eller glapp över en dag → 1, dagen efter → +1, samma dag → oförändrad.
 */
export function advanceStreakDay(previous: PreviousRunDay | null, day: string): number {
  if (!previous) return 1;
  const gap = calendarDaysBetween(previous.day, day);
  if (gap > 1) return 1;
  if (gap === 1) return previous.streakDay + 1;
  return previous.streakDay;
}
