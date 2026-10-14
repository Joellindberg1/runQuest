// The handler for activity:delete (ADR 010 decisions 7.1, 7.2 and 8). The event is only a signal and nobody signs it: a forged delete
// must never delete anything, so the activity is ALWAYS fetched from Strava with the user's own token, and decideAction (the one
// decision table, shared with create and update) says what the answer means.
//
//   1. the connection (strava_tokens): none -> ignored_unknown_owner. The pause flag is read but does not matter: a delete is
//      processed for a paused user as for any other (decideBeforeFetch says "fetch" for it);
//   2. the token (renewed when expired), the run that already has this id (whatever its source), ONE detail call;
//   3. decideAction:
//        404                                  -> remove the user's Strava run, outcome `deleted`; no run -> `not_a_run`
//        200, a visible run                   -> `ignored_not_confirmed`, nothing is done (the forged-event case)
//        200, private or not a run            -> remove it (`removed_private` / `removed_not_running`)
//        401 -> renew the token once and fetch again; 429 -> wait; 5xx and network -> retry.
//
// The handler only DELETES, through RunStore.removeStravaRun (services/stravaRemoval.ts, the one deletion query, `source = 'strava'`
// so a manual run is never touched) and reports the deleted run's date as `recalculateFrom`. The recalculation (ONE
// reprocessRunsFromDate from the oldest date, ONE calculateUserTotals -> evaluateBadges and titles, a retry when the reprocess fails)
// is the worker's, per user and batch. See the split described at the top of stravaRemoval.ts. A retry after a failed attempt that
// finds the run already gone reports `recalculateUnknown`; the worker then recalculates from the user's earliest run.
//
// No Strava id, coordinate or title is logged here (ADR 010 8.6).
import { logger } from '../../../utils/logger.js';
import { stravaRateBudget, type StravaRateBudget } from '../../stravaRateBudget.js';
import { resultForTokenFailure, type WebhookHandler, type WebhookHandlerResult } from '../../stravaWebhookWorker.js';
import { decideAction, decideBeforeFetch } from '../decideAction.js';
import type { StravaConnection } from '../ports.js';

export interface ActivityDeleteDeps {
  /** Tells the 15-minute limit from the daily one after a 429. Default: the app's one budget. */
  budget?: Pick<StravaRateBudget, 'usage'>;
}

const retry = (error: string): WebhookHandlerResult => ({ status: 'retry', error });

/** Dates are 'YYYY-MM-DD', so the string order is the date order. */
function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

export function createActivityDeleteHandler(deps: ActivityDeleteDeps = {}): WebhookHandler {
  const budget = deps.budget ?? stravaRateBudget;

  /** A 429 is a wait, not a failure. The daily limit is the one hit only when the budget has seen the daily usage at its limit. */
  function waitKind(): 'rate_limit' | 'daily_limit' {
    const usage = budget.usage();
    return usage.daily >= usage.limitDaily ? 'daily_limit' : 'rate_limit';
  }

  return async function activityDelete(ctx) {
    const { userId, event } = ctx;

    let connection: StravaConnection | null;
    try {
      connection = await ctx.runs.getConnection(userId);
    } catch {
      return retry('connection_read_failed');
    }
    if (!connection) return resultForTokenFailure('not_connected');

    // A paused user's delete is fetched and processed like any other (ADR 010 7.5.3); the plan never skips it.
    const plan = decideBeforeFetch({ aspect_type: 'delete', paused: connection.syncPaused });
    if (plan.action === 'skip') return { status: 'done', outcome: plan.outcome, recalculateFrom: null };

    const token = await ctx.strava.getAccessToken(userId);
    if (!token.ok) return resultForTokenFailure(token.reason);
    let accessToken = token.accessToken;

    // Whatever its source: a manual run on the same id must be seen too (decideAction never removes it).
    const externalId = String(event.object_id);
    const existingRun = await ctx.runs.findRun(userId, externalId);

    let tokenRefreshed = false;
    let renewals = 0;
    for (;;) {
      const response = await ctx.strava.fetchActivity(accessToken, event.object_id);
      const decision = decideAction({
        aspect_type: 'delete',
        paused: connection.syncPaused,
        response,
        existingRun,
        attempts: ctx.attempts,
        tokenRefreshed,
        connectionDate: connection.connectionDate,
      });

      switch (decision.action) {
        case 'refresh_token': {
          // 401: renew once and fetch again (ADR 010 7.1). The handler holds its own limit (one renewal per event) as well, so a
          // decision that kept asking could never loop or burn Strava calls.
          if (renewals >= 1) return retry('unauthorized');
          renewals += 1;
          const renewed = await ctx.strava.refreshAccessToken(userId);
          if (!renewed.ok) return resultForTokenFailure(renewed.reason);
          accessToken = renewed.accessToken;
          tokenRefreshed = true;
          continue;
        }
        case 'remove': {
          // A database error throws: the worker records a failed attempt with the error code, and nothing has been recalculated.
          const removal = await ctx.runs.removeStravaRun(userId, externalId);
          // The row may be gone already (the polling or another event got there first): the decision's date still bounds the
          // recalculation, which is idempotent. When both exist, the earlier one is the safe start.
          return {
            status: 'done',
            outcome: decision.outcome,
            recalculateFrom: earliest(removal.date, decision.recalculateFrom),
            recalculateUnknown: decision.recalculateUnknown,
          };
        }
        case 'none':
          return { status: 'done', outcome: decision.outcome, recalculateFrom: decision.recalculateFrom, recalculateUnknown: decision.recalculateUnknown };
        case 'insert':
        case 'update':
          // decideAction answers `ignored_not_confirmed` to any delete event that meets a visible run, so these are not reachable
          // today. Should the table change, a delete event still writes nothing: the create and update events own those.
          logger.warn(`⚠️ Strava webhook: event ${event.id} (activity delete) got a ${decision.action} decision; nothing was written`);
          return { status: 'done', outcome: 'ignored_not_confirmed', recalculateFrom: null };
        case 'wait':
          return { status: 'wait', kind: waitKind() };
        case 'retry':
          return retry(decision.reason);
      }
    }
  };
}
