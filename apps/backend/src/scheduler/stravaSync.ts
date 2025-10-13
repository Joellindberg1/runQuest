// 🕐 Strava Sync Scheduler
import cron from 'node-cron';

// Simple in-memory scheduler for Strava sync
export function startStravaScheduler() {
  console.log('🕐 Starting Strava sync scheduler for production (every 3 hours)...');
  
  // Use PORT environment variable, fallback to 3001 for development
  const port = process.env.PORT || '3001';
  const backendUrl = `http://localhost:${port}`;
  console.log('🌐 Using backend URL for scheduler:', backendUrl);
  
  // PRODUCTION: Run every 3 hours: 0 */3 * * *
  // For testing, change to: */5 * * * * (every 5 minutes)
  cron.schedule('0 */3 * * *', async () => {
    console.log('🔄 Scheduled Strava sync starting (3-hour interval)...');
    
    try {
      // Call our internal sync endpoint
      const response = await fetch(`${backendUrl}/api/strava/sync-all`);
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
  
  const port = process.env.PORT || '3001';
  const backendUrl = `http://localhost:${port}`;
  
  try {
    const response = await fetch(`${backendUrl}/api/strava/sync-all`);
    const result = await response.json();
    
    console.log('📊 Manual sync result:', result);
    return result;
  } catch (error) {
    console.error('❌ Manual sync trigger error:', error);
    return { success: false, error: 'Manual sync failed' };
  }
}