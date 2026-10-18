// The read behind GET /api/strava/webhook/health (ADR 010 decision 11): counters and two timestamps for the webhook queue, nothing
// else, plus the `token_encryption` block (ADR 013 decision 9: key ids and row counts, read through stravaTokenStore). No owner, object,
// user, token, ciphertext or key ever leaves this module, and no row is fetched except the two timestamps below (the token store reads
// its rows itself and returns counts).
//
// A read error is NOT swallowed. A health check that says 0 when the database is down lies, so any failed read throws and the route
// answers 500.
import { getSupabaseClient } from '../../config/database.js';
import { errorCode } from '../../utils/errorCode.js';
import { readTokenEncryptionHealth, type TokenEncryptionHealth } from '../stravaTokenStore.js';
import type { WebhookStatus } from './constants.js';

const EVENTS_TABLE = 'strava_webhook_events';
const TOKENS_TABLE = 'strava_tokens';

export interface WebhookHealth {
  subscription_configured: boolean;
  pending: number;
  processing: number;
  dead: number;
  /** Whole seconds since the oldest pending event was received, or null when nothing is pending. */
  oldest_pending_age_seconds: number | null;
  /** The newest processed_at (an event that ended dead counts too), as an ISO string, or null. */
  last_processed_at: string | null;
  /** Connections without a strava_athlete_id: webhook events for them cannot be matched to anyone. */
  unmapped_tokens: number;
  paused_users: number;
  /** Is the token key usable, which key ids, and the rows by form (ADR 013 decision 9). Counts and key ids only; see stravaTokenStore. */
  token_encryption: TokenEncryptionHealth;
}

/** A read that failed. Carries the database error's code only, never its message (it can quote row values). */
export class WebhookHealthReadError extends Error {
  constructor(readonly code: string) {
    super('Failed to read webhook health');
    this.name = 'WebhookHealthReadError';
  }
}

type Db = ReturnType<typeof getSupabaseClient>;
type DbResult = { data?: unknown; error?: { code?: string } | null; count?: number | null };

function unwrap(result: DbResult): DbResult {
  if (result.error) throw new WebhookHealthReadError(errorCode(result.error));
  return result;
}

function unwrapCount(result: DbResult): number {
  const { count } = unwrap(result);
  if (typeof count !== 'number') throw new WebhookHealthReadError('no_count');
  return count;
}

function unwrapTimestamp(result: DbResult, column: string): Date | null {
  const rows = unwrap(result).data;
  const value = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined)?.[column] : undefined;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const countStatus = async (db: Db, status: WebhookStatus): Promise<DbResult> =>
  db.from(EVENTS_TABLE).select('id', { count: 'exact', head: true }).eq('status', status);

/**
 * Seven small reads and the token store's one (the token_encryption block), no cache (an admin endpoint). `now` is read once so the age and anything else time-based agree.
 * strava_tokens has no id column (its key is user_id), so its counts select user_id.
 */
export async function readWebhookHealth(subscriptionConfigured: boolean, now: number = Date.now()): Promise<WebhookHealth> {
  const db = getSupabaseClient();
  const [pending, processing, dead, oldestPending, lastProcessed, unmapped, paused] = await Promise.all([
    countStatus(db, 'pending'),
    countStatus(db, 'processing'),
    countStatus(db, 'dead'),
    db.from(EVENTS_TABLE).select('received_at').eq('status', 'pending').order('received_at', { ascending: true }).limit(1),
    // Postgres sorts null first when descending, so the rows without a processed_at are left out before the ordering.
    db.from(EVENTS_TABLE).select('processed_at').not('processed_at', 'is', null).order('processed_at', { ascending: false }).limit(1),
    db.from(TOKENS_TABLE).select('user_id', { count: 'exact', head: true }).is('strava_athlete_id', null),
    db.from(TOKENS_TABLE).select('user_id', { count: 'exact', head: true }).eq('sync_paused', true),
  ]);

  // The token columns are the store's alone (CI guard rule 11), so the token_encryption counts come from it. A failed read is a failed
  // health like the others, with the error's code only.
  let tokenEncryption: TokenEncryptionHealth;
  try {
    tokenEncryption = await readTokenEncryptionHealth();
  } catch (error) {
    throw new WebhookHealthReadError(errorCode(error));
  }

  const oldest = unwrapTimestamp(oldestPending, 'received_at');
  const lastProcessedAt = unwrapTimestamp(lastProcessed, 'processed_at');
  return {
    subscription_configured: subscriptionConfigured,
    pending: unwrapCount(pending),
    processing: unwrapCount(processing),
    dead: unwrapCount(dead),
    // A received_at ahead of the clock (skew) counts as 0, never as a negative age.
    oldest_pending_age_seconds: oldest ? Math.max(0, Math.floor((now - oldest.getTime()) / 1000)) : null,
    last_processed_at: lastProcessedAt ? lastProcessedAt.toISOString() : null,
    unmapped_tokens: unwrapCount(unmapped),
    paused_users: unwrapCount(paused),
    token_encryption: tokenEncryption,
  };
}
