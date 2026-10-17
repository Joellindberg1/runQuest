// Schedules the nightly reconcile of Strava runs against Strava (ADR 010 decision 13, RUN-177): once a night at 04:15 Stockholm time.
// Everything it does lives in services/stravaReconcile.ts; this file only starts it. Started by server.ts in production only; the
// start function checks NODE_ENV itself as well, so a stray call elsewhere cannot start it.
import cron from 'node-cron';
import { STOCKHOLM_TZ } from '@runquest/shared';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { RECONCILE_CRON } from '../services/stravaReconcile/constants.js';
import { createDefaultReconciler } from '../services/stravaReconcile/defaultReconciler.js';
import type { StravaReconciler } from '../services/stravaReconcile.js';

// Set by startStravaReconcileScheduler(), cleared by its stop function.
let started = false;

/** Starts the nightly job. Returns a function that stops it. Does nothing outside production. */
export function startStravaReconcileScheduler(options: { reconciler?: StravaReconciler } = {}): () => void {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('ℹ️ The nightly Strava reconcile is not started outside production');
    return () => {};
  }
  if (started) return () => {};
  started = true;

  const reconciler = options.reconciler ?? createDefaultReconciler();
  logger.info('🕐 Starting the nightly Strava reconcile (04:15 Europe/Stockholm)...');

  // One night at a time: a night that overruns (a slow Strava) is not started a second time by the next tick.
  let running = false;
  const task = cron.schedule(
    RECONCILE_CRON,
    async () => {
      if (running) {
        logger.warn('⏭️ Strava reconcile skipped: the previous night is still running');
        return;
      }
      running = true;
      try {
        await reconciler.run();
      } catch (error) {
        logger.error(`❌ Strava reconcile failed (${errorCode(error)})`);
      } finally {
        running = false;
      }
    },
    { timezone: STOCKHOLM_TZ },
  );

  return () => {
    task.stop();
    started = false;
  };
}
