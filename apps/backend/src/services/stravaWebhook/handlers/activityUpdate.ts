// The handler for activity:update (ADR 010 decisions 1, 7.1, 7.3, 7.5 and 8). The event is only a signal (Strava names what changed, a
// title or the private flag, but nobody signs it): the activity is ALWAYS fetched from Strava with the user's own token, and
// decideAction (the one decision table, shared with create and delete) says what the answer means for the database.
//
//   1. the connection (strava_tokens): none -> ignored_unknown_owner. The pause flag is read but does not stop the fetch: whether
//      the activity went private, changed type or is gone decides whether the run goes, paused or not;
//   2. the token (renewed when expired), the run that already has this id (whatever its source), ONE detail call;
//   3. decideAction:
//        a visible run, no run stored        -> insert, outcome `imported` (as create), unless the activity started before the
//                                               user's connection day (owner decision 2026-10-14: then `noop`, nothing imported)
//        a visible run, the run stored       -> `updated` with the columns that differ (date, distance, the extended fields), or
//                                               `noop` when nothing differs (a title change, an update delivered twice)
//        a visible run, a paused user        -> `ignored_paused`, nothing is written
//        private or not a run (type change)  -> remove the run (`removed_private` / `removed_not_running`); 404 -> `deleted`
//        401 -> renew the token once and fetch again; 429 -> wait; 5xx and network -> retry.
//
// What the handler writes, and what it leaves to the worker:
//   - an update goes through RunStore.updateStravaRun: Strava's columns only, never an XP or streak column (the adapter refuses a
//     patch that contains one), `source = 'strava'` only. Weather: a changed start_time or start location clears the run_weather row
//     (decision.clearWeather); WeatherService.backfillMissingWeather, which the scheduler runs after the backup sync, fetches it
//     again from the new time and place. The handler does not fetch weather itself.
//   - a removal goes through RunStore.removeStravaRun (services/stravaRemoval.ts, the one deletion query).
//   - an insert uses the detail we hold (insertStravaRun): no second Strava call.
//   - the recalculation is the worker's: ONE reprocessRunsFromDate from the earliest `recalculateFrom` and ONE calculateUserTotals
//     per user and batch. An update reports the earlier of the old and the new date, so a run moved in either direction is covered;
//     every update recomputes (the extended fields feed titles and badges through calculateUserTotals), a `noop` does not.
//   - event qualification runs only for a run this event INSERTED (`importedRuns`, as create). An updated run is never qualified
//     again and an entry it already earned is never taken back: the handler does not touch event_entries at all.
//
// No Strava id, coordinate or title is logged here (ADR 010 8.6): the handler has no log line that carries them.
import { stravaKm, stravaRunDay } from '../../../utils/stravaActivity.js';
import { stravaRateBudget, type StravaRateBudget } from '../../stravaRateBudget.js';
import { insertStravaRun } from '../../stravaImport.js';
import { resultForTokenFailure, type WebhookHandler, type WebhookHandlerContext, type WebhookHandlerResult } from '../../stravaWebhookWorker.js';
import { decideAction, decideBeforeFetch, type ActionDecision, type StravaActivityDetail, type StravaResponse } from '../decideAction.js';
import type { StravaConnection } from '../ports.js';

export interface ActivityUpdateDeps {
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

export function createActivityUpdateHandler(deps: ActivityUpdateDeps = {}): WebhookHandler {
  const budget = deps.budget ?? stravaRateBudget;

  /** A 429 is a wait, not a failure. The daily limit is the one hit only when the budget has seen the daily usage at its limit. */
  function waitKind(): 'rate_limit' | 'daily_limit' {
    const usage = budget.usage();
    return usage.daily >= usage.limitDaily ? 'daily_limit' : 'rate_limit';
  }

  /** No run stored and Strava shows a visible run again (public again, or an activity we never had): imported as create does. */
  async function insert(ctx: WebhookHandlerContext, decision: Extract<ActionDecision, { action: 'insert' }>, response: StravaResponse): Promise<WebhookHandlerResult> {
    const activity: StravaActivityDetail | null | undefined = response.kind === 'http' ? response.activity : null;
    if (!activity) return retry('invalid_response');

    // The detail we already hold supplies the identity and the extended fields: no second Strava call.
    const inserted = await insertStravaRun(ctx.userId, activity, activity);
    if (inserted.status === 'exists') {
      // Lost a race on the external id index: the row is there, so this is the "exists" case, and the one who inserted it
      // recalculates and qualifies. If the row is gone again, a retry sorts it out.
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

  return async function activityUpdate(ctx) {
    const { userId, event } = ctx;

    let connection: StravaConnection | null;
    try {
      connection = await ctx.runs.getConnection(userId);
    } catch {
      return retry('connection_read_failed'); // never "not paused"
    }
    if (!connection) return resultForTokenFailure('not_connected');

    // An update is always fetched, paused or not: a private flag, a type change or a deletion must reach the run (ADR 010 7.5.3).
    const plan = decideBeforeFetch({ aspect_type: 'update', paused: connection.syncPaused });
    if (plan.action === 'skip') return { status: 'done', outcome: plan.outcome, recalculateFrom: null };

    const token = await ctx.strava.getAccessToken(userId);
    if (!token.ok) return resultForTokenFailure(token.reason);
    let accessToken = token.accessToken;

    // Whatever its source: a manual run on the same id must be seen too (decideAction never changes or removes it).
    const externalId = String(event.object_id);
    const existingRun = await ctx.runs.findRun(userId, externalId);

    let tokenRefreshed = false;
    let renewals = 0;
    for (;;) {
      const response = await ctx.strava.fetchActivity(accessToken, event.object_id);
      const decision = decideAction({
        aspect_type: 'update',
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
        case 'update': {
          // A database error throws: the worker records a failed attempt with the error code and nothing is recalculated. A patch
          // with a column an update may not write (the adapter's guard) throws too, and is never written.
          const written = await ctx.runs.updateStravaRun(userId, externalId, decision.changes, { clearWeather: decision.clearWeather });
          // The run was there when we read it and is gone now (another writer): nothing was written; a retry meets the new state.
          if (!written.updated) return retry('run_missing_for_update');
          return {
            status: 'done',
            outcome: decision.outcome,
            // The decision already holds the earlier of the old and new date; the date the row had when it was written bounds it too.
            recalculateFrom: earliest(written.previousDate, decision.recalculateFrom),
            recalculateUnknown: decision.recalculateUnknown,
          };
        }
        case 'insert':
          return insert(ctx, decision, response);
        case 'remove': {
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
        case 'wait':
          return { status: 'wait', kind: waitKind() };
        case 'retry':
          return retry(decision.reason);
      }
    }
  };
}
