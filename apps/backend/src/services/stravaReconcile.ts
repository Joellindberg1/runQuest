/**
 * The nightly reconcile of Strava runs against Strava (ADR 010 decision 13, D12): the safety net under the webhooks. A webhook that was
 * never delivered (or thrown away in the gap before the subscription id was set) leaves a deleted activity alive here, and Strava
 * sends no event at all when only the distance or the date of an activity changes. Each night this compares, for every connected user,
 * the runs stored here with what Strava has, and fixes what differs. A PAUSED user gets the removals only (ADR 010 7.5.3: a pause stops
 * imports and updates, never the deletion rules): the activity update handler writes nothing but a removal for a paused user.
 *
 * ── HOW A NIGHT GOES (per user) ─────────────────────────────────────────────────────────────────────────────────────────────
 *   1. A token (getValidAccessToken). No token, no night for that user: nothing is listed, nothing is deleted.
 *   2. The user's stored Strava runs, and Strava's activity list for the window (RECONCILE_WINDOW_DAYS), all pages. A list that fails
 *      or may be cut short ends the night for that user in the same way: what a broken list does not show proves nothing.
 *   3. plan.ts sorts the runs: `changed` (listed, but another date or distance, or no longer a run), `missing` (inside the window and
 *      not listed) and `older` (outside it). Of the older ones a rotating few are looked at each night, so every run is checked now
 *      and then without a request for each of them every night.
 *   4. Each run in doubt is handed to THE ACTIVITY UPDATE HANDLER of the webhook worker, unchanged, as an `update` event made up here:
 *      one `GET /activities/:id` and then decideAction, the one table that says what Strava's answer means. So: 404 (and only 404)
 *      removes the run through RunStore.removeStravaRun, a changed date or distance goes through RunStore.updateStravaRun, a run that
 *      turned private or into a ride is removed, and every other answer (5xx, 403, 429, a network error, a broken body) leaves the run
 *      alone and is only logged by its code. There is no second copy of those rules here.
 *   5. After the checks: ONE reprocessRunsFromDate from the earliest changed date and ONE calculateUserTotals (-> evaluateBadges,
 *      titles), the worker's own recalculation through the same Recompute port, tried once more if it fails.
 *
 * ── A NIGHT THAT DIES IN THE MIDDLE (RUN-322, migration 057) ────────────────────────────────────────────────────────────────
 *   A run that is deleted is gone for good: no later night finds it to compare, so a recalculation that never ran (the process died,
 *   or both tries failed) would leave the XP and the streak of every later run wrong. Before the handler deletes or changes a run, the
 *   user is MARKED ("recalculate from this date", services/recalculationMarks); after the recalculation worked the mark is cleared,
 *   but only if nothing has marked the user since (its version). A mark that is left is taken by the recovery job, at the next
 *   start and at 04:05 every night. A mark that cannot be written stops the change: the run stays, is counted as failed, and is
 *   looked at again another night. The marking is done in markedRuns() below, around the handler's RunStore, because that is the one
 *   place between "Strava says it is gone" and the delete; the handler itself is the webhook's, unchanged.
 *
 * ── THE RULES THIS KEEPS ────────────────────────────────────────────────────────────────────────────────────────────────────
 *   - The user lock (withUserLock) is held while a user's runs are checked, changed and recalculated, the same lock the polling, the
 *     webhook batch and the disconnect take, so a poll can never bring back a run that was just deleted. The list is read before the
 *     lock; every decision is made on the single activity inside it. The lock is taken once, outermost; nothing inside takes it again.
 *   - A paused user (the pause is read by the handler for every run, inside the lock) loses runs that Strava says are gone, private or no
 *     longer a run, and is otherwise left untouched: no update of distance or date, no import.
 *   - A manual run is never looked at: the runs port lists `source = 'strava'` only, and the handler and the deletion repeat it.
 *   - The night has a request budget (RECONCILE_NIGHTLY_REQUEST_BUDGET) for everything it asks Strava, shared fairly over the users
 *     (the rotation shrinks, the list and the confirmation of what is in doubt come first), and it stops, leaving the rest for the next
 *     night, when Strava's own read budget is over its soft limit (stravaRateBudget) or answers 429.
 *   - A circuit breaker per user: RECONCILE_MAX_CONSECUTIVE_NETWORK_ERRORS checks in a row without any answer (network error or the
 *     timeout of stravaFetch) end that user's checks for the night, so the lock is held for a few timeouts and not for one per run.
 *   - Logging (ADR 010 8.6): our user id, counts and codes. Never a Strava id, a title, a coordinate or a token.
 *
 * Nothing here throws out of run().
 */
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { withUserLock } from '../utils/keyedMutex.js';
import {
  RECONCILE_LIST_PAGE_SIZE,
  RECONCILE_IN_DOUBT_MARGIN,
  RECONCILE_LIST_RESERVE_PER_USER,
  RECONCILE_MAX_CONSECUTIVE_NETWORK_ERRORS,
  RECONCILE_MAX_REMOVALS_PER_USER,
  RECONCILE_MAX_LIST_PAGES,
  RECONCILE_NIGHTLY_REQUEST_BUDGET,
  RECONCILE_OLD_RUNS_PER_USER,
  RECONCILE_WINDOW_DAYS,
  type ReconcileStopReason,
} from './stravaReconcile/constants.js';
import { nightIndex, planUser, reconcileWindow, rotationSlice, type ListedActivity, type StoredRun } from './stravaReconcile/plan.js';
import type { ReconcilePorts, ReconcileUser } from './stravaReconcile/ports.js';
import { tryClear } from './recalculationMarks/bestEffort.js';
import { assertTotalsWritten } from './recalculationMarks/totals.js';
import type { RecalculationMarkStore } from './recalculationMarks/ports.js';
import type { RateBudget, Recompute, RunStore, StravaApi, WebhookEventRow } from './stravaWebhook/ports.js';
import { createActivityUpdateHandler } from './stravaWebhook/handlers/activityUpdate.js';
import { checkSealingReady } from './stravaTokenStore.js';
import type { WebhookHandler } from './stravaWebhookWorker.js';

export interface ReconcileDeps {
  ports: ReconcilePorts;
  /** The webhook handler's ports, used as they are (token, GET /activities/:id), here counted against the night's budget. */
  strava: StravaApi;
  runs: RunStore;
  recompute: Recompute;
  /**
   * The marks of "recalculate from date X" (migration 057). Required, not optional: a reconcile that deletes without a way to
   * finish the recalculation after a crash is the fault this exists to remove.
   */
  marks: RecalculationMarkStore;
  /** Strava's read budget: over its soft limit the night stops. Absent = no check. */
  budget?: RateBudget;
  /** Injectable clock. */
  now?: () => Date;
  /** Everything the night may ask Strava. Default RECONCILE_NIGHTLY_REQUEST_BUDGET. */
  requestBudget?: number;
  /** Older runs checked per user and night. Default RECONCILE_OLD_RUNS_PER_USER. */
  oldRunsPerUser?: number;
  /** Default RECONCILE_WINDOW_DAYS. */
  windowDays?: number;
  /** The decision for one run in doubt. Default: the webhook's activity update handler. */
  handler?: WebhookHandler;
}

export interface ReconcileSummary {
  /** Connected users, paused ones included. */
  users: number;
  /** Of those, the paused ones: they get the removals only. */
  pausedUsers: number;
  /** Users left alone because no token or no complete list could be had. */
  skippedUnavailable: number;
  /** Runs looked at in Strava one by one. */
  checked: number;
  removed: number;
  updated: number;
  /** Checks or users that failed (a lookup that failed, a database error, a recalculation that did not work). Nothing was deleted by them. */
  failed: number;
  /** Strava requests spent. */
  requests: number;
  /** Why the night ended before every user was done; null = it did not. */
  stopped: ReconcileStopReason | null;
}

export interface StravaReconciler {
  /** One night. Never rejects. */
  run(): Promise<ReconcileSummary>;
}

/** The kinds of outcome of the handler that mean a Strava run went. */
const REMOVAL_OUTCOMES: readonly string[] = ['deleted', 'removed_private', 'removed_not_running'];

/** A short, safe label: characters limited, never a message. */
const shortCode = (value: unknown): string => String(value).replace(/[^\w.:-]/g, '').slice(0, 40) || 'unknown';

const earliest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a < b ? a : b);

interface Ledger {
  spent: number;
  remaining(): number;
  /** One request, if the budget has it. */
  tryTake(): boolean;
  /** A request that already happened. */
  record(): void;
}

function createLedger(limit: number): Ledger {
  const ledger: Ledger = {
    spent: 0,
    remaining: () => Math.max(0, limit - ledger.spent),
    tryTake() {
      if (ledger.spent >= limit) return false;
      ledger.spent += 1;
      return true;
    },
    record() {
      ledger.spent += 1;
    },
  };
  return ledger;
}

/** The handler's Strava port with every request counted against the night's budget, and refused when the budget is spent. */
function countedStrava(strava: StravaApi, ledger: Ledger): StravaApi {
  return {
    async getAccessToken(userId) {
      const result = await strava.getAccessToken(userId);
      // The stored token is free; a renewal (or a try at one) is a request to Strava.
      if (result.ok ? result.refreshed : result.reason === 'refresh_failed' || result.reason === 'refresh_rejected') ledger.record();
      return result;
    },
    async refreshAccessToken(userId) {
      if (!ledger.tryTake()) return { ok: false, reason: 'refresh_failed', expiresAt: null, connectionDate: null, consentVersion: null };
      return strava.refreshAccessToken(userId);
    },
    async fetchActivity(accessToken, activityId) {
      if (!ledger.tryTake()) return { kind: 'network_error' }; // the handler reads that as a failed lookup: the run stays
      return strava.fetchActivity(accessToken, activityId);
    },
    async fetchAthlete(accessToken) {
      if (!ledger.tryTake()) return { kind: 'network_error' };
      return strava.fetchAthlete(accessToken);
    },
  };
}

/** The `update` event the handler is given for a run in doubt: it reads the activity id and nothing else of it. */
function madeUpUpdateEvent(userId: string, externalId: string, at: Date): WebhookEventRow {
  const iso = at.toISOString();
  return {
    id: 0,
    dedupe_key: 'reconcile',
    object_type: 'activity',
    object_id: Number(externalId),
    aspect_type: 'update',
    owner_id: 0,
    subscription_id: 0,
    event_time: iso,
    updates: {},
    user_id: userId,
    status: 'processing',
    outcome: null,
    attempts: 0,
    next_attempt_at: iso,
    claimed_at: iso,
    lease_expires_at: null,
    last_error: null,
    received_at: iso,
    processed_at: null,
  };
}

/** Strava's ids fit a JS number; anything else is not an id this can ask about. */
const isActivityId = (externalId: string): boolean => Number.isSafeInteger(Number(externalId)) && Number(externalId) > 0 && String(Number(externalId)) === externalId;

export function createStravaReconciler(deps: ReconcileDeps): StravaReconciler {
  const { ports, runs, recompute, marks, budget } = deps;
  const now = deps.now ?? (() => new Date());
  const requestBudget = deps.requestBudget ?? RECONCILE_NIGHTLY_REQUEST_BUDGET;
  const oldRunsPerUser = deps.oldRunsPerUser ?? RECONCILE_OLD_RUNS_PER_USER;
  const windowDays = deps.windowDays ?? RECONCILE_WINDOW_DAYS;
  const handler = deps.handler ?? createActivityUpdateHandler();

  /** Reprocess, then totals, once more if either fails: the deleted run is already gone, and nothing but this would bring the totals right. */
  async function recalculate(userId: string, from: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await recompute.reprocessFrom(userId, from);
        // calculateUserTotals never throws: a failed totals run is a returned false, which counts as a failed try (and keeps the mark).
        assertTotalsWritten(await recompute.recalculateTotals(userId));
        return true;
      } catch (error) {
        logger.error(`❌ Strava reconcile: the recalculation for user ${userId} failed, try ${attempt} of 2 (${errorCode(error)})`);
      }
    }
    return false;
  }

  /** What the marks of one user's checks have come to: the newest version written, and the error of the first mark that could not be. */
  interface MarkState {
    version: number | null;
    failure: unknown;
  }

  /**
   * The handler's RunStore with the mark written first. `stored` is the run as it is right now (read under the lock, so the handler sees
   * the same): a removal marks its date; an update marks the earlier of its date and the new one, since a run moved to an earlier day
   * makes the days from there on wrong. A mark that fails throws before anything is written, and the caller counts the check as
   * failed. `latest` is the newest version the marks returned: the clear after the recalculation uses it.
   */
  function markedRuns(userId: string, stored: { date: string }, latest: MarkState): RunStore {
    const mark = async (fromDate: string) => {
      try {
        latest.version = await marks.mark(userId, fromDate);
      } catch (error) {
        latest.failure = error; // checkRuns ends this user's checks: marks.mark does not work, and every further check would fail the same way
        throw error;
      }
    };
    return {
      ...runs,
      async removeStravaRun(uid, externalId) {
        await mark(stored.date);
        return runs.removeStravaRun(uid, externalId);
      },
      async updateStravaRun(uid, externalId, patch, options) {
        await mark(patch.date !== undefined && patch.date < stored.date ? patch.date : stored.date);
        return runs.updateStravaRun(uid, externalId, patch, options);
      },
    };
  }

  async function run(): Promise<ReconcileSummary> {
    const started = now();
    const summary: ReconcileSummary = { users: 0, pausedUsers: 0, skippedUnavailable: 0, checked: 0, removed: 0, updated: 0, failed: 0, requests: 0, stopped: null };

    // Without a usable token key no user can get a token (ADR 013, fail-closed): the night does not start. One line for the night instead
    // of a warning and an error per user; the startup alarm (tokenKeyStartup) is the critical one and this is its nightly reminder.
    const sealing = checkSealingReady();
    if (!sealing.ok) {
      summary.stopped = 'token_key';
      logger.error(`❌ Strava reconcile skipped: the token key is not usable (${sealing.code}); no user was tried tonight`);
      return summary;
    }

    const ledger = createLedger(requestBudget);
    const strava = countedStrava(deps.strava, ledger);
    const night = nightIndex(started);

    function stopBeforeRequest(): boolean {
      if (summary.stopped) return true;
      if (budget?.isOverSoftLimit()) summary.stopped = 'rate_limit';
      else if (ledger.remaining() < 1) summary.stopped = 'budget';
      return summary.stopped !== null;
    }

    /** All pages of the list for the window, or null when it cannot be relied on. */
    async function readList(userId: string, accessToken: string, afterSeconds: number): Promise<ListedActivity[] | null> {
      const activities: ListedActivity[] = [];
      for (let page = 1; page <= RECONCILE_MAX_LIST_PAGES; page += 1) {
        if (!ledger.tryTake()) {
          summary.stopped = summary.stopped ?? 'budget';
          return null;
        }
        const result = await ports.listActivities(accessToken, afterSeconds, page);
        if (result.kind === 'failed') {
          if (result.status === 429) summary.stopped = summary.stopped ?? 'rate_limit';
          logger.warn(`⚠️ Strava reconcile: the activity list failed for user ${userId} (${result.status ?? 'network'}); the user is left alone tonight`);
          return null;
        }
        activities.push(...result.activities);
        if (result.activities.length < RECONCILE_LIST_PAGE_SIZE) return activities;
      }
      logger.warn(`⚠️ Strava reconcile: the activity list for user ${userId} may be cut short; the user is left alone tonight`);
      return null;
    }

    /** The checks of one user's runs in doubt, and their recalculation, inside the user's lock. */
    async function checkRuns(userId: string, externalIds: string[]): Promise<void> {
      // The pause, or a disconnect, may have come since the user list was read.
      let connection;
      try {
        connection = await runs.getConnection(userId);
      } catch (error) {
        summary.failed += 1;
        logger.warn(`⚠️ Strava reconcile: the connection of user ${userId} could not be read (${errorCode(error)}); the user is left alone tonight`);
        return;
      }
      if (!connection) return;

      let recalculateFrom: string | null = null;
      let removedForUser = 0;
      let unansweredInARow = 0;
      const latestMark: MarkState = { version: null, failure: undefined };
      for (const externalId of externalIds) {
        if (stopBeforeRequest()) break;
        if (removedForUser >= RECONCILE_MAX_REMOVALS_PER_USER) {
          logger.warn(`⚠️ Strava reconcile: ${removedForUser} runs of user ${userId} were removed tonight, the cap; the rest waits for the next night`);
          break;
        }

        let existing;
        try {
          existing = await runs.findRun(userId, externalId);
        } catch (error) {
          summary.failed += 1;
          logger.warn(`⚠️ Strava reconcile: a run of user ${userId} could not be read (${errorCode(error)})`);
          continue;
        }
        // Gone already (a webhook got there first) or not a Strava run: nothing to look at.
        if (!existing || existing.source !== 'strava') continue;

        summary.checked += 1;
        let result;
        try {
          result = await handler({
            event: madeUpUpdateEvent(userId, externalId, started),
            userId,
            attempts: 0,
            strava,
            runs: markedRuns(userId, existing, latestMark),
            now,
          });
        } catch (error) {
          summary.failed += 1;
          if (latestMark.failure !== undefined) {
            // The mark could not be written, so nothing was changed. Every further check of this user would ask Strava and then fail the
            // same way: stop here, say it once, and leave the rest for the next night instead of spending the budget every night.
            logger.warn(
              `⚠️ Strava reconcile: the recalculation mark of user ${userId} could not be written (${errorCode(latestMark.failure)}); nothing was changed and the rest of the user's checks wait for the next night`,
            );
            break;
          }
          logger.warn(`⚠️ Strava reconcile: a run of user ${userId} could not be checked (${errorCode(error)}); it stays`);
          continue;
        }

        if (result.status === 'wait') {
          summary.stopped = summary.stopped ?? 'rate_limit';
          break;
        }
        if (result.status === 'retry') {
          summary.failed += 1;
          logger.warn(`⚠️ Strava reconcile: a run of user ${userId} could not be checked (${shortCode(result.error)}); it stays`);
          // The circuit breaker: each unanswered check can take the whole Strava timeout under the user's lock, so a Strava that has
          // stopped answering must not be asked about every run in doubt. Only "no answer" counts; a 5xx is an answer.
          unansweredInARow = result.error === 'network_error' ? unansweredInARow + 1 : 0;
          if (unansweredInARow >= RECONCILE_MAX_CONSECUTIVE_NETWORK_ERRORS) {
            logger.warn(`⚠️ Strava reconcile: Strava stopped answering for user ${userId} (${unansweredInARow} checks in a row); the rest of the user's checks wait for the next night`);
            break;
          }
          continue;
        }
        unansweredInARow = 0;

        recalculateFrom = earliest(recalculateFrom, result.recalculateFrom);
        if (REMOVAL_OUTCOMES.includes(result.outcome)) {
          summary.removed += 1;
          removedForUser += 1;
        } else if (result.outcome === 'updated') {
          summary.updated += 1;
        } else if (result.outcome === 'ignored_unknown_owner') {
          break; // the connection went away under us
        }
      }

      if (recalculateFrom !== null) {
        if (await recalculate(userId, recalculateFrom)) {
          if (latestMark.version !== null) await tryClear(marks, userId, latestMark.version, 'Strava reconcile');
        } else {
          summary.failed += 1;
          logger.error(`❌ Strava reconcile: the totals of user ${userId} are out of date; the mark stays and the recovery job recalculates them`);
        }
      }
    }

    async function reconcileUser(user: ReconcileUser, usersLeft: number): Promise<void> {
      const userId = user.userId;
      // The runs first: a user without a Strava run has nothing to reconcile, and must cost neither a token renewal nor a request.
      const stored: StoredRun[] = await ports.listStravaRuns(userId);
      if (stored.length === 0) return;

      const token = await strava.getAccessToken(userId);
      if (!token.ok) {
        summary.skippedUnavailable += 1;
        logger.warn(`⚠️ Strava reconcile: no token for user ${userId} (${token.reason}); the user is left alone tonight`);
        return;
      }

      const { afterSeconds, startDay } = reconcileWindow(started, windowDays);
      const activities = await readList(userId, token.accessToken, afterSeconds);
      if (activities === null) {
        summary.skippedUnavailable += 1;
        return;
      }

      const plan = planUser(stored, activities, startDay);
      // This user's share of what is left of the budget, after the lists of the users still to come, shared evenly over this user and them.
      const share = Math.max(0, Math.floor((ledger.remaining() - (usersLeft - 1) * RECONCILE_LIST_RESERVE_PER_USER) / usersLeft));
      // What is in doubt comes first, the missing before the changed (a deletion has a deadline, a changed distance has not), but only up to the
      // share and a small margin: a user whose whole history looks missing (a Strava fault) must not eat the night. The rest waits for the next nights.
      const inDoubt = [...plan.missing, ...plan.changed].slice(0, share + RECONCILE_IN_DOUBT_MARGIN);
      if (inDoubt.length < plan.missing.length + plan.changed.length) {
        logger.warn(`⚠️ Strava reconcile: ${plan.missing.length + plan.changed.length} runs of user ${userId} are in doubt, only ${inDoubt.length} are looked at tonight`);
      }
      const rotationCount = Math.max(0, Math.min(oldRunsPerUser, share - inDoubt.length));
      const rotation = rotationSlice(plan.older, night, rotationCount).map((run) => run.externalId);

      const candidates = [...inDoubt, ...rotation].filter(isActivityId);
      if (candidates.length === 0) return;
      await withUserLock(userId, () => checkRuns(userId, candidates));
    }

    let users: ReconcileUser[];
    try {
      users = await ports.listConnectedUsers();
    } catch (error) {
      logger.error(`❌ Strava reconcile: the connected users could not be read (${errorCode(error)}); no night tonight`);
      summary.failed += 1;
      return summary;
    }

    summary.users = users.length;
    const eligible = [...users].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    summary.pausedUsers = users.filter((user) => user.syncPaused).length;
    // The order moves on one step a night, so when a night is cut short it is not always the same users that wait.
    const offset = eligible.length > 0 ? night % eligible.length : 0;
    const ordered = [...eligible.slice(offset), ...eligible.slice(0, offset)];

    for (let index = 0; index < ordered.length; index += 1) {
      if (stopBeforeRequest()) break;
      try {
        await reconcileUser(ordered[index], ordered.length - index);
      } catch (error) {
        summary.failed += 1;
        logger.error(`❌ Strava reconcile: user ${ordered[index].userId} failed (${errorCode(error)}); the night goes on`);
      }
    }

    summary.requests = ledger.spent;
    logger.info(
      `🧹 Strava reconcile: ${summary.users} user(s) (${summary.pausedUsers} paused, ${summary.skippedUnavailable} left alone), ` +
        `${summary.checked} run(s) checked, ${summary.removed} removed, ${summary.updated} updated, ${summary.failed} failed, ` +
        `${summary.requests} of ${requestBudget} requests${summary.stopped ? `, stopped early (${summary.stopped})` : ''}`,
    );
    return summary;
  }

  return {
    async run() {
      try {
        return await run();
      } catch (error) {
        // Unreachable by design; a last guard so that a bug here cannot take the scheduler down.
        logger.error(`❌ Strava reconcile failed unexpectedly (${errorCode(error)})`);
        return { users: 0, pausedUsers: 0, skippedUnavailable: 0, checked: 0, removed: 0, updated: 0, failed: 1, requests: 0, stopped: null };
      }
    },
  };
}
