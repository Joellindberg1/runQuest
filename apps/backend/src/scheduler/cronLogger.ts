// The logger node-cron 4 is given (cron.setLogger), so that what the library reports goes through the app's logger and its rules (ADR 010
// decision 8.6): fixed text and errorCode, never an error's message, stack, details or cause. By default node-cron writes to console with
// the whole Error, and three of its messages (a failed start, stop and destroy) carry the error's text inside the string. A Supabase or
// Strava error can quote a row, a Strava id or a url in its text, so no text from the library is passed on except the labels listed here.
// node-cron calls: error(Error), error(text, Error?), warn(text), info(text) and, from the background daemon only (which has its own
// silent logger), debug(text, Error?). Started by server.ts in the production block, before any scheduler.
import cron from 'node-cron';
import type { Logger } from 'node-cron';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';

/** Messages node-cron writes as a fixed text beside an Error. */
const FIXED_ERROR_TEXTS = [
  'Task failed with error!',
  'Run coordinator failed; skipping execution (fail-closed)',
  'Run coordinator onComplete failed',
];

/** Messages node-cron builds as `<start>: <error text>` or `<start> "<task name>" during shutdown: <error text>`: only the start is kept. */
const PREFIXED_ERROR_TEXTS = ['Failed to start scheduled task', 'Error stopping task', 'Error destroying task'];

const MISSED_EXECUTION = /^missed execution at (.+?)! Possible blocking IO/;
const OVERLAP = /^task still running, new execution blocked by overlap prevention/;

function labelOf(text: string): string {
  if (FIXED_ERROR_TEXTS.includes(text)) return text;
  return PREFIXED_ERROR_TEXTS.find((prefix) => text.startsWith(prefix)) ?? 'a scheduled job reported an error';
}

export const cronLogger: Logger = {
  error(message: string | Error, err?: Error): void {
    if (typeof message !== 'string') {
      logger.error(`❌ node-cron: a scheduled job failed (${errorCode(message)})`);
      return;
    }
    const label = labelOf(message);
    logger.error(err === undefined ? `❌ node-cron: ${label}` : `❌ node-cron: ${label} (${errorCode(err)})`);
  },

  warn(message: string): void {
    const missed = MISSED_EXECUTION.exec(message);
    if (missed) {
      // Only a parsed time is passed on, never the text it came from.
      const when = new Date(missed[1]);
      logger.warn(Number.isNaN(when.getTime())
        ? '⚠️ node-cron: missed an execution (a blocked event loop?)'
        : `⚠️ node-cron: missed an execution at ${when.toISOString()} (a blocked event loop?)`);
      return;
    }
    if (OVERLAP.test(message)) {
      logger.warn('⚠️ node-cron: a run was skipped because the previous run is still going');
      return;
    }
    logger.warn('⚠️ node-cron: warning');
  },

  info(): void {
    logger.info('ℹ️ node-cron: notice');
  },

  // Only the daemon (background tasks, which this app does not use) writes debug, and it has a silent logger of its own.
  debug(): void {},
};

/** Call once at start-up, before the schedulers are started. */
export function installCronLogger(): void {
  cron.setLogger(cronLogger);
}
