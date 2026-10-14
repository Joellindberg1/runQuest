// 🕐 Strava Sync Scheduler
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import cron from 'node-cron';
import { syncAllStravaUsers } from '../routes/strava.js';
import { WeatherService } from '../services/weatherService.js';
import { enhancedTitleService } from '../services/enhancedTitleService.js';
import { STRAVA_POLL_INTERVAL_MINUTES, stravaPollCron } from '@runquest/shared';


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

function computeNextSync(): string {
  return new Date(Date.now() + STRAVA_POLL_INTERVAL_MINUTES * 60 * 1000).toISOString();
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

// PRODUCTION: Run every 30 minutes
export function startStravaScheduler() {
  logger.info(`🕐 Starting Strava sync scheduler for production (every ${STRAVA_POLL_INTERVAL_MINUTES} minutes)...`);

  // Set first estimated next sync time
  syncState.nextSyncEstimated = computeNextSync();

  cron.schedule(stravaPollCron(), async () => {
    logger.info(`🔄 Scheduled Strava sync starting (${STRAVA_POLL_INTERVAL_MINUTES}-minute interval)...`);
    syncState.lastSyncAttempt = new Date().toISOString();
    syncState.lastSyncStatus = 'running';
    try {
      const result = await syncAllStravaUsers();
      syncState.lastSyncStatus = result.success ? 'success' : 'error';
      syncState.usersSynced = result.syncedUsers;
      syncState.totalUsers = result.totalUsers;
      syncState.newRuns = result.totalNewRuns;
      syncState.nextSyncEstimated = computeNextSync();
      logger.info(`✅ Scheduled sync completed: ${result.message}`);

      // Backfill weather for any runs still missing it (new + retries from previous failures)
      const savedWeather = await WeatherService.backfillMissingWeather();
      if (savedWeather > 0) await recalculateTitlesAfterWeather(savedWeather);
    } catch (error) {
      syncState.lastSyncStatus = 'error';
      syncState.nextSyncEstimated = computeNextSync();
      logger.error(`❌ Scheduled sync error (${errorCode(error)})`);
    }
  });

  logger.info('✅ Strava sync scheduler started');
}
