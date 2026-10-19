// GET /push_subscriptions: the one parser of what Strava has subscribed for this app (ADR 010 decisions 2, 11 and 16). Shared by the
// subscription script (npm run strava:webhook) and the nightly check (subscriptionCheck.ts), so the fail-closed reading exists once.
//
// The request url carries client_secret in its query string (Strava takes the credentials there). So nothing from a failed request
// that could contain the url leaves this module: a fetch error is reported by its name only (undici puts the url in the message
// of some errors, and in the cause of others), and an error status by its number only (the body may echo the credentials).
import { stravaFetch } from '../stravaClient.js';

export const PUSH_SUBSCRIPTIONS_URL = 'https://www.strava.com/api/v3/push_subscriptions';

/** The fields of a Strava push subscription that the script and the check read. */
export interface StravaSubscriptionRow {
  id: number;
  callback_url: string;
  created_at?: string;
  updated_at?: string;
}

export interface ListStravaSubscriptionsInput {
  clientId: string;
  clientSecret: string;
}

/**
 * Fail-closed: an unreadable answer is a failure, never "no subscription". `reason` is safe to log (a status or an error name).
 * `unanswered`: the request got no answer (network error or timeout). `status`: the HTTP status of an error answer.
 */
export type ListStravaSubscriptionsResult =
  | { ok: true; rows: StravaSubscriptionRow[] }
  | { ok: false; reason: string; status?: number; unanswered?: true };

/** The name of a caught error, nothing else: not the message, not the cause, not the stack. Shared with the script, whose own requests fail the same way. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name.replace(/[^\w.:-]/g, '').slice(0, 40) || 'Error' : typeof error;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Always one request, no retry: the caller decides what a failure means. Goes through stravaFetch, so the rate budget counts it and its timeout (headers and body) applies. */
export async function listStravaSubscriptions({ clientId, clientSecret }: ListStravaSubscriptionsInput): Promise<ListStravaSubscriptionsResult> {
  const query = new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString();
  let response: Response;
  let body: unknown;
  try {
    response = await stravaFetch(`${PUSH_SUBSCRIPTIONS_URL}?${query}`, { method: 'GET' });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, status: response.status };
    body = await readJson(response);
  } catch (err) {
    return { ok: false, unanswered: true, reason: `request failed: ${errorName(err)}` };
  }

  if (!Array.isArray(body)) return { ok: false, reason: 'Strava answered with something other than a list of subscriptions' };
  const rows: StravaSubscriptionRow[] = [];
  for (const item of body) {
    const row = item as Partial<StravaSubscriptionRow> | null;
    if (!row || !Number.isSafeInteger(row.id) || (row.id as number) <= 0) {
      return { ok: false, reason: 'Strava listed a subscription without a valid id' };
    }
    rows.push({ id: row.id as number, callback_url: String(row.callback_url ?? ''), created_at: row.created_at, updated_at: row.updated_at });
  }
  return { ok: true, rows };
}
