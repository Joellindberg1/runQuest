import { stockholmClock } from '@/app-shell/rightNowItems';
import { daysBetween } from '@/features/leaderboard/boardFormat';

// Rena formatterare för Events: tider i Stockholm, nedräkningar, mått. `now` skickas alltid in så att allt går att testa
// med fasta klockslag. Engelskt UI — tal och datum i en-GB, egna månads- och veckodagsnamn (Intl:s förkortningar skiljer
// mellan ICU-versioner: "Sept").

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const ONE_DECIMAL = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Kalenderdagen (YYYY-MM-DD) i Stockholm för ett ISO-klockslag. */
export const stockholmDate = (iso: string): string => stockholmClock(new Date(iso)).date;

/** "18:00" i Stockholm-tid. */
export function formatClock(iso: string): string {
  const { msIntoDay } = stockholmClock(new Date(iso));
  return `${pad2(Math.floor(msIntoDay / MS_HOUR))}:${pad2(Math.floor((msIntoDay % MS_HOUR) / MS_MINUTE))}`;
}

/** "Sat" för en kalenderdag (YYYY-MM-DD). */
export function weekdayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** "21 Aug" för en kalenderdag (YYYY-MM-DD). */
export function formatDayMonth(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "Today" · "Tomorrow" · "Sat" — dagen ett kommande event öppnar, sett från Stockholm-dagen `now`. */
export function dayLabel(startsAt: string, now: Date): string {
  const date = stockholmDate(startsAt);
  const days = daysBetween(stockholmClock(now).date, date);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return weekdayOf(date);
}

/** Nedräkning med grov enhet: "3d 4h" · "6h 14m" · "14m" · "<1m". */
export function formatCountdown(ms: number): string {
  if (ms < MS_MINUTE) return '<1m';
  if (ms < MS_HOUR) return `${Math.floor(ms / MS_MINUTE)}m`;
  if (ms < MS_DAY) return `${Math.floor(ms / MS_HOUR)}h ${Math.floor((ms % MS_HOUR) / MS_MINUTE)}m`;
  return `${Math.floor(ms / MS_DAY)}d ${Math.floor((ms % MS_DAY) / MS_HOUR)}h`;
}

/**
 * Eventfönstret som text: "18:00–22:00" inom en dag, "all day" när det spänner över hela dygnet (00:00–23:59),
 * annars "Mon 00:01 – Sun 23:59" (veckotävlingen).
 */
export function windowText(startsAt: string, endsAt: string): string {
  const startDate = stockholmDate(startsAt);
  const endDate = stockholmDate(endsAt);
  const start = formatClock(startsAt);
  const end = formatClock(endsAt);
  if (startDate === endDate) {
    return start <= '00:01' && end >= '23:59' ? 'all day' : `${start}–${end}`;
  }
  return `${weekdayOf(startDate)} ${start} – ${weekdayOf(endDate)} ${end}`;
}

/** "28 Sep – 4 Oct" (en dag: "21 Aug") — eventets datum i historiken. */
export function dateRangeText(startsAt: string, endsAt: string): string {
  const start = stockholmDate(startsAt);
  const end = stockholmDate(endsAt);
  return start === end ? formatDayMonth(start) : `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** "10.0 km" — en decimal, enhet. */
export const formatKm = (value: number): string => `${ONE_DECIMAL.format(value)} km`;

/** "1,240 m" — höjdmeter som heltal. */
export const formatMetres = (value: number): string => `${WHOLE.format(Math.round(value))} m`;

/** Måttets värde i tävlingstabellen: km som standard, annars höjdmeter (backend räknar `metric === 'km'`, annars elevation). */
export const formatEventValue = (metric: string | null, value: number): string => (metric === 'km' ? formatKm(value) : formatMetres(value));

export const formatXp = (value: number): string => `${WHOLE.format(value)} XP`;

/** "5 km" / "2.5 km" — minsta distans utan onödig decimal. */
export const formatMinKm = (value: number): string => `${Number(value.toFixed(1))} km`;

/** Ordningstal för pallplatser i prisraderna. */
export const ordinal = (rank: number): string => ['1st', '2nd', '3rd'][rank - 1] ?? `${rank}th`;
