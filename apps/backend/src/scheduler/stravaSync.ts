// 🕐 Strava Sync Scheduler
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import cron from 'node-cron';
import { syncAllStravaUsers } from '../routes/strava.js';
import { WeatherService } from '../services/weatherService.js';
import { enhancedTitleService } from '../services/enhancedTitleService.js';
import { STOCKHOLM_TZ, nextStravaPollSlot, stravaPollCron, stravaPollIntervalLabel } from '@runquest/shared';


interface SyncState {
  lastSyncAttempt: string | null;
  lastSyncStatus: string;
  nextSyncEstimated: string | null;
  usersSynced: number;
  totalUsers: number;
  newRuns: number;
}

const syncState: SyncState = {
  lastSyncAttempt: null,
  lastSyncStatus: 'pending',
  nextSyncEstimated: null,
  usersSynced: 0,
  totalUsers: 0,
  newRuns: 0,
};

// The weather backfill is not tied to the poll: webhooks import runs between polls, and their weather (and the weather titles) should
// not wait for the next backup check. It reads the same tables the poll's backfill always did, so the load is unchanged.
const WEATHER_BACKFILL_CRON = '*/30 * * * *';

// node-cron 3 now and then skips a whole second window (about 0.8 % of the ticks measured). With a 12-hour interval that would leave half
// a day without the backup check, so the 30-minute tick runs the poll once if the estimated slot is this much overdue. A poll that is
// due is not "late" until this has passed: the slot's own tick may still be about to run. This covers a skipped cron second while the
// process lives. A restart estimates the NEXT slot, so a slot missed during a deploy is not caught up; webhooks carry that time.
const CATCH_UP_GRACE_MS = 10 * 60 * 1000;

// The cron fires at fixed Stockholm clock times, so the next sync is the next slot, not the attempt plus the interval. A tick that
// runs exactly on a slot estimates the one after it.
function nextSyncAfterAttempt(attempt: Date): string {
  return nextStravaPollSlot(attempt).toISOString();
}

export function getSyncInfo(): SyncState {
  return { ...syncState };
}

// Väder kommer efter importen, och Stormborn/Iceborn hänger på det: ny väderdata kan ändra vem som håller titlarna.
// Alla grupper (explicit allGroups, RUN-104); ett fel här är inte ett synkfel — synken och backfillen har redan lyckats.
async function recalculateTitlesAfterWeather(savedRows: number): Promise<void> {
  try {
    logger.info(`🏆 Weather saved for ${savedRows} run(s) — recalculating titles...`);
    const result = await enhancedTitleService.processAllUsersTitles(undefined, { allGroups: true });
    // processAllUsersTitles kastar inte vid fel hos enskilda användare (RUN-157): räknarna är det enda som syns.
    if (result.failed > 0) {
      logger.warn(`⚠️ Title recalculation after weather: ${result.failed} of ${result.total} users failed`);
    }
  } catch (error) {
    logger.error(`❌ Title recalculation after weather backfill failed (${errorCode(error)})`);
  }
}

// A long backfill (200 ms between runs) must not be started a second time by the next tick.
let weatherBackfillRunning = false;

// Backfill weather for any runs still missing it (new imports, webhook-moved runs and retries from earlier failures).
async function runWeatherBackfill(): Promise<void> {
  if (weatherBackfillRunning) {
    // The only sign of a hanging backfill.
    logger.warn('⏭️ Weather backfill skipped: the previous one is still running');
    return;
  }
  weatherBackfillRunning = true;
  try {
    const savedWeather = await WeatherService.backfillMissingWeather();
    if (savedWeather > 0) await recalculateTitlesAfterWeather(savedWeather);
  } catch (error) {
    logger.error(`❌ Weather backfill failed (${errorCode(error)})`);
  } finally {
    weatherBackfillRunning = false;
  }
}

// One poll at a time: the scheduled tick and the catch-up share this guard.
let pollRunning = false;

async function runPoll(): Promise<void> {
  if (pollRunning) {
    // A warning, not info: this is the only sign of a hanging poll.
    logger.warn('⏭️ Strava sync skipped: the previous one is still running');
    return;
  }
  pollRunning = true;
  const attempt = new Date();
  syncState.lastSyncAttempt = attempt.toISOString();
  syncState.lastSyncStatus = 'running';
  // Set when the poll starts, not when it ends, so the estimate never lags behind a slot that is running.
  syncState.nextSyncEstimated = nextSyncAfterAttempt(attempt);
  try {
    logger.info(`🔄 Strava sync starting (${stravaPollIntervalLabel()} interval)...`);
    const result = await syncAllStravaUsers();
    syncState.lastSyncStatus = result.success ? 'success' : 'error';
    syncState.usersSynced = result.syncedUsers;
    syncState.totalUsers = result.totalUsers;
    syncState.newRuns = result.totalNewRuns;
    logger.info(`✅ Scheduled sync completed: ${result.syncedUsers} of ${result.totalUsers} users, ${result.totalNewRuns} new runs`);
  } catch (error) {
    syncState.lastSyncStatus = 'error';
    logger.error(`❌ Scheduled sync error (${errorCode(error)})`);
  } finally {
    pollRunning = false;
  }
}

// Runs the poll when its slot has been missed. After a restart the estimate is the next slot, so a restart never triggers it
// (webhooks carry the time in between); a failed poll has already moved the estimate on, so it is not retried every half hour.
async function catchUpMissedPoll(): Promise<void> {
  try {
    if (pollRunning || !syncState.nextSyncEstimated) return;
    if (Date.now() <= Date.parse(syncState.nextSyncEstimated) + CATCH_UP_GRACE_MS) return;
    logger.warn(`⚠️ The Strava sync slot ${syncState.nextSyncEstimated} was missed, catching up...`);
    await runPoll();
  } catch (error) {
    logger.error(`❌ Strava sync catch-up failed (${errorCode(error)})`);
  }
}

// PRODUCTION: the backup poll runs every STRAVA_POLL_INTERVAL_HOURS hours, the weather backfill every 30 minutes.
export function startStravaScheduler() {
  logger.info(`🕐 Starting Strava sync scheduler for production (backup check every ${stravaPollIntervalLabel()}, weather every 30 minutes)...`);

  // After a restart there is no attempt yet; the next sync is still the next slot, so the status never says "unknown".
  syncState.nextSyncEstimated = nextStravaPollSlot(new Date()).toISOString();

  cron.schedule(stravaPollCron(), runPoll, { timezone: STOCKHOLM_TZ });

  // The 30-minute tick does two independent jobs, each with its own error handling.
  cron.schedule(WEATHER_BACKFILL_CRON, async () => {
    await Promise.all([catchUpMissedPoll(), runWeatherBackfill()]);
  }, { timezone: STOCKHOLM_TZ });

  logger.info('✅ Strava sync scheduler started');
}
