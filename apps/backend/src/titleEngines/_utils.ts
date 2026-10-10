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

/**
 * Minutes since midnight as read from the UTC fields of an ISO timestamp.
 * For runs.start_time this IS the runner's local wall-clock time: Strava's start_date_local is stored with a
 * false 'Z' (see packages/shared/src/wallClock.ts). Do not convert time zones here — time of day = local time.
 */
export function utcMinutes(ts: string): number {
  const d = new Date(ts);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** ISO day-of-week for a date string: 0=Sun, 1=Mon … 6=Sat */
export function dayOfWeek(dateStr: string): number {
  return new Date(dateStr).getUTCDay();
}
