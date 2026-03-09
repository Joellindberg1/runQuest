// 🕐 Strava Sync Scheduler
import { logger } from '../utils/logger.js';
import cron from 'node-cron';
import { syncAllStravaUsers } from '../routes/strava.js';

const SYNC_INTERVAL_MINUTES = 30;

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
  return new Date(Date.now() + SYNC_INTERVAL_MINUTES * 60 * 1000).toISOString();
}

export function getSyncInfo(): SyncState {
  return { ...syncState };
}

// PRODUCTION: Run every 30 minutes
export function startStravaScheduler() {
  logger.info(`🕐 Starting Strava sync scheduler for production (every ${SYNC_INTERVAL_MINUTES} minutes)...`);

  // Set first estimated next sync time
  syncState.nextSyncEstimated = computeNextSync();

  cron.schedule(`*/${SYNC_INTERVAL_MINUTES} * * * *`, async () => {
    logger.info(`🔄 Scheduled Strava sync starting (${SYNC_INTERVAL_MINUTES}-minute interval)...`);
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
    } catch (error) {
      syncState.lastSyncStatus = 'error';
      syncState.nextSyncEstimated = computeNextSync();
      logger.error('❌ Scheduled sync error:', error);
    }
  });

  logger.info('✅ Strava sync scheduler started');
}

// Manual trigger for testing/admin use
export async function triggerManualSync() {
  logger.info('🔄 Manual sync trigger...');
  try {
    const result = await syncAllStravaUsers();
    logger.info('📊 Manual sync result:', result);
    return result;
  } catch (error) {
    logger.error('❌ Manual sync trigger error:', error);
    return { success: false, error: 'Manual sync failed' };
  }
}
