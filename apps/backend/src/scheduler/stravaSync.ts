// 🕐 Strava Sync Scheduler
import { logger } from '../utils/logger.js';
import cron from 'node-cron';
import { syncAllStravaUsers } from '../routes/strava.js';

// PRODUCTION: Run every 3 hours
export function startStravaScheduler() {
  logger.info('🕐 Starting Strava sync scheduler for production (every 3 hours)...');

  cron.schedule('0 */3 * * *', async () => {
    logger.info('🔄 Scheduled Strava sync starting (3-hour interval)...');
    try {
      const result = await syncAllStravaUsers();
      logger.info(`✅ Scheduled sync completed: ${result.message}`);
    } catch (error) {
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
