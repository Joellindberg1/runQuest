// Schedules the recovery of recalculation marks (RUN-322, migration 057): one run when the server starts, so a crash is repaired at the
// restart, and one at 04:05 Stockholm time every night, ten minutes before the nightly Strava reconcile. Everything it does lives in
// services/recalculationMarks/recovery.ts; this file only starts it. Started by server.ts in production only; the start function checks
// NODE_ENV itself as well, so a stray call elsewhere cannot start it.
import cron from 'node-cron';
import { STOCKHOLM_TZ } from '@runquest/shared';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { RECOVERY_CRON } from '../services/recalculationMarks/constants.js';
import { createDefaultRecovery } from '../services/recalculationMarks/defaultRecovery.js';
import type { RecalculationRecovery } from '../services/recalculationMarks/recovery.js';

// Set by startRecalculationRecoveryScheduler(), cleared by its stop function.
let started = false;

/** Starts the job (one run now, then nightly). Returns a function that stops it. Does nothing outside production. */
export function startRecalculationRecoveryScheduler(options: { recovery?: RecalculationRecovery } = {}): () => void {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('ℹ️ The recalculation recovery is not started outside production');
    return () => {};
  }
  if (started) return () => {};
  started = true;

  const recovery = options.recovery ?? createDefaultRecovery();
  logger.info('🕐 Starting the recalculation recovery (at start and 04:05 Europe/Stockholm)...');

  // One run at a time: a run that overruns (a long reprocess) is not started a second time by the next tick, and the run at start is
  // not overlapped by the night.
  let running = false;
  const runOnce = async (): Promise<void> => {
    if (running) {
      logger.warn('⏭️ Recalculation recovery skipped: the previous run is still going');
      return;
    }
    running = true;
    try {
      await recovery.run();
    } catch (error) {
      logger.error(`❌ Recalculation recovery failed (${errorCode(error)})`);
    } finally {
      running = false;
    }
  };

  const task = cron.schedule(RECOVERY_CRON, () => void runOnce(), { timezone: STOCKHOLM_TZ });
  void runOnce();

  return () => {
    task.stop();
    started = false;
  };
}
