import type { Run } from '@runquest/types';
import { stockholmClock } from '@/app-shell/rightNowItems';
import { daysBetween } from '@/features/leaderboard/boardFormat';
import { MIN_RUN_DATE, MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';
import { formatInt, formatKm, formatLongDate, formatMultiplier } from './logFormat';

// Formulärets ren logik: tillstånd, validering (speglar POST /runs) och streakdagen en ny runda får.
// Ingen DOM, ingen datahämtning — `now`/`today` skickas alltid in.

export const LOG_VIEWS = ['form', 'group'] as const;
export type LogView = (typeof LOG_VIEWS)[number];
export const DEFAULT_LOG_VIEW: LogView = 'form';

/** Snabbvalen under distansfältet (prototypen: 3 · 5 · 10 · 15 · 21.1 km). */
export const QUICK_KM = ['3', '5', '10', '15', '21.1'] as const;

export type Surface = 'outdoor' | 'treadmill';

export interface LogForm {
  /** YYYY-MM-DD. */
  date: string;
  /** Råtext som den skrivits — "8,4" och "8.4" är samma tal. */
  distance: string;
  surface: Surface;
}

export interface FieldErrors {
  date?: string;
  distance?: string;
}

/** Idag som Stockholm-dag — samma dygnsgräns som streaken och resten av appen. */
export function todayOf(now: Date): string {
  return stockholmClock(now).date;
}

export function initialForm(now: Date): LogForm {
  return { date: todayOf(now), distance: '', surface: 'outdoor' };
}

/** "8.4" / "8,4" → 8.4. Tomt eller något som inte är ett tal → null. */
export function parseKm(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Vänliga fel med backendens regler: minst 1.0 km. Tomt fält är ett fel först vid inlämning (`allowEmpty`). */
export function validateDistance(raw: string, { allowEmpty = false } = {}): string | undefined {
  if (raw.trim() === '') return allowEmpty ? undefined : 'Enter a distance in km';
  const km = parseKm(raw);
  if (km === null) return 'Distance must be a number, like 8.4';
  if (km < MIN_RUN_DISTANCE_KM) return `A run needs at least ${formatKm(MIN_RUN_DISTANCE_KM)} km to count`;
  return undefined;
}

/** Backendens datumregler: inte före 2025-06-01 och inte i framtiden. `today` = Stockholm-dagen. */
export function validateDate(date: string, today: string): string | undefined {
  if (!isCalendarDate(date)) return 'Pick a date';
  if (date < MIN_RUN_DATE) return `Runs can only be logged from ${formatLongDate(MIN_RUN_DATE)}`;
  if (date > today) return 'You cannot log a run for a future date';
  return undefined;
}

export function validateForm(form: LogForm, today: string, { allowEmptyDistance = false } = {}): FieldErrors {
  const errors: FieldErrors = {};
  const date = validateDate(form.date, today);
  const distance = validateDistance(form.distance, { allowEmpty: allowEmptyDistance });
  if (date) errors.date = date;
  if (distance) errors.distance = distance;
  return errors;
}

export interface RunSubmission {
  date: string;
  distance: number;
  isTreadmill: boolean;
}

/** Det som skickas till POST /runs, eller felen. Alltid en bool för `is_treadmill`: valet är gjort i formuläret. */
export function buildSubmission(
  form: LogForm,
  today: string,
): { ok: true; submission: RunSubmission } | { ok: false; errors: FieldErrors } {
  const errors = validateForm(form, today);
  const km = parseKm(form.distance);
  if (Object.keys(errors).length > 0 || km === null) return { ok: false, errors };
  return { ok: true, submission: { date: form.date, distance: km, isTreadmill: form.surface === 'treadmill' } };
}

export type StreakKind = 'start' | 'continue' | 'counted';

export interface StreakOutlook {
  /** Streakdagen rundan får — den som styr multiplikatorn. */
  day: number;
  /**
   * start = ny streak (dag 1) · continue = dagen efter min senaste runda · counted = jag har redan en runda den dagen,
   * rundan ändrar inte streaken.
   */
  kind: StreakKind;
}

type StreakRun = Pick<Run, 'date' | 'streak_day'>;

/**
 * Streakdagen en ny runda på `date` får — samma regel som backendens omräkning (`reprocessRunsFromDate`):
 * rundan närmast före datumet avgör (dagen efter → +1, längre bort → dag 1), flera rundor samma dag delar dag.
 */
export function streakOutlook(runs: readonly StreakRun[], date: string): StreakOutlook {
  const day = (run: StreakRun) => run.date.slice(0, 10);
  const sameDay = runs.filter((run) => day(run) === date);
  if (sameDay.length > 0) return { day: Math.max(...sameDay.map((run) => run.streak_day)), kind: 'counted' };

  const before = runs.filter((run) => day(run) < date);
  if (before.length === 0) return { day: 1, kind: 'start' };
  const prevDate = before.reduce((latest, run) => (day(run) > latest ? day(run) : latest), '');
  if (daysBetween(prevDate, date) !== 1) return { day: 1, kind: 'start' };
  const prevDay = Math.max(...before.filter((run) => day(run) === prevDate).map((run) => run.streak_day));
  return { day: prevDay + 1, kind: 'continue' };
}

/** Bekräftelsen efter en lyckad inlämning — siffrorna är serverns, inte förhandsvisningens. */
export function confirmationText(run: Pick<Run, 'distance' | 'xp_gained' | 'multiplier' | 'streak_day'>): string {
  const streak = run.streak_day > 1 ? ` · streak day ${run.streak_day} at ${formatMultiplier(run.multiplier)}` : '';
  return `Run logged: ${formatKm(Number(run.distance))} km for ${formatInt(run.xp_gained)} XP${streak}`;
}
