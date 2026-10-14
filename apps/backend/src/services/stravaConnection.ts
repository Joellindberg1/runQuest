// removeStravaConnection (ADR 010 decision 7.4): the ONE function behind "Disconnect" in Settings and a deauthorize from Strava.
// It is exported here and wired up elsewhere: S19 (DELETE /disconnect, with the revoke hook) and S17 (the `athlete` webhook handler,
// reason 'deauthorized'). This module has no route and no handler.
//
// Order, and why (7.4.1): revoke at Strava (user_disconnect only) -> delete the runs -> recompute once -> trace the consent ->
// delete the strava_tokens row LAST. The row stays until the runs are gone, so a crash in between is finished by a rerun, which
// finds the user through the row. A rerun after a completed run (no runs, no row) does nothing and writes nothing.
//
// Logging (ADR 010 8.6): our user id, a row count and an error code. Never a token, an athlete id, a Strava id or a title.
import { getSupabaseClient } from '../config/database.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { logger } from '../utils/logger.js';
import {
  countStravaRuns,
  deleteStravaRuns,
  earliestRunDate,
  earliestStravaRunDate,
  errorCode,
  recomputeAfterRemoval,
} from './stravaRemoval.js';

/** 'deauthorized': Strava already revoked, so we never revoke again (S17). 'user_disconnect': the user chose it in Settings (S19). */
export type RemoveConnectionReason = 'deauthorized' | 'user_disconnect';

export interface RemoveConnectionOptions {
  reason: RemoveConnectionReason;
  /**
   * Asks Strava to revoke the authorisation (S19 fills this in). Called FIRST and only for 'user_disconnect', because the token
   * leaves with the row. Tolerant: a rejection is logged as a warning with its code and the disconnect carries on (7.4.2).
   * Default: none.
   */
  revoke?: (userId: string) => Promise<void>;
}

function fail(what: string, error: unknown): never {
  const code = errorCode(error);
  throw Object.assign(new Error(`${what} failed (${code})`), { code });
}

/**
 * Removes the user's Strava connection: all `source = 'strava'` runs, the recalculation they leave behind, and the token row.
 * Manual runs, event entries and paid-out event XP are untouched (D2: event_entries.run_id becomes NULL, migration 047).
 *
 * PRECONDITION: the caller already holds `withUserLock(userId)` (S19's route, or the worker's lock for S17). This function takes
 * no lock itself, and must not: the lock is not reentrant (utils/keyedMutex.ts), so a second one here would throw.
 *
 * Idempotent and restartable. Everything is done in this one call (a single delete, no paging), so the 48 h deadline of the worker
 * (S11) is about the worker reaching the event, not about this function leaving work behind.
 *
 * What a rerun does depends on what the first attempt left behind, and the token row is the evidence:
 *   - no Strava runs and no row: a completed removal. Nothing is recomputed and nothing is written.
 *   - Strava runs: they are deleted and the recompute starts at the oldest of them (read before the delete, see below).
 *   - no Strava runs but the row is still there: an earlier attempt did not finish, and the deleted runs may not have been
 *     reprocessed (the reprocess threw after the delete). The recompute then starts at the user's EARLIEST run of any source,
 *     which is always correct, or only the totals are recalculated when the user has no run left.
 * A user who connected and never imported a run takes the last branch too, once: it costs one reprocess and does no harm.
 *
 * Throws on a database error (a Postgres code, no row values) and on a reprocess error from recomputeAfterRemoval (after it has
 * tried the totals); in both cases the token row is still there and a rerun carries on.
 */
export async function removeStravaConnection(userId: string, options: RemoveConnectionOptions): Promise<void> {
  if (typeof userId !== 'string' || userId === '') throw new TypeError('removeStravaConnection needs a user id');
  const { reason, revoke } = options;

  if (reason === 'user_disconnect' && revoke) {
    try {
      await revoke(userId);
    } catch (error) {
      logger.warn(`⚠️ Strava disconnect: the revoke at Strava failed for user ${userId} (${errorCode(error)}), carrying on`);
    }
  }

  const supabase = getSupabaseClient();
  const { data: row, error: readError } = await supabase
    .from('strava_tokens')
    .select('consent_version, consented_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) fail('read strava connection', readError);

  // The oldest date comes from its own query: the rows a delete hands back are capped by PostgREST max-rows and unordered.
  const oldest = await earliestStravaRunDate(userId);
  if (oldest !== null) {
    const deletedDates = await deleteStravaRuns(userId, { all: true });
    const from = deletedDates.length > 0 && deletedDates[0] < oldest ? deletedDates[0] : oldest;
    await recomputeAfterRemoval(userId, from);

    // The row must not go while a Strava run is left (a capped or partial delete): a rerun finishes the runs first.
    const left = await countStravaRuns(userId);
    if (left > 0) {
      logger.error(`❌ Strava disconnect: ${left} Strava run(s) left for user ${userId}, keeping the connection row`);
      throw Object.assign(new Error('strava runs remain after the delete'), { code: 'strava_runs_remaining' });
    }
  } else if (row) {
    // An earlier attempt did not finish. Its oldest deleted date is gone, so start from the user's earliest run of any source.
    const from = await earliestRunDate(userId);
    if (from !== null) {
      logger.info(`🔁 Strava disconnect: finishing an earlier attempt for user ${userId}, reprocessing from the earliest run`);
      await recomputeAfterRemoval(userId, from);
    } else {
      await calculateUserTotals(userId);
    }
  }

  if (row) {
    // The trace of the consent (7.4.1): the row, and with it the consent, is gone after this. Never a token or the athlete id.
    const consent = row as { consent_version: string | null; consented_at: string | null };
    logger.info(
      `🔌 Strava connection removed (${reason}): user_id=${userId} consent_version=${consent.consent_version ?? 'none'} consented_at=${consent.consented_at ?? 'none'}`,
    );
    const { error: deleteError } = await supabase.from('strava_tokens').delete().eq('user_id', userId);
    if (deleteError) fail('delete strava connection', deleteError);
  }
}
