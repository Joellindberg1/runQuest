import type { Run } from '@runquest/types';
import { buildHero, buildStatCells, buildTitleRows, xpToNextText, type RunnerHero, type StatCell, type TitleRows } from '@/features/runner/runnerModel';
import { parseKm, validateDate, validateDistance, type FieldErrors } from '@/features/log/logModel';
import { formatDayMonth, formatInt, formatKm, formatMultiplier } from '@/shared/utils/format';
import { formatDuration, formatPace, spokenDuration } from '@/shared/utils/runTimeFormat';
import { PROFILE_PICTURE_MAX_BYTES, PROFILE_PICTURE_MIME_TYPES, paceSecPerKm, summariseRunTime, type TitleLeaderboardEntry, type UpdateRunRequest, type UserTitleEntry } from '@runquest/shared';

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

export function buildMyTitles(userTitles: UserTitleEntry[], board: TitleLeaderboardEntry[], gender: string | null | undefined, compact: boolean, expanded: boolean): MyTitlesView {
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
  /** Tid och tempo för raden (etiketten "Time"); "—" när rundan saknar användbar tid. */
  timing: RunTimeCell;
  run: Run;
}

/** Tid och tempo som visas: `time`/`pace` är den synliga texten, `label` är EN mening för skärmläsare (de synliga fälten döljs för den). */
export interface RunTimeCell {
  /** Falskt när tid eller tempo saknas; då är `time` och `pace` tankstreck och `label` "no time recorded". */
  timed: boolean;
  /** "52:10" under en timme, "1:09:40" från en timme, annars "—". */
  time: string;
  /** "5:13 /km", annars "—". */
  pace: string;
  label: string;
}

const NO_TIME = '—';

/** Ett tempo som kan visas: ett ändligt tal över noll (`paceSecPerKm` kan ge 0 när tiden är mycket kort mot distansen). */
const usablePace = (pace: number | null): pace is number => pace !== null && Number.isFinite(pace) && pace > 0;

const missingTime: RunTimeCell = { timed: false, time: NO_TIME, pace: NO_TIME, label: 'no time recorded' };

/** Grenar före formateringen: saknad, null, 0, NaN eller negativ tid, eller ett tempo som inte går att visa, ger tankstreck. */
export function buildRunTime(run: Pick<Run, 'moving_time' | 'distance'>): RunTimeCell {
  const pace = paceSecPerKm(run.moving_time, run.distance);
  if (!usablePace(pace) || run.moving_time == null) return missingTime;
  return {
    timed: true,
    time: formatDuration(run.moving_time),
    pace: `${formatPace(pace)} /km`,
    label: `Time ${spokenDuration(run.moving_time)}, pace ${formatPace(pace)} per kilometre`,
  };
}

/** Summan under rundlistan, för de rundor som visas just nu. */
export interface RunTimeSummaryView extends RunTimeCell {
  /** "based on 3 of 4 runs" — bara när någon visad runda saknar tid. */
  basis: string | null;
}

export function buildRunTimeSummary(runs: readonly Run[]): RunTimeSummaryView {
  const summary = summariseRunTime(runs);
  const { pace_sec_per_km: pace, total_seconds: seconds, runs_with_time: timed, runs_total: total } = summary;
  const basis = timed < total ? `based on ${timed} of ${total} runs` : null;
  if (timed === 0 || !usablePace(pace) || !(seconds > 0)) return { ...missingTime, label: `Total time: ${missingTime.label}`, basis };
  return {
    timed: true,
    time: formatDuration(seconds),
    pace: `${formatPace(pace)} /km`,
    label: `Total time ${spokenDuration(seconds)}, pace ${formatPace(pace)} per kilometre`,
    basis,
  };
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
    timing: buildRunTime(run),
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

export function buildUpdate(form: EditForm, today: string, original: Pick<Run, 'date'>): { ok: true; update: UpdateRunRequest } | { ok: false; errors: FieldErrors } {
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

export const STRAVA_DELETE_HINT = 'Strava runs come back from Strava — delete it in Strava instead';

/** Bekräftelsen efter en sparad ändring — siffrorna är serverns (rundan efter omräkningen). */
export function updateNotice(run: Pick<Run, 'date' | 'distance' | 'xp_gained'>): string {
  return `Run updated: ${formatKm(Number(run.distance))} km on ${formatDayMonth(run.date)} for ${formatInt(run.xp_gained)} XP. Your streak and XP are recalculated from that day on.`;
}

export function deleteNotice(run: Pick<Run, 'date' | 'distance'>): string {
  return `Run deleted: ${formatKm(run.distance)} km on ${formatDayMonth(run.date)}. Your streak and XP are recalculated from that day on.`;
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

/** Samma regler som POST /users/profile-picture: JPEG, PNG, WebP eller GIF, högst 5 MB. */
export function validatePicture(file: Pick<File, 'size' | 'type'> | undefined): string | null {
  if (!file) return 'Choose an image to upload';
  if (file.size > PROFILE_PICTURE_MAX_BYTES) return 'The image must be smaller than 5 MB';
  if (!PROFILE_PICTURE_MIME_TYPES.includes(file.type)) return 'Only JPEG, PNG, WebP or GIF images are allowed';
  return null;
}

