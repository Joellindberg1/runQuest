// 🔗 Strava Integration Routes
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { calculateRunXP, metersToKm, getLevelFromXP } from '../utils/xpCalculation.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';

const router = express.Router();

// GET /api/strava/config - Get Strava client ID
router.get('/config', async (req, res) => {
  try {
    console.log('⚙️ Strava config requested');
    
    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: 'Strava client ID not configured' });
    }
    
    res.json({ client_id: clientId });
  } catch (error) {
    console.error('❌ Strava config error:', error);
    res.status(500).json({ error: 'Failed to get Strava config' });
  }
});

// GET /api/strava/status - Check user's Strava connection status  
router.get('/status', authenticateJWT, async (req, res) => {
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
      return res.json({ connected: false, expired: false });
    }
    
    const now = Math.floor(Date.now() / 1000);
    const expired = tokens.expires_at ? tokens.expires_at < now : false;
    
    // Om token är expired, försök auto-refresh
    if (expired && tokens.refresh_token) {
      console.log('🔄 Token expired, attempting auto-refresh...');
      
      const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
      if (refreshResult.success) {
        console.log('✅ Token auto-refreshed successfully');
        return res.json({
          connected: true,
          expired: false, // No longer expired after refresh
          auto_refreshed: true
        });
      } else {
        console.log('❌ Auto-refresh failed, connection truly expired');
        return res.json({
          connected: true,
          expired: true,
          refresh_failed: true
        });
      }
    }
    
    console.log('✅ Strava status:', { connected: true, expired, expires_at: tokens.expires_at });
    
    res.json({
      connected: true,
      expired,
      expires_at: tokens.expires_at
    });
    
  } catch (error) {
    console.error('❌ Strava status error:', error);
    res.status(500).json({ error: 'Failed to check Strava status' });
  }
});

// POST /api/strava/callback - Handle Strava OAuth callback
router.post('/callback', authenticateJWT, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user!.user_id;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }
    
    console.log(`🔗 Processing Strava callback for user: ${req.user!.name}`);
    console.log(`🔑 Auth code: ${code.substring(0, 10)}...`);
    
    // Exchange code for access token
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Strava credentials not configured' });
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
      return res.status(400).json({ error: 'Failed to exchange authorization code' });
    }
    
    console.log('✅ Strava tokens received:', {
      access_token: tokenData.access_token ? `${tokenData.access_token.substring(0, 10)}...` : 'missing',
      expires_at: tokenData.expires_at
    });
    
    // Save tokens to database
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
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
      return res.status(500).json({ error: 'Failed to save Strava connection' });
    }
    
    console.log('✅ Strava tokens saved successfully');
    
    res.json({
      success: true,
      message: 'Strava connected successfully',
      athlete: tokenData.athlete
    });
    
  } catch (error) {
    console.error('❌ Strava callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/strava/disconnect - Disconnect Strava account
router.delete('/disconnect', authenticateJWT, async (req, res) => {
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
      return res.status(500).json({ error: 'Failed to disconnect Strava' });
    }
    
    console.log('✅ Strava disconnected successfully');
    res.json({
      success: true,
      message: 'Strava disconnected successfully'
    });
    
  } catch (error) {
    console.error('❌ Strava disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: result.error });
    }
    
  } catch (error) {
    console.error('❌ Manual Strava sync error:', error);
    res.status(500).json({ error: 'Failed to sync Strava activities' });
  }
});

// GET /api/strava/sync-all - Sync all connected users (internal endpoint)
router.get('/sync-all', async (req, res) => {
  try {
    console.log('🔄 Starting automatic Strava sync for all connected users...');
    
    const supabase = getSupabaseClient();
    
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
      return res.status(500).json({ error: 'Failed to fetch connected users' });
    }
    
    if (!connectedUsers || connectedUsers.length === 0) {
      console.log('ℹ️ No users with Strava connections found');
      return res.json({ 
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
    res.status(500).json({ error: 'Failed to sync Strava activities' });
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
    
    // Get user's Strava tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('*')
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
    
    // Fetch activities from Strava (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const after = Math.floor(thirtyDaysAgo.getTime() / 1000);
    
    console.log(`📅 Fetching activities after: ${new Date(after * 1000).toISOString()}`);
    
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
    
    let importedRuns = 0;
    
    // Process each running activity
    for (const activity of runningActivities) {
      try {
        const distance = activity.distance / 1000; // Convert meters to kilometers
        const date = activity.start_date_local.split('T')[0]; // Get date part only
        
        // Skip runs with 0 distance
        if (distance <= 0) {
          console.log(`⚠️ Skipping activity ${activity.id} with 0 distance`);
          continue;
        }
        
        console.log(`🏃‍♂️ Processing run: ${distance.toFixed(2)}km on ${date}`);
        
        // Use centralized XP calculation
        const totalXP = calculateRunXP(distance);
        
        // Get user's current streak (simplified)
        const { data: lastRun } = await supabase
          .from('runs')
          .select('streak_day')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(1)
          .single();
        
        const streakDay = (lastRun?.streak_day || 0) + 1;
        const streakMultiplier = streakDay >= 5 ? 1.1 : 1.0;
        const finalXP = Math.round(totalXP * streakMultiplier);
        
        // Save to database with Strava external_id (simplified schema)
        const { error: insertError } = await supabase
          .from('runs')
          .insert({
            user_id: userId,
            date: date,
            distance: distance,
            xp_gained: finalXP,  // Use correct 'xp_gained' field
            source: 'strava',
            external_id: activity.id.toString()
          });
        
        if (insertError) {
          console.error(`❌ Failed to save run ${activity.id}:`, insertError);
        } else {
          importedRuns++;
          console.log(`✅ Imported run: ${distance.toFixed(2)}km, ${finalXP} XP`);
        }
        
      } catch (activityError) {
        console.error(`❌ Error processing activity ${activity.id}:`, activityError);
      }
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

export default router;