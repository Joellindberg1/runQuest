import { MS_HOUR, MS_MINUTE, dayOfWeek, daysBetween, stockholmClock, zoneDay } from '@runquest/shared';
import { formatDayMonth, formatInt, formatKm } from '@/shared/utils/format';

// Rena formatterare för Events: tider i Stockholm och mått. `now` skickas alltid in så att allt går att testa med fasta
// klockslag. Engelskt UI — tal, km och månadsnamn ligger i shared/utils/format; här finns de egna veckodagsnamnen.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** "18:00" i Stockholm-tid. */
export function formatClock(iso: string): string {
  const { msIntoDay } = stockholmClock(new Date(iso));
  return `${pad2(Math.floor(msIntoDay / MS_HOUR))}:${pad2(Math.floor((msIntoDay % MS_HOUR) / MS_MINUTE))}`;
}

/** "Sat" för en kalenderdag (YYYY-MM-DD). */
export function weekdayOf(date: string): string {
  return WEEKDAYS[dayOfWeek(date)];
}

/** "Today" · "Tomorrow" · "Sat" — dagen ett kommande event öppnar, sett från Stockholm-dagen `now`. */
export function dayLabel(startsAt: string, now: Date): string {
  const date = zoneDay(new Date(startsAt));
  const days = daysBetween(stockholmClock(now).date, date);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return weekdayOf(date);
}

/**
 * Eventfönstret som text: "18:00–22:00" inom en dag, "all day" när det spänner över hela dygnet (00:00–23:59),
 * annars "Mon 00:01 – Sun 23:59" (veckotävlingen).
 */
export function windowText(startsAt: string, endsAt: string): string {
  const startDate = zoneDay(new Date(startsAt));
  const endDate = zoneDay(new Date(endsAt));
  const start = formatClock(startsAt);
  const end = formatClock(endsAt);
  if (startDate === endDate) {
    return start <= '00:01' && end >= '23:59' ? 'all day' : `${start}–${end}`;
  }
  return `${weekdayOf(startDate)} ${start} – ${weekdayOf(endDate)} ${end}`;
}

/** "28 Sep – 4 Oct" (en dag: "21 Aug") — eventets datum i historiken. */
export function dateRangeText(startsAt: string, endsAt: string): string {
  const start = zoneDay(new Date(startsAt));
  const end = zoneDay(new Date(endsAt));
  return start === end ? formatDayMonth(start) : `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** "10.0 km" — en decimal, enhet. */
export const formatKmWithUnit = (value: number): string => `${formatKm(value)} km`;

/** "1 240 m" — höjdmeter som heltal. */
export const formatMetres = (value: number): string => `${formatInt(value)} m`;

/** Måttets värde i tävlingstabellen: km som standard, annars höjdmeter (backend räknar `metric === 'km'`, annars elevation). */
export const formatEventValue = (metric: string | null, value: number): string => (metric === 'km' ? formatKmWithUnit(value) : formatMetres(value));

/** "5 km" / "2.5 km" — minsta distans utan onödig decimal. */
export const formatMinKm = (value: number): string => `${Number(value.toFixed(1))} km`;

/** Ordningstal för pallplatser i prisraderna. */
export const ordinal = (rank: number): string => ['1st', '2nd', '3rd'][rank - 1] ?? `${rank}th`;
