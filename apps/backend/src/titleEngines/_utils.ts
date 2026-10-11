import type { RunData } from './types';
import { toStockholmDate } from '../utils/dateUtils';

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

/** Antal rundor som uppfyller villkoret (gemensam för räknande motorer). */
export function countRunsWhere(runs: RunData[], predicate: (run: RunData) => boolean): number {
  let count = 0;
  for (const run of runs) if (predicate(run)) count++;
  return count;
}

/** numeric från PostgREST kan komma som sträng. Tomt/ogiltigt → null (aldrig NaN, aldrig tyst 0). */
function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * En rad ur runs-selecten (med `distance_km` som alias för `distance`, ev. inbäddad `run_weather`) → RunData.
 * Enda mappningen rad → motorindata. run_weather är ett objekt (en-till-en-embed) eller en array med ett element.
 * Fälten som fanns före RUN-98 mappas exakt som förr (distans via parseFloat, övriga igenom med null som default).
 */
export function toRunData(row: Record<string, unknown>): RunData {
  const embed = row.run_weather;
  const weather = (Array.isArray(embed) ? embed[0] : embed) as Record<string, unknown> | null | undefined;
  return {
    date: row.date as string,
    distance_km: parseFloat(row.distance_km as string) || 0,
    start_time: (row.start_time as string | null | undefined) ?? null,
    total_elevation_gain: (row.total_elevation_gain as number | null | undefined) ?? null,
    pace_std_dev: (row.pace_std_dev as number | null | undefined) ?? null,
    moving_time: (row.moving_time as number | null | undefined) ?? null,
    temperature_c: toNullableNumber(weather?.temperature_c),
    wind_speed_ms: toNullableNumber(weather?.wind_speed_ms),
    wind_gusts_ms: toNullableNumber(weather?.wind_gusts_ms),
  };
}

/**
 * Vinterfönstret [start, end) som kalenderdagar ("YYYY-MM-DD", end exklusiv = 1 mars) för Winter Warrior.
 * Stockholm-datumet ur `now` avgör: december räknar den vinter som börjar i år, jan–nov den som började
 * föregående december — så mars–nov blir senast avslutade vinter. Fönstret byter alltså först vid nästa
 * omräkning efter 1 dec (ingen cron). `runs.date` är en kalenderdag, så jämförelsen görs som sträng.
 */
export function winterWindow(now: Date): { start: string; end: string } {
  const [year, month] = toStockholmDate(now.toISOString()).split('-').map(Number);
  const winterStartYear = month === 12 ? year : year - 1;
  return { start: `${winterStartYear}-12-01`, end: `${winterStartYear + 1}-03-01` };
}
