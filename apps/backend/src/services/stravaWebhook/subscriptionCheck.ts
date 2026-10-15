// The nightly check of the Strava push subscription (ADR 010 decision 11, alarm b). A silent subscription produces no `dead` rows, so
// without this check deletions would stop arriving and nobody would notice. One GET /push_subscriptions per night, compared with
// STRAVA_WEBHOOK_SUBSCRIPTION_ID and STRAVA_WEBHOOK_CALLBACK_URL. Scheduled by scheduler/stravaWebhookScheduler.ts.
//
// Logs, never the client secret or the verify token (ADR 010 decision 8.6): the list function reports a failure by status or error
// name only, and the callback url Strava returns is shown without its query string.
import { logger } from '../../utils/logger.js';
import { STRAVA_WEBHOOK_CALLBACK_URL } from './constants.js';
import { listStravaSubscriptions, type StravaSubscriptionRow } from './subscriptions.js';

/** The prefix of the alarm lines (decision 11); the same one the worker uses for a dead event. */
const ALARM = '🚨 KRITISKT: Strava-webhook';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SHOWN_CALLBACK_LENGTH = 200;

export type SubscriptionCheckOutcome =
  | 'ok'
  /** STRAVA_WEBHOOK_SUBSCRIPTION_ID is not set (yet): nothing to check, nothing sent. */
  | 'skipped'
  | 'missing_credentials'
  /** The call failed or its answer was unreadable. One failed night is not proof, so this is not an alarm. */
  | 'check_failed'
  | 'missing'
  | 'id_differs'
  | 'callback_differs';

/** The same rule as the webhook route's configuredSubscriptionId: a positive whole number, else "not configured". */
function configuredSubscriptionId(env: NodeJS.ProcessEnv): number | null {
  const raw = env.STRAVA_WEBHOOK_SUBSCRIPTION_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A callback url as it may be logged: origin and path, no query string or credentials, cut short. */
function shownCallback(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, MAX_SHOWN_CALLBACK_LENGTH);
  } catch {
    return '[not a url]';
  }
}

/**
 * One request, no retry, at most one alarm line per run. Returns what it found (the scheduler ignores it; the tests read it).
 * It is made not to throw, and the scheduler guards the call as well.
 */
export async function runStravaSubscriptionCheck(env: NodeJS.ProcessEnv = process.env): Promise<SubscriptionCheckOutcome> {
  const configuredId = configuredSubscriptionId(env);
  if (configuredId === null) {
    logger.info('ℹ️ Strava subscription check skipped: STRAVA_WEBHOOK_SUBSCRIPTION_ID is not set');
    return 'skipped';
  }
  const clientId = env.STRAVA_CLIENT_ID;
  const clientSecret = env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.error('❌ Cannot check the Strava subscription: missing client credentials (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET)');
    return 'missing_credentials';
  }

  const listed = await listStravaSubscriptions({ clientId, clientSecret, timeoutMs: REQUEST_TIMEOUT_MS });
  if (!listed.ok) {
    logger.warn(`⚠️ Strava subscription check could not be made (${listed.reason}); one failed night is not proof, it is tried again tomorrow night`);
    return 'check_failed';
  }

  if (listed.rows.length === 0) {
    logger.error(`${ALARM}: the subscription is missing. Strava lists none for this app (expected id ${configuredId}), so no events arrive and deletions will not be received.`);
    return 'missing';
  }
  const ours: StravaSubscriptionRow | undefined = listed.rows.find((row) => row.id === configuredId);
  if (!ours) {
    const listedIds = listed.rows.map((row) => row.id).join(', ');
    logger.error(`${ALARM}: the subscription id differs. STRAVA_WEBHOOK_SUBSCRIPTION_ID is ${configuredId} but Strava lists ${listedIds}, so events carry another id and are rejected.`);
    return 'id_differs';
  }
  if (ours.callback_url !== STRAVA_WEBHOOK_CALLBACK_URL) {
    logger.error(`${ALARM}: subscription ${configuredId} points at another callback url (${shownCallback(ours.callback_url)}, expected ${STRAVA_WEBHOOK_CALLBACK_URL}), so events go to the wrong place.`);
    return 'callback_differs';
  }

  logger.info(`✅ Strava subscription ok (id ${configuredId})`);
  return 'ok';
}
