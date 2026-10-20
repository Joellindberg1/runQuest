// The handler for activity:create (ADR 010 decisions 1, 7.1, 7.5 and 8). The event is only a signal: the activity is always fetched
// from Strava with the user's own token, and decideAction (the one decision table) says what to do with the answer.
//
//   1. the connection (strava_tokens): none -> ignored_unknown_owner; a paused user -> ignored_paused, with NO Strava call;
//   2. the token (renewed when expired), the run that already has this id, ONE detail call;
//   3. decideAction: insert (a visible run, none stored yet, not from before the connection day) -> imported;
//      a 404, a private activity or a non-run -> not_a_run; before the connection day or already stored -> noop;
//      401 -> renew the token once and fetch again; 429 -> wait; 5xx and network -> retry.
//
// The handler writes the run and nothing else. The recalculation, weather and event qualification are the worker's, in the
// polling's order, once per batch (stravaWebhookWorker.ts): the handler only reports the run it inserted (`importedRuns`).
// It never sets a status, never calls syncUserStravaActivities (the worker holds the user lock) and never wakes the worker.
import { logger } from '../../../utils/logger.js';
import { stravaKm, stravaRunDay } from '../../../utils/stravaActivity.js';
import { stravaRateBudget, type StravaRateBudget } from '../../stravaRateBudget.js';
import { insertStravaRun } from '../../stravaImport.js';
import { resultForTokenFailure, type WebhookHandler, type WebhookHandlerContext, type WebhookHandlerResult } from '../../stravaWebhookWorker.js';
import { decideAction, decideBeforeFetch, type ActionDecision, type StravaActivityDetail, type StravaResponse } from '../decideAction.js';
import type { StravaConnection } from '../ports.js';

export interface ActivityCreateDeps {
  /** Tells the 15-minute limit from the daily one after a 429. Default: the app's one budget. */
  budget?: Pick<StravaRateBudget, 'usage'>;
}

const retry = (error: string): WebhookHandlerResult => ({ status: 'retry', error });

export function createActivityCreateHandler(deps: ActivityCreateDeps = {}): WebhookHandler {
  const budget = deps.budget ?? stravaRateBudget;

  /** A 429 is a wait, not a failure. The daily limit is the one hit only when the budget has seen the daily usage at its limit. */
  function waitKind(): 'rate_limit' | 'daily_limit' {
    const usage = budget.usage();
    return usage.daily >= usage.limitDaily ? 'daily_limit' : 'rate_limit';
  }

  async function insert(ctx: WebhookHandlerContext, decision: Extract<ActionDecision, { action: 'insert' }>, response: StravaResponse): Promise<WebhookHandlerResult> {
    const activity: StravaActivityDetail | null | undefined = response.kind === 'http' ? response.activity : null;
    if (!activity) return retry('invalid_response');

    // The detail we already hold supplies the identity and the extended fields: no second Strava call.
    const inserted = await insertStravaRun(ctx.userId, activity, activity);
    if (inserted.status === 'exists') {
      // Lost a race with the polling (23505 on the external id index): the row is there, so this is the "exists" case. The one who
      // inserted it recalculates and qualifies. If the row is gone again, a retry sorts it out.
      const stored = await ctx.runs.findRun(ctx.userId, String(ctx.event.object_id));
      return stored ? { status: 'done', outcome: 'noop', recalculateFrom: null } : retry('duplicate_row_missing');
    }

    return {
      status: 'done',
      outcome: decision.outcome,
      recalculateFrom: decision.recalculateFrom,
      // The polling's arguments to checkEventQualification: the date and distance of the Strava activity.
      importedRuns: [{ ...inserted.run, date: stravaRunDay(activity), distance_km: stravaKm(activity.distance) }],
    };
  }

  return async function activityCreate(ctx) {
    const { userId, event } = ctx;

    // The pause flag and the connection day come first: a paused user's create must not cost a Strava call, not even a token renewal.
    let connection: StravaConnection | null;
    try {
      connection = await ctx.runs.getConnection(userId);
    } catch {
      return retry('connection_read_failed'); // never "not paused"
    }
    if (!connection) return resultForTokenFailure('not_connected');

    const plan = decideBeforeFetch({ aspect_type: 'create', paused: connection.syncPaused });
    if (plan.action === 'skip') return { status: 'done', outcome: plan.outcome, recalculateFrom: null };

    const token = await ctx.strava.getAccessToken(userId);
    if (!token.ok) return resultForTokenFailure(token.reason);
    let accessToken = token.accessToken;

    // Whatever its source: a manual run on the same id must be seen too (decideAction leaves it alone).
    const existingRun = await ctx.runs.findRun(userId, String(event.object_id));

    let tokenRefreshed = false;
    let renewals = 0;
    for (;;) {
      const response = await ctx.strava.fetchActivity(accessToken, event.object_id);
      const decision = decideAction({
        aspect_type: 'create',
        paused: false,
        response,
        existingRun,
        attempts: ctx.attempts,
        tokenRefreshed,
        connectionDate: connection.connectionDate,
      });

      switch (decision.action) {
        case 'refresh_token': {
          // 401: renew once and fetch again (ADR 010 7.1). A second 401 comes back from decideAction as a retry; the handler holds
          // its own limit too (one renewal per event), so a decision that kept asking could never loop or burn Strava calls.
          if (renewals >= 1) return retry('unauthorized');
          renewals += 1;
          const renewed = await ctx.strava.refreshAccessToken(userId);
          if (!renewed.ok) return resultForTokenFailure(renewed.reason);
          accessToken = renewed.accessToken;
          tokenRefreshed = true;
          continue;
        }
        case 'insert':
          return insert(ctx, decision, response);
        case 'none':
          return { status: 'done', outcome: decision.outcome, recalculateFrom: decision.recalculateFrom, recalculateUnknown: decision.recalculateUnknown };
        case 'update':
        case 'remove':
          // The run exists and Strava differs (or no longer shows a run). A create event does not own that: the update and delete
          // events for the activity do, through their own handlers, and each reads the then-current Strava state.
          logger.info(`ℹ️ Strava webhook: event ${event.id} (activity create) found a stored run that differs from Strava; left to the update and delete handlers`);
          return { status: 'done', outcome: 'noop', recalculateFrom: null };
        case 'wait':
          return { status: 'wait', kind: waitKind() };
        case 'retry':
          return retry(decision.reason);
      }
    }
  };
}
