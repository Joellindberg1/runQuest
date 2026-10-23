import { formatAgo } from '@/shared/utils/format';

// Strava-banderollen överst på mobilens formulär: kopplad/inte kopplad + när senaste rundan kom in (Last import, ingen nästa synk). Ren logik.

export interface StravaStatusInput {
  connected: boolean;
  expired: boolean;
  /** När användarens senaste Strava-runda kom in (webhook eller polling). */
  last_import_at?: string | null;
}

export interface StravaBanner {
  tone: 'up' | 'muted' | 'down';
  title: string;
  text: string;
  /** Sant när banderollen pekar vidare till Settings (koppla/koppla om). */
  needsSettings: boolean;
}

const msBetween = (iso: string, now: Date): number | null => {
  const ms = new Date(iso).getTime() - now.getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * "Last import 3 h ago": när användarens senaste Strava-runda kom in. Ingen "next": rundor kommer via webhooks, så reservkontrollens
 * tid säger inget om när de kommer. Har ingen runda kommit in än: en neutral rad, aldrig en tom.
 */
export function importLine(status: StravaStatusInput, now: Date): string {
  const lastMs = status.last_import_at ? msBetween(status.last_import_at, now) : null;
  return lastMs !== null ? `Last import ${formatAgo(Math.max(0, -lastMs))}` : 'Your runs sync automatically';
}

/** null medan statusen laddas eller inte gick att läsa — banderollen är sidoinformation och får inte ta plats som fel. */
export function buildStravaBanner(
  status: StravaStatusInput | undefined,
  now: Date,
): StravaBanner | null {
  if (!status) return null;
  if (!status.connected) {
    return { tone: 'muted', title: 'Strava not connected', text: 'Connect it and your runs appear by themselves', needsSettings: true };
  }
  if (status.expired) {
    return { tone: 'down', title: 'Strava needs reconnecting', text: 'The connection expired, so new runs are not syncing', needsSettings: true };
  }
  return { tone: 'up', title: 'Strava connected', text: importLine(status, now), needsSettings: false };
}
