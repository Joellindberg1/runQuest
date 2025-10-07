// 🔗 Strava Integration Routes
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { calculateRunXP } from '../utils/xpCalculation.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';

const router = express.Router();

// GET /api/strava/config - Get Strava client ID
router.get('/config', async (_req, res): Promise<void> => {
  try {
    console.log('⚙️ Strava config requested');
    
    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: 'Strava client ID not configured' }); return;
    }
    
    res.json({ client_id: clientId }); return;
  } catch (error) {
    console.error('❌ Strava config error:', error);
    res.status(500).json({ error: 'Failed to get Strava config' }); return;
  }
});

// GET /api/strava/status - Check user's Strava connection status  
router.get('/status', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    console.log('🔍 Checking Strava status for user:', req.user!.name);
    
    const supabase = getSupabaseClient();
    const { data: tokens, error } = await supabase
      .from('strava_tokens')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error || !tokens) {
      console.log('❌ No Strava tokens found for user');
      res.json({ connected: false, expired: false }); return;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const expired = tokens.expires_at ? tokens.expires_at < now : false;
    
    // Om token är expired, försök auto-refresh
    if (expired && tokens.refresh_token) {
      console.log('🔄 Token expired, attempting auto-refresh...');
      
      const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
      if (refreshResult.success) {
        console.log('✅ Token auto-refreshed successfully');
        res.json({
          connected: true,
          expired: false, // No longer expired after refresh
          auto_refreshed: true
        });
      } else {
        console.log('❌ Auto-refresh failed, connection truly expired');
        res.json({
          connected: true,
          expired: true,
          refresh_failed: true
        });
      }
    }
    
    // Get last global sync time (based on most recent Strava run imported by anyone)
    const { data: lastGlobalStravaRun, error: syncError } = await supabase
      .from('runs')
      .select('created_at')
      .eq('source', 'strava')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    console.log('🔍 Last global sync query result:', { lastGlobalStravaRun, syncError });

    console.log('✅ Strava status:', { connected: true, expired, expires_at: tokens.expires_at });
    
    res.json({
      connected: true,
      expired,
      expires_at: tokens.expires_at,
      connection_date: tokens.connection_date,
      last_sync: lastGlobalStravaRun?.created_at || null
    });
    
  } catch (error) {
    console.error('❌ Strava status error:', error);
    res.status(500).json({ error: 'Failed to check Strava status' }); return;
  }
});

// POST /api/strava/callback - Handle Strava OAuth callback
router.post('/callback', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { code } = req.body;
    const userId = req.user!.user_id;
    
    if (!code) {
      res.status(400).json({ error: 'Authorization code required' }); return;
    }
    
    console.log(`🔗 Processing Strava callback for user: ${req.user!.name}`);
    console.log(`🔑 Auth code: ${code.substring(0, 10)}...`);
    
    // Exchange code for access token
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      res.status(500).json({ error: 'Strava credentials not configured' }); return;
    }
    
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code'
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      console.error('❌ Strava token exchange failed:', tokenData);
      res.status(400).json({ error: 'Failed to exchange authorization code' }); return;
    }
    
    console.log('✅ Strava tokens received:', {
      access_token: tokenData.access_token ? `${tokenData.access_token.substring(0, 10)}...` : 'missing',
      expires_at: tokenData.expires_at
    });
    
    // Save tokens to database
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('strava_tokens')
      .upsert({
        user_id: userId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        connection_date: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Failed to save Strava tokens:', error);
      res.status(500).json({ error: 'Failed to save Strava connection' }); return;
    }
    
    console.log('✅ Strava tokens saved successfully');
    
    res.json({
      success: true,
      message: 'Strava connected successfully',
      athlete: tokenData.athlete
    });
    
  } catch (error) {
    console.error('❌ Strava callback error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// DELETE /api/strava/disconnect - Disconnect Strava account
router.delete('/disconnect', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    console.log(`🔌 Disconnecting Strava for user: ${req.user!.name}`);
    
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('strava_tokens')
      .delete()
      .eq('user_id', userId);
    
    if (error) {
      console.error('❌ Failed to delete Strava tokens:', error);
      res.status(500).json({ error: 'Failed to disconnect Strava' }); return;
    }
    
    console.log('✅ Strava disconnected successfully');
    res.json({
      success: true,
      message: 'Strava disconnected successfully'
    });
    
  } catch (error) {
    console.error('❌ Strava disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/strava/sync - Manually sync Strava activities
router.post('/sync', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user!.user_id;
    console.log(`🔄 Manual Strava sync requested for user: ${req.user!.name}`);
    
    const result = await syncUserStravaActivities(userId);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Synced ${result.newRuns} new runs from Strava`,
        newRuns: result.newRuns,
        totalActivities: result.totalActivities
      });
    } else {
      res.status(400).json({ error: result.error }); return;
    }
    
  } catch (error) {
    console.error('❌ Manual Strava sync error:', error);
    res.status(500).json({ error: 'Failed to sync Strava activities' }); return;
  }
});

// Simple sync logging using file system (temporary solution)
import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SYNC_LOG_FILE = join(__dirname, '../../sync-log.json');

async function logSyncAttempt(data: any) {
  try {
    let logs = [];
    try {
      const existing = await fs.readFile(SYNC_LOG_FILE, 'utf8');
      logs = JSON.parse(existing);
    } catch {
      // File doesn't exist, start fresh
    }
    
    logs.push({ ...data, timestamp: new Date().toISOString() });
    
    // Keep only last 50 logs
    if (logs.length > 50) {
      logs = logs.slice(-50);
    }
    
    await fs.writeFile(SYNC_LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (error) {
    console.error('Failed to log sync attempt:', error);
  }
}

async function getLastSyncAttempt() {
  try {
    const data = await fs.readFile(SYNC_LOG_FILE, 'utf8');
    const logs = JSON.parse(data);
    return logs[logs.length - 1] || null;
  } catch {
    return null;
  }
}

// GET /api/strava/sync-all - Sync all connected users (internal endpoint)
router.get('/sync-all', async (_req, res) => {
  const syncStartTime = new Date().toISOString();
  
  try {
    console.log('🔄 Starting automatic Strava sync for all connected users...');
    
    const supabase = getSupabaseClient();
    
    // Log sync attempt start
    await logSyncAttempt({
      sync_type: 'strava_automatic',
      started_at: syncStartTime,
      status: 'started'
    });
    
    // Get all users with valid Strava tokens
    const { data: connectedUsers, error } = await supabase
      .from('strava_tokens')
      .select(`
        user_id,
        access_token,
        refresh_token,
        expires_at,
        users!inner(name)
      `)
      .not('access_token', 'is', null);
    
    if (error) {
      console.error('❌ Failed to fetch connected users:', error);
      res.status(500).json({ error: 'Failed to fetch connected users' }); return;
    }
    
    if (!connectedUsers || connectedUsers.length === 0) {
      console.log('ℹ️ No users with Strava connections found');
      res.json({ 
        success: true, 
        message: 'No users to sync',
        syncedUsers: 0,
        totalNewRuns: 0
      });
    }
    
    console.log(`🔍 Found ${connectedUsers.length} users with Strava connections`);
    
    let totalSyncedUsers = 0;
    let totalNewRuns = 0;
    const results: any[] = [];
    
    // Sync each user
    for (const user of connectedUsers) {
      try {
        console.log(`🔄 Syncing user: ${user.users.name}`);
        const result = await syncUserStravaActivities(user.user_id);
        
        if (result.success) {
          totalSyncedUsers++;
          totalNewRuns += result.newRuns || 0;
          results.push({
            userId: user.user_id,
            userName: user.users.name,
            newRuns: result.newRuns,
            totalActivities: result.totalActivities
          });
          console.log(`✅ Synced ${result.newRuns} new runs for ${user.users.name}`);
        } else {
          console.error(`❌ Failed to sync ${user.users.name}:`, result.error);
          results.push({
            userId: user.user_id,
            userName: user.users.name,
            error: result.error
          });
        }
        
        // Add small delay between users to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (userError) {
        console.error(`❌ Error syncing user ${user.users.name}:`, userError);
        results.push({
          userId: user.user_id,
          userName: user.users.name,
          error: 'Sync failed'
        });
      }
    }
    
    console.log(`🎯 Automatic sync completed: ${totalSyncedUsers}/${connectedUsers.length} users synced, ${totalNewRuns} new runs imported`);
    
    // Log successful sync completion
    const syncEndTime = new Date().toISOString();
    await logSyncAttempt({
      sync_type: 'strava_automatic',
      started_at: syncStartTime,
      completed_at: syncEndTime,
      status: 'completed',
      users_synced: totalSyncedUsers,
      total_users: connectedUsers.length,
      new_runs: totalNewRuns
    });

    res.json({
      success: true,
      message: `Synced ${totalSyncedUsers} users with ${totalNewRuns} new runs`,
      syncedUsers: totalSyncedUsers,
      totalUsers: connectedUsers.length,
      totalNewRuns,
      results
    });
    
  } catch (error) {
    console.error('❌ Automatic Strava sync error:', error);
    
    // Log failed sync
    const syncEndTime = new Date().toISOString();
    await logSyncAttempt({
      sync_type: 'strava_automatic',
      started_at: syncStartTime,
      completed_at: syncEndTime,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error'
    });
      
    res.status(500).json({ error: 'Failed to sync Strava activities' }); return;
  }
});

// Helper function to sync activities for a single user
async function syncUserStravaActivities(userId: string): Promise<{
  success: boolean;
  newRuns?: number;
  totalActivities?: number;
  message?: string;
  error?: string;
}> {
  try {
    const supabase = getSupabaseClient();
    
    // Get user's Strava tokens (including connection_date)
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at, connection_date')
      .eq('user_id', userId)
      .single();
    
    if (tokenError || !tokens) {
      return { success: false, error: 'User not connected to Strava' };
    }
    
    // Check if token is expired and refresh if needed
    const now = Math.floor(Date.now() / 1000);
    let accessToken = tokens.access_token;
    
    if (tokens.expires_at && tokens.expires_at < now) {
      console.log('🔄 Access token expired, refreshing...');
      
      const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
      if (!refreshResult.success) {
        return { success: false, error: 'Failed to refresh Strava token' };
      }
      accessToken = refreshResult.access_token;
    }
    
    // Get existing runs to avoid duplicates
    const { data: existingRuns, error: runsError } = await supabase
      .from('runs')
      .select('external_id, date, distance')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .not('external_id', 'is', null);
    
    if (runsError) {
      return { success: false, error: 'Failed to fetch existing runs' };
    }
    
    console.log(`💾 Found ${existingRuns?.length || 0} existing Strava runs in database`);
    if (existingRuns && existingRuns.length > 0) {
      existingRuns.forEach((run: any) => {
        console.log(`  - External ID: ${run.external_id}, Date: ${run.date}, Distance: ${run.distance}km`);
      });
    }
    
    const existingIds = new Set(existingRuns?.map((run: any) => run.external_id) || []);
    
    // Fetch activities from Strava (from connection date onwards)
    let after: number;
    
    if (tokens.connection_date) {
      // Use connection date as starting point
      const connectionDate = new Date(tokens.connection_date);
      connectionDate.setHours(0, 0, 0, 0); // Start from beginning of connection day
      after = Math.floor(connectionDate.getTime() / 1000);
      console.log(`📅 Using connection date as starting point: ${connectionDate.toISOString()}`);
    } else {
      // Fallback to 30 days ago if no connection date (for legacy users)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      after = Math.floor(thirtyDaysAgo.getTime() / 1000);
      console.log(`⚠️ No connection date found, falling back to 30 days ago: ${thirtyDaysAgo.toISOString()}`);
    }
    
    console.log(`📅 Fetching activities after: ${new Date(after * 1000).toISOString()} (including today)`);
    
    const stravaResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (!stravaResponse.ok) {
      const errorData = await stravaResponse.json();
      console.error('❌ Strava API error:', errorData);
      return { success: false, error: 'Failed to fetch Strava activities' };
    }
    
    const activities = await stravaResponse.json();
    console.log(`📊 Fetched ${activities.length} activities from Strava`);
    
    // Log all activities for debugging
    if (activities.length > 0) {
      console.log('🔍 All activities found:');
      activities.forEach((activity: any, index: number) => {
        const distance = (activity.distance / 1000).toFixed(2);
        const date = activity.start_date_local.split('T')[0];
        console.log(`  ${index + 1}. ${date}: ${distance}km, Type: ${activity.type}, ID: ${activity.id}`);
      });
    }
    
    // Filter for running activities only
    const runningActivities = activities.filter((activity: any) => 
      activity.type === 'Run' && 
      !existingIds.has(activity.id.toString())
    );
    
    console.log(`🏃‍♂️ Found ${runningActivities.length} new running activities`);
    console.log(`🚫 Existing activity IDs in database: [${Array.from(existingIds).join(', ')}]`);
    
    if (runningActivities.length === 0) {
      return { 
        success: true, 
        newRuns: 0, 
        totalActivities: activities.length,
        message: 'No new running activities found'
      };
    }
    
    // Process each running activity with enhanced async handling
    console.log(`🔄 Processing ${runningActivities.length} new running activities with enhanced async handling...`);
    
    let importedRuns = 0;
    const processingResults = [];
    
    // Option 1: Sequential processing (most reliable)
    for (const activity of runningActivities) {
      try {
        console.log(`\n🏃‍♂️ Processing activity ${activity.id} sequentially...`);
        
        const result = await processStravaRunSequentially(activity, userId);
        
        if (result.success) {
          importedRuns++;
          processingResults.push({ activity_id: activity.id, success: true });
          console.log(`✅ Activity ${activity.id} processed successfully`);
        } else {
          processingResults.push({ activity_id: activity.id, success: false, error: result.error });
          console.error(`❌ Activity ${activity.id} failed: ${result.error}`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        processingResults.push({ activity_id: activity.id, success: false, error: errorMessage });
        console.error(`❌ Unexpected error processing activity ${activity.id}:`, errorMessage);
      }
    }

// Helper function for sequential processing of single activity
async function processStravaRunSequentially(activity: any, userId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const distance = activity.distance / 1000;
  const date = activity.start_date_local.split('T')[0];
  
  // Skip runs with 0 distance
  if (distance <= 0) {
    console.log(`⚠️ Skipping activity ${activity.id} with 0 distance`);
    return { success: true }; // Not an error, just skip
  }
  
  console.log(`📊 Calculating values for ${distance.toFixed(2)}km run on ${date}...`);
  
  // Phase 1: Calculate ALL values with proper async/await
  const xpResult = await calculateRunXP(distance);
  console.log(`  ✅ XP calculated: ${xpResult.totalXP} (Base: ${xpResult.baseXP}, KM: ${xpResult.kmXP}, Bonus: ${xpResult.distanceBonus})`);
  
  // Import and calculate streak - WAIT for completion
  const { StreakService } = await import('../services/streakService.js');
  const streakResult = await StreakService.calculateUserStreaks(userId, date);
  console.log(`  ✅ Streak calculated: Day ${streakResult.streakDayForRun} of current ${streakResult.currentStreak}-day streak`);
  
  // Get multiplier data - WAIT for completion
  const { data: multipliers } = await supabase
    .from('streak_multipliers')
    .select('*')
    .order('days');
  console.log(`  ✅ Multipliers loaded: ${multipliers?.length || 0} tiers`);
  
  // Calculate final values
  let streakMultiplier = 1.0;
  if (multipliers) {
    for (const mult of multipliers) {
      if (streakResult.streakDayForRun >= mult.days) {
        streakMultiplier = mult.multiplier;
      }
    }
  }
  
  const finalXP = Math.round(xpResult.totalXP * streakMultiplier);
  const streakBonus = finalXP - xpResult.totalXP;
  
  console.log(`  � Final calculation: ${finalXP} XP (${streakMultiplier}x multiplier = +${streakBonus} bonus)`);
  
  // Phase 2: Validate ALL data BEFORE saving
  if (distance > 0 && finalXP <= 0) {
    throw new Error(`XP validation failed: ${distance}km run resulted in ${finalXP} XP`);
  }
  
  if (!xpResult.baseXP && !xpResult.kmXP && distance > 0) {
    throw new Error(`XP breakdown validation failed: base=${xpResult.baseXP}, km=${xpResult.kmXP} for ${distance}km`);
  }
  
  console.log(`  ✅ All validations passed`);
  
  // Phase 3: Atomic database save with verification
  const runData = {
    user_id: userId,
    date: date,
    distance: distance,
    xp_gained: finalXP,
    multiplier: streakMultiplier,
    streak_day: streakResult.streakDayForRun,
    base_xp: xpResult.baseXP,
    km_xp: xpResult.kmXP,
    distance_bonus: xpResult.distanceBonus,
    streak_bonus: streakBonus,
    source: 'strava',
    external_id: activity.id.toString(),
    created_at: new Date().toISOString()
  };
  
  const { data: savedRun, error: insertError } = await supabase
    .from('runs')
    .insert(runData)
    .select()
    .single();
  
  if (insertError) {
    throw new Error(`Database insert failed: ${insertError.message}`);
  }
  
  // Phase 4: Verify data integrity
  if (savedRun.xp_gained !== finalXP) {
    console.error(`❌ DATA INTEGRITY ERROR: Saved XP ${savedRun.xp_gained} ≠ calculated XP ${finalXP}`);
    throw new Error(`Data integrity check failed after save`);
  }
  
  console.log(`  ✅ Data integrity verified: Saved run has correct XP (${savedRun.xp_gained})`);
  
  return { success: true };
}
    
    // Update user totals if any runs were imported
    if (importedRuns > 0) {
      console.log(`🔄 Updating user totals after importing ${importedRuns} runs...`);
      // Use new unified calculation function
      await calculateUserTotals(userId);
    }
    
    return {
      success: true,
      newRuns: importedRuns,
      totalActivities: activities.length,
      message: `Successfully imported ${importedRuns} new runs from Strava`
    };
    
  } catch (error) {
    console.error('❌ Error syncing Strava activities:', error);
    return { success: false, error: 'Failed to sync activities' };
  }
}

// Helper function to refresh Strava token
async function refreshStravaToken(refreshToken: string, userId: string): Promise<{
  success: boolean;
  access_token?: string;
  error?: string;
}> {
  try {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return { success: false, error: 'Strava credentials not configured' };
    }
    
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const tokenData = await response.json();
    
    if (!response.ok) {
      console.error('❌ Token refresh failed:', tokenData);
      return { success: false, error: 'Failed to refresh token' };
    }
    
    // Update tokens in database
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('strava_tokens')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at
      })
      .eq('user_id', userId);
    
    if (error) {
      console.error('❌ Failed to update refreshed tokens:', error);
      return { success: false, error: 'Failed to save new tokens' };
    }
    
    console.log('✅ Strava token refreshed successfully');
    return { 
      success: true, 
      access_token: tokenData.access_token 
    };
    
  } catch (error) {
    console.error('❌ Token refresh error:', error);
    return { success: false, error: 'Token refresh failed' };
  }
}

// GET /api/strava/last-sync - Get last sync attempt info
router.get('/last-sync', async (_req, res): Promise<void> => {
  try {
    const lastSync = await getLastSyncAttempt();
    
    if (!lastSync) {
      res.json({
        success: true,
        data: {
          last_sync_attempt: null,
          next_sync_estimated: null,
          status: 'no_sync_yet'
        }
      });
    }
    
    // Calculate next sync (3 hours after last attempt)
    const lastSyncTime = new Date(lastSync.started_at || lastSync.timestamp);
    const nextSyncTime = new Date(lastSyncTime.getTime() + (3 * 60 * 60 * 1000)); // +3 hours
    
    res.json({
      success: true,
      data: {
        last_sync_attempt: lastSync.started_at || lastSync.timestamp,
        last_sync_status: lastSync.status,
        last_sync_completed: lastSync.completed_at,
        users_synced: lastSync.users_synced,
        total_users: lastSync.total_users,
        new_runs: lastSync.new_runs,
        next_sync_estimated: nextSyncTime.toISOString(),
        error_message: lastSync.error_message
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to get last sync info:', error);
    res.status(500).json({ error: 'Failed to get sync info' }); return;
  }
});

export default router;
