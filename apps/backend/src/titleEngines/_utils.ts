/** Days between two ISO date strings (e.g. "2025-01-01"). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/** Monday of the ISO week containing dateStr, as "YYYY-MM-DD". */
export function getMondayKey(dateStr: string): string {
  const date = new Date(dateStr);
  const dow = date.getUTCDay(); // 0=Sun
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysFromMonday);
  return monday.toISOString().split('T')[0];
}

/** UTC hour (0-23) from an ISO timestamp string. */
export function utcHour(ts: string): number {
  return new Date(ts).getUTCHours();
}

/** UTC minutes-since-midnight from an ISO timestamp string. */
export function utcMinutes(ts: string): number {
  const d = new Date(ts);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** ISO day-of-week for a date string: 0=Sun, 1=Mon … 6=Sat */
export function dayOfWeek(dateStr: string): number {
  return new Date(dateStr).getUTCDay();
}
