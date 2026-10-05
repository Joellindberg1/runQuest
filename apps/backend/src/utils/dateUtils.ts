// Date utilities for Stockholm timezone

const STOCKHOLM = 'Europe/Stockholm';

/** Returns today's date in Stockholm timezone as "YYYY-MM-DD" */
export function todayStockholm(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: STOCKHOLM }).format(new Date());
}

/** Returns tomorrow's date in Stockholm timezone as "YYYY-MM-DD" */
export function tomorrowStockholm(): string {
  return addDaysToDate(todayStockholm(), 1);
}

/** Adds N days to a "YYYY-MM-DD" date string, returns "YYYY-MM-DD" */
export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Use noon UTC to stay safely within the target date regardless of DST
  const result = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return new Intl.DateTimeFormat('sv-SE', { timeZone: STOCKHOLM }).format(result);
}

/** Konverterar en UTC ISO-sträng (timestamptz) till "YYYY-MM-DD" i Stockholm-tid. */
export function toStockholmDate(isoString: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(isoString));
}

/** Returns a Date representing 03:00 Stockholm time on the given "YYYY-MM-DD" date */
export function at3amStockholm(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Determine UTC offset for Stockholm on this date by comparing noon UTC vs noon Stockholm
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const noonStockholm = new Date(noonUTC.toLocaleString('en-US', { timeZone: STOCKHOLM }));
  const offsetHours = Math.round((noonStockholm.getTime() - noonUTC.getTime()) / 3600000);
  // 03:00 Stockholm = (3 - offset) UTC
  return new Date(Date.UTC(y, m - 1, d, 3 - offsetHours, 0, 0));
}

/** True för ett riktigt kalenderdatum på formen "YYYY-MM-DD" (avvisar t.ex. 2026-02-30). */
export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Måndagen i veckan (mån–sön) som kalenderdatumet tillhör. Ren kalenderaritmetik —
 * Stockholm-tid spelar roll först när "idag" tas fram (todayStockholm).
 */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0 = söndag
  return addDaysToDate(dateStr, -((dow + 6) % 7));
}

/** Veckan (mån–sön) som datumet tillhör, plus förra veckans måndag. */
export function weekRange(dateStr: string): { start: string; end: string; previous_start: string } {
  const start = mondayOf(dateStr);
  return { start, end: addDaysToDate(start, 6), previous_start: addDaysToDate(start, -7) };
}
