import type { Run } from '@runquest/types';
import { stockholmClock } from '@/app-shell/rightNowItems';

// Rena formatterare för Board. `now` skickas alltid in så att tiderna går att testa med fasta klockslag.

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** "1 126" — heltal med tusentalsmellanrum som designen. */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('sv-SE');
}

/** "32.8" — en decimal, punkt som decimaltecken. */
export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function calendarDayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_DAY;
}

/** Heltalsdagar mellan två kalenderdagar (YYYY-MM-DD). */
export function daysBetween(fromDate: string, toDate: string): number {
  return calendarDayNumber(toDate) - calendarDayNumber(fromDate);
}

/** ISO-veckonummer (mån–sön, vecka 1 = veckan med årets första torsdag) för en kalenderdag. */
export function isoWeekNumber(isoDate: string): number {
  const dayNumber = calendarDayNumber(isoDate);
  const weekday = (new Date(dayNumber * MS_DAY).getUTCDay() + 6) % 7; // 0 = måndag
  const thursday = dayNumber - weekday + 3;
  const year = new Date(thursday * MS_DAY).getUTCFullYear();
  return Math.floor((thursday - Date.UTC(year, 0, 1) / MS_DAY) / 7) + 1;
}

/**
 * Exakt tidpunkt för en runda, om den går att lita på: Strava-rundans `start_time`, eller
 * `created_at` när raden skapades samma Stockholm-dag som rundan (manuell loggning). En runda som
 * loggats i efterhand får inte ge "5 h ago" — då faller vi tillbaka på kalenderdagen.
 */
export function preciseRunTime(run: Pick<Run, 'date' | 'start_time' | 'created_at'>): number | null {
  const startMs = run.start_time ? new Date(run.start_time).getTime() : NaN;
  if (!Number.isNaN(startMs)) return startMs;

  const createdMs = run.created_at ? new Date(run.created_at).getTime() : NaN;
  if (!Number.isNaN(createdMs) && stockholmClock(new Date(createdMs)).date === run.date.slice(0, 10)) return createdMs;
  return null;
}

/** "5 h ago", "4 d ago", "today" (kalenderdag utan klockslag), "just now". */
export function formatRunAge(run: Pick<Run, 'date' | 'start_time' | 'created_at'>, now: Date): string {
  const precise = preciseRunTime(run);
  if (precise !== null) {
    const age = now.getTime() - precise;
    if (age < MS_MINUTE) return 'just now';
    if (age < MS_HOUR) return `${Math.floor(age / MS_MINUTE)} m ago`;
    if (age < MS_DAY) return `${Math.floor(age / MS_HOUR)} h ago`;
  }
  const days = daysBetween(run.date.slice(0, 10), stockholmClock(now).date);
  if (days <= 0) return 'today';
  return `${days} d ago`;
}

/** "6h 12m" — för "left"-texter i streak-listan; Right now-pillen använder den grövre formatRemaining. */
export function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MS_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** "6h 12m 05s" — nedräkningen i "Your streak dies in". */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DeltaView {
  direction: DeltaDirection;
  /** Antal placeringar (alltid >= 0). */
  places: number;
  /** "▲ 2", "▼ 1" eller "—". */
  text: string;
}

/** Rank-förändring (positivt = klättrat, som i ADR 007) → pil. null/0 = ingen förändring. */
export function deltaView(delta: number | null | undefined): DeltaView {
  if (!delta) return { direction: 'flat', places: 0, text: '—' };
  return delta > 0
    ? { direction: 'up', places: delta, text: `▲ ${delta}` }
    : { direction: 'down', places: Math.abs(delta), text: `▼ ${Math.abs(delta)}` };
}

/** Skärmläsartext för en delta-pil. */
export function deltaLabel(delta: DeltaView): string {
  if (delta.direction === 'flat') return 'No change';
  const word = delta.direction === 'up' ? 'Up' : 'Down';
  return `${word} ${delta.places} ${delta.places === 1 ? 'place' : 'places'}`;
}
