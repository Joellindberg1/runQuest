import { formatAgo, formatIn, formatLongDate } from '@/features/log/logFormat';
import { validatePassword } from '@/shared/utils/validation';
import { STRAVA_RUN_TYPES_LABEL, STRAVA_SYNC_MINUTES } from '@/features/playbook/playbookFacts';

// Settings-skärmens vymodeller: Strava-kortet ur /strava/status + /strava/last-sync, den senaste synken som en rad, och
// lösenordsbytets validering (samma regler som tidigare: alla fält, lika lösenord, minst 6 tecken). Ren logik — ingen DOM.

export interface StravaStatusInput {
  connected: boolean;
  expired: boolean;
  connection_date?: string;
  auto_refreshed?: boolean;
  refresh_failed?: boolean;
}

export interface StravaSyncInput {
  last_sync_attempt: string | null;
  last_sync_status: string;
  next_sync_estimated: string | null;
  new_runs?: number;
}

export type StravaCardState = 'connected' | 'expired' | 'disconnected';
export type Tone = 'up' | 'down' | 'muted';

export interface StravaMetaCell {
  key: 'connected' | 'last' | 'next';
  label: string;
  value: string;
  tone: Tone;
}

export interface StravaCardView {
  state: StravaCardState;
  tone: Tone;
  /** Statuschipet: "Connected" / "Expired" / "Not connected". */
  chip: string;
  lead: string;
  /** Tre celler (Connected · Last sync · Next sync) — bara när kopplingen lever. */
  meta: StravaMetaCell[];
  /** Det som importeras — bara när kopplingen lever. */
  rules: string[];
  /** Förnyelsen som skedde eller misslyckades i samband med statusläsningen. */
  renewal: { tone: Tone; text: string } | null;
}

export const STRAVA_IMPORT_RULES = [
  `Your Strava runs are imported automatically every ${STRAVA_SYNC_MINUTES} minutes.`,
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

function lastSyncText(sync: StravaSyncInput | undefined, now: Date): string {
  const ms = sync?.last_sync_attempt ? msUntil(sync.last_sync_attempt, now) : null;
  return ms === null ? 'No server sync yet' : formatAgo(Math.max(0, -ms));
}

function nextSyncText(sync: StravaSyncInput | undefined, now: Date): string {
  const ms = sync?.next_sync_estimated ? msUntil(sync.next_sync_estimated, now) : null;
  if (ms === null) return 'Unknown';
  return ms < 0 ? 'Overdue' : formatIn(ms);
}

export function buildStravaCard(status: StravaStatusInput, sync: StravaSyncInput | undefined, now: Date): StravaCardView {
  const renewal = status.auto_refreshed
    ? { tone: 'up' as const, text: 'Your Strava connection was renewed automatically.' }
    : status.refresh_failed
      ? { tone: 'down' as const, text: 'The Strava token could not be renewed automatically. Reconnect to keep syncing.' }
      : null;

  if (!status.connected) {
    return {
      state: 'disconnected', tone: 'muted', chip: 'Not connected', renewal, meta: [], rules: [],
      lead: 'Your Strava account is not connected. Connect it to import your runs.',
    };
  }
  if (status.expired) {
    return {
      state: 'expired', tone: 'down', chip: 'Expired', renewal, meta: [], rules: [],
      lead: 'The connection expired, so new runs are not syncing. Reconnect to pick up where you left off.',
    };
  }
  const lastTone: Tone = sync?.last_sync_attempt ? 'up' : 'muted';
  return {
    state: 'connected', tone: 'up', chip: 'Connected', renewal, rules: STRAVA_IMPORT_RULES,
    lead: 'Your Strava connection is active and tokens are renewed as needed.',
    meta: [
      { key: 'connected', label: 'Connected', value: connectedOn(status.connection_date), tone: 'up' },
      { key: 'last', label: 'Last sync', value: lastSyncText(sync, now), tone: lastTone },
      { key: 'next', label: 'Next sync', value: nextSyncText(sync, now), tone: 'muted' },
    ],
  };
}

export interface SyncRow {
  /** "09:31" i webbläsarens tid (samma som skalets klockor). */
  time: string;
  result: string;
  tone: Tone;
}

const FAILED = /fail|error/i;

/** Den senaste serversynken som en rad; null när ingen körts sedan servern startade. */
export function buildSyncRow(sync: StravaSyncInput | undefined): SyncRow | null {
  if (!sync?.last_sync_attempt) return null;
  const at = new Date(sync.last_sync_attempt);
  if (Number.isNaN(at.getTime())) return null;
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (FAILED.test(sync.last_sync_status)) return { time, result: 'sync failed', tone: 'down' };
  const added = sync.new_runs ?? 0;
  return added > 0
    ? { time, result: `${added} new ${added === 1 ? 'run' : 'runs'}`, tone: 'up' }
    : { time, result: 'no new activities', tone: 'muted' };
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
