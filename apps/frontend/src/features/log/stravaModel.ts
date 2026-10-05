import { formatAgo, formatIn } from './logFormat';

// Strava-banderollen överst på mobilens formulär: kopplad/inte kopplad + senaste och nästa synk. Ren logik.

export interface StravaStatusInput {
  connected: boolean;
  expired: boolean;
}

export interface StravaSyncInput {
  last_sync_attempt: string | null;
  next_sync_estimated: string | null;
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

/** "Last sync 32 min ago · next in 28 min". Saknas båda: en neutral rad, aldrig en tom. */
export function syncLine(sync: StravaSyncInput | undefined, now: Date): string {
  const parts: string[] = [];
  const lastMs = sync?.last_sync_attempt ? msBetween(sync.last_sync_attempt, now) : null;
  const nextMs = sync?.next_sync_estimated ? msBetween(sync.next_sync_estimated, now) : null;
  if (lastMs !== null) parts.push(`Last sync ${formatAgo(Math.max(0, -lastMs))}`);
  if (nextMs !== null) parts.push(`next ${formatIn(nextMs)}`);
  return parts.length > 0 ? parts.join(' · ') : 'Your runs sync automatically';
}

/** null medan statusen laddas eller inte gick att läsa — banderollen är sidoinformation och får inte ta plats som fel. */
export function buildStravaBanner(
  status: StravaStatusInput | undefined,
  sync: StravaSyncInput | undefined,
  now: Date,
): StravaBanner | null {
  if (!status) return null;
  if (!status.connected) {
    return { tone: 'muted', title: 'Strava not connected', text: 'Connect it and your runs appear by themselves', needsSettings: true };
  }
  if (status.expired) {
    return { tone: 'down', title: 'Strava needs reconnecting', text: 'The connection expired, so new runs are not syncing', needsSettings: true };
  }
  return { tone: 'up', title: 'Strava connected', text: syncLine(sync, now), needsSettings: false };
}
