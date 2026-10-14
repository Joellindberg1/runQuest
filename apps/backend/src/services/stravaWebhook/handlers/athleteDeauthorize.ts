// The handler for athlete:update (ADR 010 decisions 3.6, 7.4.3 and 8): the deauthorize event Strava sends when an athlete revokes
// the app, `updates: { authorized: "false" }`. Nobody signs the event, so a forged one must never delete anything: it is verified
// against Strava first, with the user's own token, and only a refusal from Strava is taken as confirmation.
//
//   0. `updates.authorized` is not "false" (any other value, no value, a malformed one) -> done / noop, nothing is read or called.
//      The string "false" is what Strava sends; the boolean false is tolerated. Nothing else (not "False", not 0) counts.
//   1. the connection (strava_tokens), read FIRST like in the other handlers: none -> ignored_unknown_owner (already removed, by
//      our own disconnect or by an earlier delivery). It throws on a database error, which is a retry, never an unknown owner.
//      The pause flag is read but does not matter: a paused user's deauthorize is processed like any other (7.5.3).
//   2. the token, then ONE GET /athlete:
//        401                                  -> confirmed, removeStravaConnection(user, { reason: 'deauthorized' })
//        200                                  -> ignored_not_confirmed (forged or stale), nothing is deleted
//        429                                  -> wait (the kind comes from the budget)
//        5xx, network error, any other status -> retry
//        token path says no_refresh_token     -> RETRY: nothing to renew with, so nothing to verify; ends in the worker's 48 h alarm
//        token path says refresh_failed       -> RETRY, not confirmed (see below)
//        token path says not_connected        -> ignored_unknown_owner, but only after the connection is read AGAIN and is gone
//
// refresh_failed is a retry on purpose. stravaClient reports every failure of the renewal under that one reason: a refresh token
// Strava rejected (400/401), but also a network error, a 5xx, a 429, missing credentials and a failed save of the new tokens. A
// forged event met by a network fault would then delete a user's runs, and the safe side of that is a delayed deletion: the event
// is retried until Strava answers, and the worker raises the 48 h alarm if it never does. Once stravaClient says "Strava rejected
// the refresh token" as its own reason (`refresh_rejected`, RUN-268), that reason confirms and removes like a 401 from /athlete.
// not_connected has the same weakness (a failed database read of the token row gives it too), hence the second getConnection.
//
// The handler runs inside the worker's withUserLock and takes no lock itself (the lock is not reentrant). removeStravaConnection
// does the whole removal, including its own recalculation, and never revokes (the authorisation is already gone): the handler
// therefore reports no `recalculateFrom`, and the worker does not recalculate a second time on a first try. On a retry the worker
// recalculates from the user's earliest run whatever the handler says (attempts >= 1); that is idempotent and accepted. A removal
// that fails (the database, a reprocess that throws, runs left over) is a retry with its code: the token row is still there, so
// the retry finds the user and the removal carries on.
//
// No token, athlete id, Strava id or response body is logged here (ADR 010 8.6); the removal logs our user id and codes.
import { errorCode } from '../../../utils/errorCode.js';
import { stravaRateBudget, type StravaRateBudget } from '../../stravaRateBudget.js';
import { removeStravaConnection } from '../../stravaConnection.js';
import { resultForTokenFailure, type WebhookHandler, type WebhookHandlerResult } from '../../stravaWebhookWorker.js';
import type { StravaConnection } from '../ports.js';

export interface AthleteDeauthorizeDeps {
  /** Tells the 15-minute limit from the daily one after a 429. Default: the app's one budget. */
  budget?: Pick<StravaRateBudget, 'usage'>;
}

const retry = (error: string): WebhookHandlerResult => ({ status: 'retry', error });

const REMOVED: WebhookHandlerResult = { status: 'done', outcome: 'deauthorized_runs_deleted', recalculateFrom: null };

/** Strava sends the string "false". The boolean is tolerated; everything else, however close, is not a deauthorize. */
function isDeauthorize(updates: unknown): boolean {
  if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) return false;
  const authorized = (updates as Record<string, unknown>).authorized;
  return authorized === 'false' || authorized === false;
}

export function createAthleteDeauthorizeHandler(deps: AthleteDeauthorizeDeps = {}): WebhookHandler {
  const budget = deps.budget ?? stravaRateBudget;

  /** A 429 is a wait, not a failure. The daily limit is the one hit only when the budget has seen the daily usage at its limit. */
  function waitKind(): 'rate_limit' | 'daily_limit' {
    const usage = budget.usage();
    return usage.daily >= usage.limitDaily ? 'daily_limit' : 'rate_limit';
  }

  /** Strava refused (or there was nothing to ask): run the one removal, with no revoke. A failure is a retry, the row is still there. */
  async function remove(userId: string): Promise<WebhookHandlerResult> {
    try {
      await removeStravaConnection(userId, { reason: 'deauthorized' });
    } catch (error) {
      return retry(`removal_failed:${errorCode(error)}`);
    }
    return REMOVED;
  }

  return async function athleteDeauthorize(ctx) {
    const { userId, event } = ctx;

    if (!isDeauthorize(event.updates)) return { status: 'done', outcome: 'noop', recalculateFrom: null };

    let connection: StravaConnection | null;
    try {
      connection = await ctx.runs.getConnection(userId);
    } catch {
      return retry('connection_read_failed');
    }
    if (!connection) return resultForTokenFailure('not_connected');

    const token = await ctx.strava.getAccessToken(userId);
    if (!token.ok) {
      // Neither can be verified against Strava, so neither confirms. Follow-up: stravaClient gets a `refresh_rejected` reason
      // (the token endpoint rejected the refresh token), and that one confirms and removes, next to the 401 below.
      if (token.reason === 'no_refresh_token' || token.reason === 'refresh_failed') return resultForTokenFailure(token.reason);
      // not_connected: the row was there a moment ago. Only a second read that finds it gone makes this an unknown owner; a row
      // that is still there (or a read that fails) means the token read failed, and that must not end the event as done.
      try {
        if ((await ctx.runs.getConnection(userId)) === null) return resultForTokenFailure('not_connected');
      } catch {
        return retry('token_read_failed');
      }
      return retry('token_read_failed');
    }

    const response = await ctx.strava.fetchAthlete(token.accessToken);
    if (response.kind === 'network_error') return retry('network_error');
    if (response.status === 401) return remove(userId);
    if (response.status === 200) return { status: 'done', outcome: 'ignored_not_confirmed', recalculateFrom: null };
    if (response.status === 429) return { status: 'wait', kind: waitKind() };
    return retry(response.status >= 500 ? 'server_error' : 'unexpected_status');
  };
}
