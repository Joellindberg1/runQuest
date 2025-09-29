// 🕐 Strava Sync Scheduler
import cron from 'node-cron';

// Simple in-memory scheduler for Strava sync
export function startStravaScheduler() {
  console.log('🕐 Starting Strava sync scheduler (every 3 hours)...');
  
  // Run every 3 hours: 0 */3 * * *
  cron.schedule('0 */3 * * *', async () => {
    console.log('🔄 Scheduled Strava sync starting...');
    
    try {
      // Call our internal sync endpoint
      const response = await fetch('http://localhost:3001/api/strava/sync-all');
      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Scheduled sync completed: ${result.message}`);
      } else {
        console.error('❌ Scheduled sync failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Scheduled sync error:', error);
    }
  });
  
  console.log('✅ Strava sync scheduler started');
}

// Manual trigger for testing
export async function triggerManualSync() {
  console.log('🔄 Manual sync trigger...');
  
  try {
    const response = await fetch('http://localhost:3001/api/strava/sync-all');
    const result = await response.json();
    
    console.log('📊 Manual sync result:', result);
    return result;
  } catch (error) {
    console.error('❌ Manual sync trigger error:', error);
    return { success: false, error: 'Manual sync failed' };
  }
}