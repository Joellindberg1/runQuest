// Schedules the Strava webhook worker (ADR 010 decisions 6 and 11): a sweep every minute (the guarantee), the retention job at
// 03:30 Stockholm time with the daily check of the subscription beside it (services/stravaWebhook/subscriptionCheck.ts, independent
// of the retention), and the wake-up after an insert (only latency). Everything the worker does lives in
// services/stravaWebhookWorker.ts; this file only starts it.
//
// Started by server.ts in production only. The wake-up is a no-op until then (and after stop), so tests and dev store events
// without processing them. The start function checks NODE_ENV itself as well, so a stray call elsewhere cannot start it.
import cron from 'node-cron';
import { STOCKHOLM_TZ } from '@runquest/shared';
import { logger } from '../utils/logger.js';
import { WEBHOOK_RETENTION_CRON, WEBHOOK_SWEEP_CRON } from '../services/stravaWebhook/constants.js';
import { createDefaultWebhookWorker } from '../services/stravaWebhook/defaultWorker.js';
import { runStravaSubscriptionCheck } from '../services/stravaWebhook/subscriptionCheck.js';
import type { StravaWebhookWorker } from '../services/stravaWebhookWorker.js';
import { errorCode } from '../utils/errorCode.js';

// Set by startStravaWebhookScheduler(), cleared by its stop function.
let activeWorker: StravaWebhookWorker | null = null;

/**
 * One drain of the worker that never throws or rejects: a failure is logged by error code (never the message, which may hold a Strava id
 * or a url) and the next sweep tries again. Without it a rejected drain would be an unhandled rejection.
 */
async function drainSafely(worker: StravaWebhookWorker): Promise<void> {
  try {
    await worker.drain();
  } catch (err) {
    logger.error(`❌ Strava webhook drain failed (${errorCode(err)})`);
  }
}

/**
 * The route calls this after it has stored an event (createStravaWebhookRouter({ onEventStored })). The loop starts on the next
 * turn of the event loop, so the call never runs inside the caller's work; the worker's own "already running" flag makes
 * several wake-ups one loop. It must never be called from inside the user lock.
 */
export function wakeStravaWebhookWorker(): void {
  const worker = activeWorker;
  if (!worker) return;
  setImmediate(() => {
    void drainSafely(worker);
  });
}

/**
 * One job of the night run on its own: whatever it does, throws or rejects, is logged by error code (never the message, which may
 * hold a url with a secret) and stays inside it. The jobs of the 03:30 run are started side by side through this, so a failing
 * retention cannot stop the subscription check, and the other way round.
 */
async function runNightlyJob(label: string, job: () => Promise<unknown>): Promise<void> {
  try {
    await job();
  } catch (err) {
    logger.error(`❌ Nightly Strava webhook job failed: ${label} (${errorCode(err)})`);
  }
}

/** Starts the sweep and the retention job. Returns a function that stops them. Does nothing outside production. */
export function startStravaWebhookScheduler(options: { worker?: StravaWebhookWorker } = {}): () => void {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('ℹ️ Strava webhook worker is not started outside production (events are stored, not processed)');
    return () => {};
  }
  if (activeWorker) return () => {};

  const worker = options.worker ?? createDefaultWebhookWorker();
  activeWorker = worker;
  logger.info('🕐 Starting Strava webhook worker (sweep every minute, retention and subscription check 03:30 Europe/Stockholm)...');

  const sweep = cron.schedule(WEBHOOK_SWEEP_CRON, () => {
    void drainSafely(worker);
  });
  const retention = cron.schedule(
    WEBHOOK_RETENTION_CRON,
    () => {
      void runNightlyJob('retention', () => worker.runRetention());
      void runNightlyJob('subscription check', () => runStravaSubscriptionCheck());
    },
    { timezone: STOCKHOLM_TZ },
  );

  return () => {
    sweep.stop();
    retention.stop();
    if (activeWorker === worker) activeWorker = null;
  };
}
