import type { Run, UserTitle } from '@runquest/types';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { buildHero, buildStatCells, buildTitleRows, xpToNextText, type RunnerHero, type StatCell, type TitleRows } from '@/features/runner/runnerModel';
import { parseKm, validateDate, validateDistance, type FieldErrors } from '@/features/log/logModel';
import { formatDay, formatInt, formatKm, formatMultiplier } from './profileFormat';

// Profilens vymodeller: hjältekort, titlar, rundhistorik och redigering. Hjälte-, cell- och titellogiken är Runner cards
// (en definition i runnerModel — samma siffror på båda korten); resten är profilens egen. Ren logik, ingen DOM.

export { buildHero, buildStatCells, buildTitleRows, xpToNextText };
export type { RunnerHero, StatCell, TitleRows };

// ─── Titlar ───────────────────────────────────────────────────────────────────

/** Mobilen visar tre titlar tills man trycker "Show all" (App Prototype); desktop visar alla. */
export const COMPACT_TITLE_COUNT = 3;

export interface MyTitlesView {
  rows: TitleRows;
  /** Hållna titlar som visas just nu. */
  held: TitleRows['held'];
  /** Runner-up-rader som visas just nu (mobilen visar dem först när listan fällts ut). */
  runnersUp: TitleRows['runnersUp'];
  /** "5 held · 3 runner-up". */
  summary: string;
  /** "Show all 8" — null när inget är dolt. */
  showAllLabel: string | null;
}

export function buildMyTitles(userTitles: UserTitle[], board: TitleLeaderboard[], gender: string | null | undefined, compact: boolean, expanded: boolean): MyTitlesView {
  const rows = buildTitleRows(userTitles, board, gender);
  const total = rows.held.length + rows.runnersUp.length;
  const collapsed = compact && !expanded;
  const hidden = collapsed && (rows.runnersUp.length > 0 || rows.held.length > COMPACT_TITLE_COUNT);
  return {
    rows,
    held: collapsed ? rows.held.slice(0, COMPACT_TITLE_COUNT) : rows.held,
    runnersUp: collapsed ? [] : rows.runnersUp,
    summary: `${rows.held.length} held · ${rows.runnersUp.length} runner-up`,
    showAllLabel: hidden ? `Show all ${total}` : null,
  };
}

// ─── Rundhistorik ─────────────────────────────────────────────────────────────

/** Rader som visas innan "Show all N runs" (båda prototyperna visar fyra). */
export const HISTORY_PREVIEW_COUNT = 4;

export interface RunRow {
  id: string;
  /** YYYY-MM-DD, som prototypen (Share Tech Mono). */
  date: string;
  /** "10.0 km · outdoor · streak day 4" — underlaget utelämnas när det är okänt (äldre manuella rundor). */
  meta: string;
  xp: string;
  multiplier: string;
  run: Run;
}

const dayOf = (run: Pick<Run, 'date'>): string => run.date.slice(0, 10);

/** Nyast först; samma dag → senast skapad först. */
export function sortRuns(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => dayOf(b).localeCompare(dayOf(a)) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

export function buildRunRow(run: Run): RunRow {
  const surface = run.is_treadmill === true ? 'treadmill' : run.is_treadmill === false ? 'outdoor' : null;
  const parts = [`${formatKm(run.distance)} km`, surface, `streak day ${run.streak_day}`].filter(Boolean);
  return {
    id: run.id,
    date: dayOf(run),
    meta: parts.join(' · '),
    xp: `+${formatInt(run.xp_gained)} XP`,
    multiplier: formatMultiplier(run.multiplier),
    run,
  };
}

export function buildRunRows(runs: readonly Run[]): RunRow[] {
  return sortRuns(runs).map(buildRunRow);
}

/** "Show all 133 runs" — null när allt redan syns. */
export function showAllLabel(total: number): string | null {
  return total > HISTORY_PREVIEW_COUNT ? `Show all ${formatInt(total)} runs` : null;
}

// ─── Redigera / radera en runda ───────────────────────────────────────────────

export interface EditForm {
  /** YYYY-MM-DD. */
  date: string;
  /** Råtext som den skrivits — "8,4" och "8.4" är samma tal. */
  distance: string;
}

export function editFormFor(run: Pick<Run, 'date' | 'distance'>): EditForm {
  return { date: dayOf(run), distance: String(run.distance) };
}

/**
 * Backendens regler (PUT /runs/:id använder samma validering som POST): minst 1.0 km, datum från 2025-06-01 till idag.
 * Ett oförändrat datum valideras inte (och skickas inte): man ska kunna rätta distansen på en äldre runda.
 */
export function validateEdit(form: EditForm, today: string, original?: Pick<Run, 'date'>): FieldErrors {
  const errors: FieldErrors = {};
  const date = original && form.date === dayOf(original) ? undefined : validateDate(form.date, today);
  const distance = validateDistance(form.distance);
  if (date) errors.date = date;
  if (distance) errors.distance = distance;
  return errors;
}

export interface RunUpdate {
  /** Utelämnas när datumet inte ändrats — en ren distansändring ska inte falla på serverns datumvalidering (UTC-"idag"). */
  date?: string;
  distance: number;
}

export function buildUpdate(form: EditForm, today: string, original: Pick<Run, 'date'>): { ok: true; update: RunUpdate } | { ok: false; errors: FieldErrors } {
  const errors = validateEdit(form, today, original);
  const km = parseKm(form.distance);
  if (Object.keys(errors).length > 0 || km === null) return { ok: false, errors };
  return { ok: true, update: form.date === dayOf(original) ? { distance: km } : { date: form.date, distance: km } };
}

/** Sant när något i formuläret skiljer sig från rundan (annars finns inget att spara). */
export function isDirty(form: EditForm, run: Pick<Run, 'date' | 'distance'>): boolean {
  const km = parseKm(form.distance);
  return form.date !== dayOf(run) || km === null || Math.abs(km - run.distance) > 0.001;
}

/**
 * Strava-rundor går inte att radera här: DELETE lämnar ingen gravsten, så synken importerar tillbaka rundan inom sitt
 * 7-dagarsfönster. Edit är tillåten. `source` null/saknas (äldre rader) räknas som manuell.
 */
export const isStravaRun = (run: Pick<Run, 'source'>): boolean => run.source === 'strava';

export const STRAVA_DELETE_HINT = 'Strava runs come back on next sync — delete it in Strava instead';

/** Bekräftelsen efter en sparad ändring — siffrorna är serverns (rundan efter omräkningen). */
export function updateNotice(run: Pick<Run, 'date' | 'distance' | 'xp_gained'>): string {
  return `Run updated: ${formatKm(Number(run.distance))} km on ${formatDay(run.date)} for ${formatInt(run.xp_gained)} XP. Your streak and XP are recalculated from that day on.`;
}

export function deleteNotice(run: Pick<Run, 'date' | 'distance'>): string {
  return `Run deleted: ${formatKm(run.distance)} km on ${formatDay(run.date)}. Your streak and XP are recalculated from that day on.`;
}

/** Uppräkningen som visas i redigeringsrutan: vad rundan gav senast servern räknade. */
export interface XpPart {
  key: 'base' | 'distance' | 'bonus' | 'streak' | 'total';
  label: string;
  value: string;
}

export function buildXpParts(run: Run): XpPart[] {
  return [
    { key: 'base', label: 'Base', value: formatInt(run.base_xp) },
    { key: 'distance', label: 'Distance', value: `+${formatInt(run.km_xp)}` },
    { key: 'bonus', label: 'Distance bonus', value: `+${formatInt(run.distance_bonus)}` },
    { key: 'streak', label: `Streak · ${formatMultiplier(run.multiplier)}`, value: `+${formatInt(run.streak_bonus)}` },
    { key: 'total', label: 'Total', value: `${formatInt(run.xp_gained)} XP` },
  ];
}

// ─── Profilbild ───────────────────────────────────────────────────────────────

export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/** Typerna servern tar emot (apps/backend/src/routes/users.ts, ALLOWED_IMAGE_TYPES). */
export const ACCEPTED_PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** Samma regler som POST /users/profile-picture: JPEG, PNG, WebP eller GIF, högst 5 MB. */
export function validatePicture(file: Pick<File, 'size' | 'type'> | undefined): string | null {
  if (!file) return 'Choose an image to upload';
  if (file.size > MAX_PICTURE_BYTES) return 'The image must be smaller than 5 MB';
  if (!(ACCEPTED_PICTURE_TYPES as readonly string[]).includes(file.type)) return 'Only JPEG, PNG, WebP or GIF images are allowed';
  return null;
}

