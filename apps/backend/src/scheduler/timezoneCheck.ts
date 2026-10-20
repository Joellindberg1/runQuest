// The backend process must run in UTC (docs/release.md). The Stockholm jobs get their zone from the `timezone` option of each schedule; a TZ
// on the process with daylight saving time makes node-cron 4's heartbeat loop in the hour that repeats when the clocks go back. This warns
// at start (production block of server.ts) if TZ is set to anything but UTC; it does not change the process or stop it.
import { logger } from '../utils/logger.js';

const UTC_NAMES = new Set(['utc', 'etc/utc']);

/** True (and one warning) if TZ is set to something other than empty or UTC. */
export function warnIfProcessTimezoneIsNotUtc(env: { TZ?: string | undefined } = process.env): boolean {
  const zone = env.TZ?.trim() ?? '';
  if (zone === '' || UTC_NAMES.has(zone.toLowerCase())) return false;
  logger.warn(`⚠️ TZ is set to "${zone}" on the backend process. Never set TZ on the backend service: the process must run in UTC, or node-cron's heartbeat can loop in the hour that repeats when the clocks go back.`);
  return true;
}
