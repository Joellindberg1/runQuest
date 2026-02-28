// 🕐 Strava Sync Scheduler
import cron from 'node-cron';
import { syncAllStravaUsers } from '../routes/strava.js';

// PRODUCTION: Run every 3 hours
export function startStravaScheduler() {
  console.log('🕐 Starting Strava sync scheduler for production (every 3 hours)...');

  cron.schedule('0 */3 * * *', async () => {
    console.log('🔄 Scheduled Strava sync starting (3-hour interval)...');
    try {
      const result = await syncAllStravaUsers();
      console.log(`✅ Scheduled sync completed: ${result.message}`);
    } catch (error) {
      console.error('❌ Scheduled sync error:', error);
    }
  });

  console.log('✅ Strava sync scheduler started');
}

// Manual trigger for testing/admin use
export async function triggerManualSync() {
  console.log('🔄 Manual sync trigger...');
  try {
    const result = await syncAllStravaUsers();
    console.log('📊 Manual sync result:', result);
    return result;
  } catch (error) {
    console.error('❌ Manual sync trigger error:', error);
    return { success: false, error: 'Manual sync failed' };
  }
}
