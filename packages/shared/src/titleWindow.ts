// Titelfönstret: vilka rundor som räknas för en användares titlar i en grupp (ADR 012 beslut 1.3).
//
// Ett medlemskap (group_members) bär `starts_on`, en Stockholm-kalenderdag. `null` = hela historiken räknas (användarens första
// grupp); annars räknas bara rundor från och med joindagen (ägarbeslut F3/N1: en ny grupp börjar från noll). EN källa för
// omräkningen av user_titles och för group-eligibility, så att "Best so far" och de lagrade innehavarna ser samma rundor.
//
// Dagarna är kalenderdagar (YYYY-MM-DD), inte ögonblick, och jämförs med calendar.ts (daysBetween): ingen tidszon, ingen
// sommartid och ingen systemklocka. Vid säsonger (v0.9.0) blir fönstret `max(starts_on, säsongsstart)..säsongsslut`; det är
// ett argument till i den här funktionen, inte ett nytt begrepp.
import { addDays, daysBetween } from './calendar.js';

export interface TitleMembership {
  /** `group_members.starts_on`: Stockholm-dag från vilken rundor räknas, eller null = hela historiken. */
  starts_on: string | null;
}

export interface TitleWindow {
  /** Första dagen som räknas (inklusive), eller null = ingen nedre gräns. */
  from: string | null;
}

/**
 * Är värdet en riktig kalenderdag på formen YYYY-MM-DD? DEN enda definitionen: en dag som rullar över (2026-02-30), en tidpunkt, fri
 * text och allt som inte är en sträng är falskt. addDays(d, 0) går tur och retur via UTC, så en dag som inte finns ger inte tillbaka
 * samma sträng (eller kastar), och tidszon och systemklocka spelar ingen roll.
 */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

function assertCalendarDay(value: string, what: string): void {
  if (!isCalendarDay(value)) throw new RangeError(`${what} är inte en kalenderdag (YYYY-MM-DD): ${JSON.stringify(value)}`);
}

/** Fönstret för ett medlemskap. RangeError om `starts_on` är satt men inte en riktig kalenderdag. */
export function titleWindow(membership: TitleMembership): TitleWindow {
  if (membership.starts_on === null) return { from: null };
  assertCalendarDay(membership.starts_on, 'starts_on');
  return { from: membership.starts_on };
}

/**
 * Rundorna som ligger i fönstret, i oförändrad ordning (en ny lista; indatan rörs inte). `run.date` är en kalenderdag
 * (runs.date); en runda med ogiltigt datum i ett fönster med startdag ger RangeError i stället för att tyst räknas eller tappas.
 */
export function runsInWindow<TRun extends { date: string }>(runs: readonly TRun[], window: TitleWindow): TRun[] {
  const from = window.from;
  if (from === null) return [...runs];
  return runs.filter((run) => {
    assertCalendarDay(run.date, 'runs.date');
    return daysBetween(from, run.date) >= 0;
  });
}
