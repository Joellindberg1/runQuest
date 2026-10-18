/**
 * The check of the token key when the process starts (ADR 013 decision 9, owner decision Ö5). Called once from server.ts.
 *
 * A key that is missing, malformed or not accepted in this environment (stravaTokenStore.requiredKidPrefix) means that no Strava token
 * can be read or saved: checkSealingReady refuses (fail-closed), so the Strava track is off and the rest of the app (login, runs, XP,
 * competitions) runs on. The process does NOT exit, unlike for JWT_SECRET: a down app is a worse outcome than a paused sync.
 *
 * In production the problem is a `🚨 KRITISKT` line with the `token_key` source, which becomes a fatal Sentry event (observability/
 * sentry.ts); that is the alarm that tells the owner before a user notices. Outside production it is a plain warning: a local backend
 * without a key is normal, and nothing alarms for it. The line names the problem and, for a refused key id, the id (never a secret);
 * it never carries a key value, a token or a stored value.
 *
 * Once per start is once per cause and process. The reads that fail afterwards are ordinary error lines without the prefix
 * (stravaClient), and the scheduled runs say once per run that they were skipped (syncAllStravaUsers, the reconcile).
 */
import { CriticalAlert } from '../utils/criticalAlert.js';
import { logger } from '../utils/logger.js';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV } from '../utils/secretBox.js';
import { inspectTokenKeyConfig, type TokenKeyConfig } from './stravaTokenStore.js';

const CONSEQUENCE = 'Strava-synken är avstängd och webhook-händelser väntar; resten av appen fungerar. Se docs/runbook-token-key.md.';

function alarmText(problem: Exclude<TokenKeyConfig, { ok: true }>): string {
  const head = '🚨 KRITISKT: Strava-tokenkryptering';
  switch (problem.problem) {
    case 'key_missing':
      return `${head} saknar nyckel (${ACTIVE_KEY_ENV} är inte satt). ${CONSEQUENCE}`;
    case 'key_invalid':
      return `${head} har en ogiltig nyckelkonfiguration (${ACTIVE_KEY_ENV} eller ${RETIRED_KEYS_ENV}: fel format, fel längd eller samma nyckel-id två gånger). ${CONSEQUENCE}`;
    case 'kid_not_allowed':
      return `${head} godtar inte nyckel-id ${problem.offendingKids.join(', ')} i den här miljön (kräver prefixet "${problem.requiredPrefix}"). ${CONSEQUENCE}`;
  }
}

function warningText(problem: Exclude<TokenKeyConfig, { ok: true }>): string {
  const why =
    problem.problem === 'key_missing'
      ? `${ACTIVE_KEY_ENV} is not set`
      : problem.problem === 'key_invalid'
        ? `${ACTIVE_KEY_ENV} or ${RETIRED_KEYS_ENV} is malformed`
        : `key id ${problem.offendingKids.join(', ')} is not accepted here`;
  return `⚠️ Strava token encryption is off (${why}): Strava tokens are neither read nor saved, the rest of the app runs.`;
}

/** Checks the key configuration and says what it found. Never throws and never exits. Returns the finding, for the caller and for tests. */
export function reportTokenKeyAtStartup(): TokenKeyConfig {
  const config = inspectTokenKeyConfig();
  if (config.ok) {
    logger.info(`🔐 Strava token encryption on: active key ${config.ring.activeKid}, ${config.ring.kids.length - 1} retired key(s)`);
    return config;
  }
  if (process.env.NODE_ENV === 'production') {
    logger.error(alarmText(config), new CriticalAlert('token_key'));
  } else {
    logger.warn(warningText(config));
  }
  return config;
}
