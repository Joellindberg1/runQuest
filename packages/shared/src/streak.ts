/**
 * Streak-räkning — EN implementation för backend (nattjobb, totaler, omräkning) och frontend (förhandsvisning,
 * deadline-pillret). RUN-216 ersatte fem egna loopar som dessutom läste "idag" olika (UTC / processens tidszon /
 * Stockholm).
 *
 * Alla dagar är Stockholm-kalenderdagar som YYYY-MM-DD-strängar; ren kalenderaritmetik, ingen systemtid. "Idag" tas
 * fram på ett enda ställe (`stockholmDay` i calendar.ts, som också äger dagaritmetiken) och skickas in — funktionerna här läser aldrig klockan själva.
 * En streak lever om dess senaste dag är idag eller igår (igår = kan räddas idag).
 */
import { addDays, daysBetween } from './calendar.js';
import { streakSegments } from './activityBackfill.js';

/** Längsta obrutna följden av löpdagar (unika dagar; 0 utan dagar). */
export function longestStreak(days: ReadonlyArray<string>): number {
  return streakSegments(days).reduce((longest, segment) => Math.max(longest, segment.length), 0);
}

export type StreakStatus = 'ran_today' | 'ran_yesterday' | 'broken';

/** Läget för en streak vars senaste löpdag är `lastRunDay`. `null` (ingen runda) räknas som bruten. */
export function streakStatus(lastRunDay: string | null, today: string): StreakStatus {
  if (lastRunDay === today) return 'ran_today';
  if (lastRunDay !== null && lastRunDay === addDays(today, -1)) return 'ran_yesterday';
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
  return segment ? daysBetween(segment.start, target) + 1 : 1;
}

export interface PreviousRunDay {
  /** Dagen för rundan närmast före (YYYY-MM-DD). */
  day: string;
  /** Rundans lagrade streakdag (0 om den saknas). */
  streakDay: number;
}

/** Är `to` dagen efter `from`? */
export function isNextDay(from: string, to: string): boolean {
  return daysBetween(from, to) === 1;
}

/**
 * Streakdagen en runda på `day` får efter rundan `previous` — multiplikatortrappan i omräkningen:
 * ingen föregående eller glapp över en dag → 1, dagen efter → +1, samma dag → oförändrad.
 */
export function advanceStreakDay(previous: PreviousRunDay | null, day: string): number {
  if (!previous) return 1;
  const gap = daysBetween(previous.day, day);
  if (gap > 1) return 1;
  if (gap === 1) return previous.streakDay + 1;
  return previous.streakDay;
}
