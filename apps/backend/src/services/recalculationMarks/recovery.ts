/**
 * The recovery job of the recalculation marks (migration 057, RUN-322): finishes a recalculation that a crash or a failure left undone.
 *
 * The nightly reconcile (and the disconnect) delete a Strava run and then recalculate streak, XP and totals from its date. They write a
 * mark BEFORE the delete and clear it AFTER the recalculation worked (services/recalculationMarks/mark.ts). When the process dies in
 * between, or the recalculation fails, the mark stays, and this job picks it up: at start and every night before the reconcile.
 *
 * Per marked user, inside the user lock (the one the polling, the webhook batch, the reconcile and the disconnect take):
 *   1. the mark is read AGAIN under the lock: someone who held the lock may have recalculated and cleared it, or marked an earlier
 *      date, since the list was read;
 *   2. reprocessFrom(date), then recalculateTotals: the same two steps and the same order as every other recalculation;
 *   3. clear(version): removes the mark only if nothing has marked the user since step 1. A change that marked the user meanwhile
 *      keeps its mark, and the next run takes it.
 * A failure leaves the mark and costs nothing but a retry on the next run. Without a mark the job reads one (empty) table and does
 * nothing: no recalculation, no cost per user.
 *
 * Logging: our user id, counts and error codes. Never an error message.
 */
import { errorCode } from '../../utils/errorCode.js';
import { logger } from '../../utils/logger.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import type { Recompute } from '../stravaWebhook/ports.js';
import { RECOVERY_MAX_PER_RUN } from './constants.js';
import type { RecalculationMarkStore } from './ports.js';

export interface RecoveryDeps {
  store: RecalculationMarkStore;
  /** The same two steps every recalculation takes; the rest of the Recompute port is not used. */
  recompute: Pick<Recompute, 'reprocessFrom' | 'recalculateTotals'>;
  /** Default RECOVERY_MAX_PER_RUN. */
  maxPerRun?: number;
}

export interface RecoverySummary {
  /** Marks read (at most the cap). */
  found: number;
  /** Users recalculated and cleared. A mark that someone else cleared while this waited for the lock is neither recalculated nor failed. */
  recalculated: number;
  /** Users whose recalculation or clear failed; their mark stays. A list that could not be read counts one. */
  failed: number;
}

export interface RecalculationRecovery {
  /** One pass over the marks. Never rejects. */
  run(): Promise<RecoverySummary>;
}

export function createRecalculationRecovery(deps: RecoveryDeps): RecalculationRecovery {
  const { store, recompute } = deps;
  const maxPerRun = deps.maxPerRun ?? RECOVERY_MAX_PER_RUN;

  /** One user, inside the lock. Returns what happened to the mark. */
  async function recoverUser(userId: string): Promise<'recalculated' | 'gone'> {
    const mark = await store.read(userId);
    if (!mark) return 'gone';

    await recompute.reprocessFrom(userId, mark.fromDate);
    await recompute.recalculateTotals(userId);
    // false = a newer mark was written during the recalculation: it stays, and the next run takes it.
    await store.clear(userId, mark.version);
    return 'recalculated';
  }

  async function run(): Promise<RecoverySummary> {
    const summary: RecoverySummary = { found: 0, recalculated: 0, failed: 0 };

    let pending;
    try {
      pending = await store.listPending(maxPerRun);
    } catch (error) {
      summary.failed += 1;
      logger.error(`❌ Recalculation recovery: the marks could not be read (${errorCode(error)}); the next run tries again`);
      return summary;
    }
    summary.found = pending.length;

    for (const { userId } of pending) {
      try {
        if ((await withUserLock(userId, () => recoverUser(userId))) === 'recalculated') summary.recalculated += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(`❌ Recalculation recovery: user ${userId} could not be recalculated (${errorCode(error)}); the mark stays for the next run`);
      }
    }

    if (summary.found > 0) {
      logger.info(`🔁 Recalculation recovery: ${summary.found} mark(s) found, ${summary.recalculated} recalculated, ${summary.failed} failed`);
    }
    return summary;
  }

  return {
    async run() {
      try {
        return await run();
      } catch (error) {
        // Unreachable by design; a last guard so that a bug here cannot take the scheduler down.
        logger.error(`❌ Recalculation recovery failed unexpectedly (${errorCode(error)})`);
        return { found: 0, recalculated: 0, failed: 1 };
      }
    },
  };
}
