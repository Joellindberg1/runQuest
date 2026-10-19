// Backendens datumhjälpare i Stockholm-tid. Själva kalender- och tidszonsaritmetiken (addDays, mondayOf, stockholmDay,
// klockslag -> ögonblick) ligger i packages/shared/src/calendar.ts (RUN-218); här finns bara det som är specifikt för
// backend: "idag" ur systemklockan och veckointervallet.
import { addDays, mondayOf, stockholmDay } from '@runquest/shared';

/** Returns today's date in Stockholm timezone as "YYYY-MM-DD" */
export function todayStockholm(): string {
  return stockholmDay(new Date());
}

/** Returns tomorrow's date in Stockholm timezone as "YYYY-MM-DD" */
export function tomorrowStockholm(): string {
  return addDays(todayStockholm(), 1);
}

/** Konverterar en UTC ISO-sträng (timestamptz) till "YYYY-MM-DD" i Stockholm-tid. */
export function toStockholmDate(isoString: string): string {
  return stockholmDay(new Date(isoString));
}

/** Veckan (mån–sön) som datumet tillhör, plus förra veckans måndag. */
export function weekRange(dateStr: string): { start: string; end: string; previous_start: string } {
  const start = mondayOf(dateStr);
  return { start, end: addDays(start, 6), previous_start: addDays(start, -7) };
}
