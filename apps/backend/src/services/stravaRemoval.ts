// The deletion chain for Strava runs (ADR 010 decision 8): ONE way to remove a Strava run, whatever the cause (a delete event, a run
// made private, a type change, deauthorize, "Disconnect", and the future RUN-177).
//
// The chain has two halves, and who owns the second one depends on who calls:
//
//   1. deleteStravaRuns(userId, scope)       - the DELETE, the only query that removes a Strava run. Always `source = 'strava'`.
//                                              Returns the dates of the rows it deleted, oldest first.
//   2. recomputeAfterRemoval(userId, from)   - reprocessRunsFromDate(from), then calculateUserTotals (-> evaluateBadges, titles).
//
//   - In the WEBHOOK path the worker owns half 2 (services/stravaWebhookWorker.ts): it recalculates ONCE per user and batch, from the
//     earliest `recalculateFrom` its handlers report, and retries the events if the reprocess throws. The delete handler therefore
//     only calls half 1, through RunStore.removeStravaRun (supabaseAdapters.ts), and reports the date.
//   - Callers that do NOT run in the worker (the disconnect, S16) call both halves themselves:
//         const dates = await deleteStravaRuns(userId, { all: true });
//         if (dates.length > 0) await recomputeAfterRemoval(userId, dates[0]);
//     inside the one outermost withUserLock they already hold (never a second lock from in here).
//   The two differ on one point on purpose: the worker skips the totals when the reprocess fails, because it retries the event and the
//   retry recalculates; recomputeAfterRemoval still tries the totals and then rethrows, because S16 has no retry.
//   The disconnect also writes a RECALCULATION MARK before the delete and clears it after a recalculation that worked
//   (services/recalculationMarks, migration 057; the nightly reconcile does the same through its own Recompute port), so a crash between
//   the two halves is finished by the recovery job. recomputeAfterRemoval's answer (totals done or not) decides whether the disconnect may clear it.
//
// What the database does with the rest (not done here, see migrations): event_entries.run_id becomes NULL and the entry keeps its XP
// (047, ON DELETE SET NULL), run_weather goes (000_baseline, ON DELETE CASCADE) and user_badges.source_run_id becomes NULL (035,
// ON DELETE SET NULL). Pack News rows (level_up, run_milestone) stay; badge_earned rows are retracted by evaluateBadges.
//
// Logging (ADR 010 8.6): our user id, a row count and an error code. Never an external id, a coordinate or a title.
import { getSupabaseClient } from '../config/database.js';
import { reprocessRunsFromDate } from '../routes/runs.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { errorCode } from '../utils/errorCode.js';
import { logger } from '../utils/logger.js';

/** One activity of the user (a delete event), or all of the user's Strava runs (a disconnect). */
export type RemovalScope = { externalId: string } | { all: true };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The helper moved to utils/errorCode.ts so that routes/runs.ts can use it without importing this module (which imports runs.ts).
export { errorCode };

/**
 * Deletes the user's Strava runs in the scope and returns the dates ('YYYY-MM-DD') of the rows that went, oldest first; [] when none.
 * Never a manual run: `source = 'strava'` is part of the query. Throws on a database error (a Postgres error code, no row values).
 * A scope that is not exactly one of the two shapes is refused, so a malformed one can never widen the delete.
 */
export async function deleteStravaRuns(userId: string, scope: RemovalScope): Promise<string[]> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('deleteStravaRuns needs a user id');
  const one = 'externalId' in scope ? scope.externalId : null;
  const all = 'all' in scope && scope.all === true;
  if (!all && !(typeof one === 'string' && one !== '')) throw new TypeError('deleteStravaRuns needs { externalId } or { all: true }');

  let query = getSupabaseClient()
    .from('runs')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'strava'); // the guard: a manual run is never deleted by this chain
  if (one !== null) query = query.eq('external_id', one);

  const { data, error } = await query.select('date');
  if (error) {
    const code = errorCode(error);
    logger.error(`❌ Strava removal: could not delete runs for user ${userId} (${code})`);
    throw Object.assign(new Error(`delete strava runs failed (${code})`), { code });
  }

  const dates = ((data as Array<{ date: string }> | null) ?? []).map((row) => row.date).sort();
  logger.info(`🗑️ Strava removal: deleted ${dates.length} run(s) for user ${userId}`);
  return dates;
}

/**
 * The date ('YYYY-MM-DD') of the user's oldest Strava run, or null when there is none. A single-row query on purpose: the rows a
 * delete hands back are capped by PostgREST max-rows (1000 by default) and come back in no guaranteed order, so the oldest date
 * of a large purge cannot be read from them. Read it BEFORE the delete.
 */
export async function earliestStravaRunDate(userId: string): Promise<string | null> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('earliestStravaRunDate needs a user id');
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('date')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .order('date', { ascending: true })
    .limit(1);
  if (error) {
    const code = errorCode(error);
    logger.error(`❌ Strava removal: could not read the oldest run for user ${userId} (${code})`);
    throw Object.assign(new Error(`read oldest strava run failed (${code})`), { code });
  }
  const date = (data as Array<{ date: string }> | null)?.[0]?.date;
  return typeof date === 'string' && DATE.test(date) ? date : null;
}

/**
 * The date ('YYYY-MM-DD') of the user's oldest run of ANY source (manual included), or null when the user has no run. The safe
 * starting point for a reprocess when the date of an earlier, unfinished removal is not known.
 */
export async function earliestRunDate(userId: string): Promise<string | null> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('earliestRunDate needs a user id');
  const { data, error } = await getSupabaseClient()
    .from('runs')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .limit(1);
  if (error) {
    const code = errorCode(error);
    logger.error(`❌ Strava removal: could not read the oldest run of any source for user ${userId} (${code})`);
    throw Object.assign(new Error(`read oldest run failed (${code})`), { code });
  }
  const date = (data as Array<{ date: string }> | null)?.[0]?.date;
  return typeof date === 'string' && DATE.test(date) ? date : null;
}

/** How many Strava runs the user has. A head count: no rows travel, so no max-rows cap applies. */
export async function countStravaRuns(userId: string): Promise<number> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('countStravaRuns needs a user id');
  const { count, error } = await getSupabaseClient()
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', 'strava');
  if (error) {
    const code = errorCode(error);
    logger.error(`❌ Strava removal: could not count runs for user ${userId} (${code})`);
    throw Object.assign(new Error(`count strava runs failed (${code})`), { code });
  }
  return count ?? 0;
}

/**
 * The second half for a caller outside the worker. Reprocesses the streak and XP of the runs from `fromDate` on (the oldest deleted
 * run's date), then recalculates the totals, level, badges and titles.
 * A reprocess error is thrown to the caller AFTER the totals have been tried: the deleted runs must leave the totals even when the
 * XP of the later runs could not be recomputed, and the caller's retry repeats the reprocess. The totals themselves are best-effort
 * (ADR 010 8.5, as in the polling): a failure is logged with its code and never thrown, but it is REPORTED: the answer is true when the
 * totals were recalculated and false when they were not, so a caller that has a recalculation mark (RUN-322) leaves it for the
 * recovery job instead of clearing it. A reprocess failure is still thrown, after the totals have been tried.
 */
export async function recomputeAfterRemoval(userId: string, fromDate: string): Promise<boolean> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('recomputeAfterRemoval needs a user id');
  if (typeof fromDate !== 'string' || !DATE.test(fromDate)) throw new TypeError('recomputeAfterRemoval needs a YYYY-MM-DD date');

  let reprocessFailure: { error: unknown } | null = null;
  try {
    await reprocessRunsFromDate(userId, fromDate);
  } catch (error) {
    reprocessFailure = { error };
    logger.error(`❌ Strava removal: the reprocess failed for user ${userId} (${errorCode(error)})`);
  }

  let totalsDone = true;
  try {
    // A bulk path (the disconnect and the deauthorize purge): no rank_passed is written or retracted (ADR 011 decision 6, mass recalculation).
    // calculateUserTotals never throws; it returns false when the totals were not written (RUN-322), which is a failure here too.
    totalsDone = (await calculateUserTotals(userId, { emitRankNews: false })) !== false;
    if (!totalsDone) logger.error(`❌ Strava removal: the totals were not written for user ${userId}`);
  } catch (error) {
    totalsDone = false;
    logger.error(`❌ Strava removal: the totals could not be recalculated for user ${userId} (${errorCode(error)})`);
  }

  if (reprocessFailure) throw reprocessFailure.error;
  return totalsDone;
}
