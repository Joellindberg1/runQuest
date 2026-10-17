import { formatAgo, formatLongDate } from '@/features/log/logFormat';
import { stockholmDay, stravaPollIntervalLabel, type StravaStatusResponse } from '@runquest/shared';
import type { Run } from '@runquest/types';
import { validatePassword } from '@/shared/utils/validation';
import { STRAVA_RUN_TYPES_LABEL } from '@/features/playbook/playbookFacts';
import { STILL_REMOVED_SENTENCE } from './stravaConnectionCopy';

// Settings-skärmens vymodeller: Strava-kortet ur /strava/status, den senaste importen som en rad, och
// lösenordsbytets validering (samma regler som tidigare: alla fält, lika lösenord, minst 6 tecken). Ren logik — ingen DOM.

export type StravaStatusInput = StravaStatusResponse;

export type StravaCardState = 'connected' | 'paused' | 'expired' | 'disconnected';
/** `paused` är en neutral bläcktoning (inte silver: silver är placering 2) för en pausad synk. */
export type Tone = 'up' | 'down' | 'muted' | 'paused';

export interface StravaMetaCell {
  key: 'connected' | 'last';
  label: string;
  value: string;
  tone: Tone;
}

export interface StravaCardView {
  state: StravaCardState;
  tone: Tone;
  /** Statuschipet: "Connected" / "Paused" / "Expired" / "Not connected". */
  chip: string;
  lead: string;
  /** Två celler (Connected · Last import) — bara när kopplingen lever. Ingen "Next sync": rundor kommer via webhooks, och reservkontrollens tid säger inget om när de kommer. */
  meta: StravaMetaCell[];
  /** Det som importeras — bara när kopplingen lever. */
  rules: string[];
  /** Förnyelsen som skedde eller misslyckades i samband med statusläsningen. */
  renewal: { tone: Tone; text: string } | null;
  /** Bara när synken är pausad: vad som ändå gäller under pausen (och sedan när den började). */
  note: string | null;
}

/** Kopplingen lever (kopplad och inte utgången): kortet visar celler och samtycket som information, oavsett om synken är pausad. */
export const isLiveConnection = (state: StravaCardState): boolean => state === 'connected' || state === 'paused';

export const STRAVA_IMPORT_RULES = [
  `Your Strava runs are imported as you save them, with a backup check every ${stravaPollIntervalLabel()}.`,
  `Only running activities are imported (${STRAVA_RUN_TYPES_LABEL}), treadmill runs included.`,
  'Duplicate activities are filtered out.',
];

const msUntil = (iso: string, now: Date): number | null => {
  const ms = new Date(iso).getTime() - now.getTime();
  return Number.isNaN(ms) ? null : ms;
};

function connectedOn(date: string | undefined): string {
  const day = date?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatLongDate(day) : 'Unknown';
}

/** När användarens senaste Strava-runda kom in (webhook eller polling), ur GET /strava/status. Aldrig en gissning om servern. */
function lastImportText(status: StravaStatusInput, now: Date): string {
  const ms = status.last_import_at ? msUntil(status.last_import_at, now) : null;
  return ms === null ? 'No runs imported yet' : formatAgo(Math.max(0, -ms));
}

/** Pausens början som kalenderdag i Stockholm (paused_at är en ISO-tid med +00:00); saknas eller är den oläsbar utelämnas datumet. */
function pausedNote(pausedAt: string | null | undefined): string {
  const at = pausedAt ? new Date(pausedAt) : null;
  return at && !Number.isNaN(at.getTime()) ? `Paused since ${formatLongDate(stockholmDay(at))}. ${STILL_REMOVED_SENTENCE}` : STILL_REMOVED_SENTENCE;
}

export function buildStravaCard(status: StravaStatusInput, now: Date): StravaCardView {
  const renewal = status.auto_refreshed
    ? { tone: 'up' as const, text: 'Your Strava connection was renewed automatically.' }
    : status.refresh_failed
      ? { tone: 'down' as const, text: 'The Strava token could not be renewed automatically. Reconnect to keep syncing.' }
      : null;

  if (!status.connected) {
    return {
      state: 'disconnected', tone: 'muted', chip: 'Not connected', renewal, meta: [], rules: [], note: null,
      lead: 'Your Strava account is not connected. Connect it to import your runs.',
    };
  }
  if (status.expired) {
    return {
      state: 'expired', tone: 'down', chip: 'Expired', renewal, meta: [], rules: [], note: null,
      lead: 'The connection expired, so new runs are not syncing. Reconnect to pick up where you left off.',
    };
  }
  const lastTone: Tone = status.last_import_at ? 'up' : 'muted';
  if (status.sync_paused === true) {
    return {
      state: 'paused', tone: 'paused', chip: 'Paused', renewal, rules: [], note: pausedNote(status.paused_at),
      lead: 'Sync is paused. Your connection and runs are still here, but no new runs are fetched until you turn sync back on.',
      meta: [
        { key: 'connected', label: 'Connected', value: connectedOn(status.connection_date), tone: 'up' },
        { key: 'last', label: 'Last import', value: lastImportText(status, now), tone: 'muted' },
      ],
    };
  }
  return {
    state: 'connected', tone: 'up', chip: 'Connected', renewal, rules: STRAVA_IMPORT_RULES, note: null,
    lead: 'Your Strava connection is active and tokens are renewed as needed.',
    meta: [
      { key: 'connected', label: 'Connected', value: connectedOn(status.connection_date), tone: 'up' },
      { key: 'last', label: 'Last import', value: lastImportText(status, now), tone: lastTone },
    ],
  };
}

/**
 * Antalet Stravarundor appen själv känner till (`source === 'strava'`). `undefined` = rundorna är inte lästa (laddar eller felade): då `null`, aldrig 0,
 * så att en siffra på en knapp som raderar något aldrig är en gissning.
 */
export function countStravaRuns(runs: readonly Pick<Run, 'source'>[] | undefined): number | null {
  return runs ? runs.filter((run) => run.source === 'strava').length : null;
}

// ─── Lösenordsbyte ────────────────────────────────────────────────────────────

export interface PasswordForm {
  current: string;
  next: string;
  confirm: string;
}

export const EMPTY_PASSWORD_FORM: PasswordForm = { current: '', next: '', confirm: '' };

export type PasswordErrors = Partial<Record<keyof PasswordForm, string>>;

/** Tomt objekt = giltigt. Felen hör till ett fält var, så formuläret kan peka på dem. */
export function validatePasswordChange(form: PasswordForm): PasswordErrors {
  const errors: PasswordErrors = {};
  if (!form.current) errors.current = 'Enter your current password';
  if (!form.next) errors.next = 'Enter a new password';
  else {
    const tooShort = validatePassword(form.next);
    if (tooShort) errors.next = tooShort;
  }
  if (!form.confirm) errors.confirm = 'Repeat the new password';
  else if (form.next && form.confirm !== form.next) errors.confirm = 'The new passwords do not match';
  return errors;
}

/** Ordningen fokus går i vid inlämning. */
export const PASSWORD_FIELD_ORDER = ['current', 'next', 'confirm'] as const;
