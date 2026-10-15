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

// A tick can fire a few milliseconds before the slot it belongs to (timer jitter). Looking from just after the attempt keeps the
// estimate on the slot after it instead of on the slot that is already running.
const TICK_JITTER_MS = 1000;

// The cron fires at fixed Stockholm clock times, so the next sync is the next slot, not the attempt plus the interval.
function nextSyncAfterAttempt(attempt: Date): string {
  return nextStravaPollSlot(new Date(attempt.getTime() + TICK_JITTER_MS)).toISOString();
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
  if (weatherBackfillRunning) return;
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

// PRODUCTION: the backup poll runs every STRAVA_POLL_INTERVAL_HOURS hours, the weather backfill every 30 minutes.
export function startStravaScheduler() {
  logger.info(`🕐 Starting Strava sync scheduler for production (backup check every ${stravaPollIntervalLabel()}, weather every 30 minutes)...`);

  // After a restart there is no attempt yet; the next sync is still the next slot, so the status never says "unknown".
  syncState.nextSyncEstimated = nextStravaPollSlot(new Date()).toISOString();

  cron.schedule(stravaPollCron(), async () => {
    logger.info(`🔄 Scheduled Strava sync starting (${stravaPollIntervalLabel()} interval)...`);
    const attempt = new Date();
    syncState.lastSyncAttempt = attempt.toISOString();
    syncState.lastSyncStatus = 'running';
    try {
      const result = await syncAllStravaUsers();
      syncState.lastSyncStatus = result.success ? 'success' : 'error';
      syncState.usersSynced = result.syncedUsers;
      syncState.totalUsers = result.totalUsers;
      syncState.newRuns = result.totalNewRuns;
      syncState.nextSyncEstimated = nextSyncAfterAttempt(attempt);
      logger.info(`✅ Scheduled sync completed: ${result.message}`);
    } catch (error) {
      syncState.lastSyncStatus = 'error';
      syncState.nextSyncEstimated = nextSyncAfterAttempt(attempt);
      logger.error(`❌ Scheduled sync error (${errorCode(error)})`);
    }
  }, { timezone: STOCKHOLM_TZ });

  cron.schedule(WEATHER_BACKFILL_CRON, runWeatherBackfill, { timezone: STOCKHOLM_TZ });

  logger.info('✅ Strava sync scheduler started');
}
