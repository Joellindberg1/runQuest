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

/** True för ett riktigt kalenderdatum på formen "YYYY-MM-DD" (avvisar t.ex. 2026-02-30). */
export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Veckan (mån–sön) som datumet tillhör, plus förra veckans måndag. */
export function weekRange(dateStr: string): { start: string; end: string; previous_start: string } {
  const start = mondayOf(dateStr);
  return { start, end: addDays(start, 6), previous_start: addDays(start, -7) };
}
