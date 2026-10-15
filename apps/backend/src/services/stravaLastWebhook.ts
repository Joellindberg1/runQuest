// When the newest Strava webhook event was received, for GET /strava/last-sync: Settings and admin can see that webhooks are alive
// (ADR 010). Global like the rest of last-sync, and ONLY a timestamp: no owner, object or count leaves this module.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';

/**
 * strava_webhook_events has no index on received_at (migration 046 indexes status/next_attempt_at and owner/status) and the app's
 * clients ask for last-sync on every focus and every five minutes, so the answer is kept for a minute: at most one scan a minute
 * however many clients ask. A webhook that arrives shows up within that minute.
 */
export const LAST_WEBHOOK_CACHE_MS = 60_000;

let cached: { value: string | null; readAt: number } | null = null;

/** For tests: forget the remembered answer. */
export function resetLastWebhookCache(): void {
  cached = null;
}

/**
 * The received_at of the newest stored event as an ISO string, or null when there is none. A failed read never throws and is not
 * remembered: the answer is null (the status as a whole is still worth giving) and the next request asks again. The warning carries
 * the error code only.
 */
export async function getLastWebhookAt(): Promise<string | null> {
  const now = Date.now();
  if (cached && now - cached.readAt < LAST_WEBHOOK_CACHE_MS) return cached.value;

  try {
    const { data, error } = await getSupabaseClient()
      .from('strava_webhook_events')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1);
    if (error) {
      logger.warn(`⚠️ Could not read the time of the last Strava webhook (${errorCode(error)})`);
      return null;
    }
    const receivedAt: unknown = data?.[0]?.received_at;
    const value = typeof receivedAt === 'string' ? receivedAt : null;
    cached = { value, readAt: now };
    return value;
  } catch (error) {
    logger.warn(`⚠️ Could not read the time of the last Strava webhook (${errorCode(error)})`);
    return null;
  }
}
