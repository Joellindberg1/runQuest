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
