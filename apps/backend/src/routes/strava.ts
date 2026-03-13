// 🔗 Strava Integration Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { reprocessRunsFromDate } from './runs.js';
import { getSyncInfo } from '../scheduler/stravaSync.js';

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const RUNNING_SPORT_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

/** Returns the sport_type if it's a valid running type, otherwise null. */
function normalizeSportType(sportType?: string): string | null {
  if (sportType && RUNNING_SPORT_TYPES.has(sportType)) return sportType;
  return null;
}

/** Returns true for any Strava activity we want to import as a run. */
function isRunningActivity(activity: any): boolean {
  // Prefer sport_type (newer field); fall back to type for older data
  if (activity.sport_type) return RUNNING_SPORT_TYPES.has(activity.sport_type);
  return activity.type === 'Run';
}

/**
 * Compute pace standard deviation (sec/km) from Strava splits_metric.
 * Returns null if there are fewer than 2 complete splits.
 */
function computePaceStdDev(splits?: Array<{ distance: number; moving_time: number }>): number | null {
  if (!splits || splits.length < 2) return null;
  const paces = splits
    .filter(s => s.distance > 0)
    .map(s => s.moving_time / (s.distance / 1000));
  if (paces.length < 2) return null;
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const variance = paces.reduce((sum, p) => sum + (p - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance);
}

/** Build the extended-data fields from a Strava activity object. */
function extractExtendedFields(activity: any) {
  return {
    start_time:     activity.start_date_local ?? null,
    moving_time:    activity.moving_time       ?? null,
    total_elevation_gain: activity.total_elevation_gain ?? null,
    sport_type:     normalizeSportType(activity.sport_type),
    avg_heartrate:  activity.average_heartrate ?? null,
    max_heartrate:  activity.max_heartrate     ?? null,
    suffer_score:   activity.suffer_score      ?? null,
    start_lat:      activity.start_latlng?.[0] ?? null,
    start_lng:      activity.start_latlng?.[1] ?? null,
    pace_std_dev:   computePaceStdDev(activity.splits_metric),
  };
}

// GET /api/strava/config - Get Strava client ID
router.get('/config', async (_req, res): Promise<void> => {
  try {
    logger.info('⚙️ Strava config requested');
    
    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: 'Strava client ID not configured' }); return;
    }
    
    res.json({ client_id: clientId }); return;
  } catch (error) {
    logger.error('❌ Strava config error:', error);
    res.status(500).json({ error: 'Failed to get Strava config' }); return;
  }
});

// GET /api/strava/status - Check user's Strava connection status  
router.get('/status', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    logger.info('🔍 Checking Strava status for user:', req.user!.name);
    
    const supabase = getSupabaseClient();
    const { data: tokens, error } = await supabase
      .from('strava_tokens')
      .select('expires_at, refresh_token, connection_date')
      .eq('user_id', userId)
      .single();
    
    if (error || !tokens) {
      logger.info('❌ No Strava tokens found for user');
      res.json({ connected: false, expired: false }); return;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const expired = tokens.expires_at ? tokens.expires_at < now : false;
    
    // Om token är expired, försök auto-refresh
    if (expired && tokens.refresh_token) {
      logger.info('🔄 Token expired, attempting auto-refresh...');
      
      const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
      if (refreshResult.success) {
        logger.info('✅ Token auto-refreshed successfully');
        res.json({
          connected: true,
          expired: false, // No longer expired after refresh
          auto_refreshed: true
        });
      } else {
        logger.info('❌ Auto-refresh failed, connection truly expired');
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

    logger.info('🔍 Last global sync query result:', { lastGlobalStravaRun, syncError });

    logger.info('✅ Strava status:', { connected: true, expired, expires_at: tokens.expires_at });
    
    res.json({
      connected: true,
      expired,
      expires_at: tokens.expires_at,
      connection_date: tokens.connection_date,
      last_sync: lastGlobalStravaRun?.created_at || null
    });
    
  } catch (error) {
    logger.error('❌ Strava status error:', error);
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
    
    logger.info(`🔗 Processing Strava callback for user: ${req.user!.name}`);
    logger.info(`🔑 Auth code: ${code.substring(0, 10)}...`);
    
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
      logger.error('❌ Strava token exchange failed:', tokenData);
      res.status(400).json({ error: 'Failed to exchange authorization code' }); return;
    }
    
    logger.info('✅ Strava tokens received:', {
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
      });

    if (error) {
      logger.error('❌ Failed to save Strava tokens:', error);
      res.status(500).json({ error: 'Failed to save Strava connection' }); return;
    }
    
    logger.info('✅ Strava tokens saved successfully');
    
    res.json({
      success: true,
      message: 'Strava connected successfully',
      athlete: tokenData.athlete
    });
    
  } catch (error) {
    logger.error('❌ Strava callback error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// DELETE /api/strava/disconnect - Disconnect Strava account
router.delete('/disconnect', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    logger.info(`🔌 Disconnecting Strava for user: ${req.user!.name}`);
    
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('strava_tokens')
      .delete()
      .eq('user_id', userId);
    
    if (error) {
      logger.error('❌ Failed to delete Strava tokens:', error);
      res.status(500).json({ error: 'Failed to disconnect Strava' }); return;
    }
    
    logger.info('✅ Strava disconnected successfully');
    res.json({
      success: true,
      message: 'Strava disconnected successfully'
    });
    
  } catch (error) {
    logger.error('❌ Strava disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' }); return;
  }
});

// POST /api/strava/sync - Manually sync Strava activities
router.post('/sync', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user!.user_id;
    logger.info(`🔄 Manual Strava sync requested for user: ${req.user!.name}`);
    
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
    logger.error('❌ Manual Strava sync error:', error);
    res.status(500).json({ error: 'Failed to sync Strava activities' }); return;
  }
});

// GET /api/strava/debug-activities - Debug endpoint to see what Strava returns
router.get('/debug-activities', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const supabase = getSupabaseClient();
    
    // Get user's Strava tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at, connection_date')
      .eq('user_id', userId)
      .single();
    
    if (tokenError || !tokens) {
      res.status(400).json({ error: 'User not connected to Strava' }); return;
    }
    
    // Check if token is expired and refresh if needed
    const now = Math.floor(Date.now() / 1000);
    let accessToken = tokens.access_token;
    
    if (tokens.expires_at && tokens.expires_at < now) {
      logger.info('🔄 Access token expired, refreshing...');
      const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
      if (!refreshResult.success) {
        res.status(400).json({ error: 'Failed to refresh Strava token' }); return;
      }
      accessToken = refreshResult.access_token;
    }
    
    // Get existing runs from database
    const { data: existingRuns } = await supabase
      .from('runs')
      .select('external_id, date, distance, source')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .not('external_id', 'is', null);
    
    const existingIds = new Set(existingRuns?.map((run: any) => run.external_id) || []);
    
    // Calculate smart 'after' timestamp (same logic as sync)
    let after: number;
    let afterCalculationMethod: string;
    
    if (existingRuns && existingRuns.length > 0) {
      // Find the most recent imported run date
      const dates = existingRuns.map((run: any) => new Date(run.date).getTime());
      const mostRecentRunDate = new Date(Math.max(...dates));
      
      // Go back 7 days from most recent run
      const sevenDaysBeforeMostRecent = new Date(mostRecentRunDate);
      sevenDaysBeforeMostRecent.setDate(sevenDaysBeforeMostRecent.getDate() - 7);
      sevenDaysBeforeMostRecent.setHours(0, 0, 0, 0);
      after = Math.floor(sevenDaysBeforeMostRecent.getTime() / 1000);
      
      afterCalculationMethod = `Most recent run (${mostRecentRunDate.toISOString().split('T')[0]}) minus 7 days`;
    } else if (tokens.connection_date) {
      const connectionDate = new Date(tokens.connection_date);
      connectionDate.setHours(0, 0, 0, 0);
      after = Math.floor(connectionDate.getTime() / 1000);
      afterCalculationMethod = 'Connection date (no existing runs)';
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      after = Math.floor(thirtyDaysAgo.getTime() / 1000);
      afterCalculationMethod = '30 days ago (fallback)';
    }
    
    // Fetch from Strava with increased limit
    const stravaResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (!stravaResponse.ok) {
      const errorData = await stravaResponse.json();
      res.status(500).json({ error: 'Strava API error', details: errorData }); return;
    }
    
    const activities = await stravaResponse.json();
    
    // Filter for runs
    const runningActivities = activities.filter((a: any) => isRunningActivity(a));
    const newRuns = runningActivities.filter((a: any) => !existingIds.has(a.id.toString()));
    
    res.json({
      connection_date: tokens.connection_date,
      after_timestamp: after,
      after_date: new Date(after * 1000).toISOString(),
      after_calculation_method: afterCalculationMethod,
      total_activities: activities.length,
      running_activities: runningActivities.length,
      existing_run_ids: Array.from(existingIds),
      existing_runs_count: existingIds.size,
      new_runs_count: newRuns.length,
      all_activities: activities.map((a: any) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        distance: (a.distance / 1000).toFixed(2) + 'km',
        date: a.start_date_local.split('T')[0],
        already_imported: existingIds.has(a.id.toString())
      })),
      new_runs: newRuns.map((a: any) => ({
        id: a.id,
        name: a.name,
        distance: (a.distance / 1000).toFixed(2) + 'km',
        date: a.start_date_local.split('T')[0]
      }))
    });
    
  } catch (error) {
    logger.error('❌ Debug activities error:', error);
    res.status(500).json({ error: 'Failed to debug activities' }); return;
  }
});

// Simple sync logging using file system (temporary solution)

/**
 * Sync all Strava-connected users. Used by the scheduler and the admin HTTP endpoint.
 * Exported so the scheduler can call this directly without an HTTP roundtrip.
 */
export async function syncAllStravaUsers(): Promise<{
  success: boolean;
  message: string;
  syncedUsers: number;
  totalUsers: number;
  totalNewRuns: number;
  results: Array<{ userId: string; userName: string; newRuns?: number; totalActivities?: number; error?: string }>;
}> {
  const supabase = getSupabaseClient();

  try {
    logger.info('🔄 Starting Strava sync for all connected users...');

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
      throw new Error(`Failed to fetch connected users: ${error.message}`);
    }

    if (!connectedUsers || connectedUsers.length === 0) {
      logger.info('ℹ️ No users with Strava connections found');
      return { success: true, message: 'No users to sync', syncedUsers: 0, totalUsers: 0, totalNewRuns: 0, results: [] };
    }

    logger.info(`🔍 Found ${connectedUsers.length} users with Strava connections`);

    let totalSyncedUsers = 0;
    let totalNewRuns = 0;
    const results: Array<{ userId: string; userName: string; newRuns?: number; totalActivities?: number; error?: string }> = [];

    for (const user of connectedUsers) {
      try {
        logger.info(`🔄 Syncing user: ${user.users.name}`);
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
          logger.info(`✅ Synced ${result.newRuns} new runs for ${user.users.name}`);
        } else {
          logger.error(`❌ Failed to sync ${user.users.name}:`, result.error);
          results.push({ userId: user.user_id, userName: user.users.name, error: result.error });
        }

        // Small delay between users to stay within Strava rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (userError) {
        logger.error(`❌ Error syncing user ${user.users.name}:`, userError);
        results.push({ userId: user.user_id, userName: user.users.name, error: 'Sync failed' });
      }
    }

    logger.info(`🎯 Sync completed: ${totalSyncedUsers}/${connectedUsers.length} users, ${totalNewRuns} new runs`);

    return {
      success: true,
      message: `Synced ${totalSyncedUsers} users with ${totalNewRuns} new runs`,
      syncedUsers: totalSyncedUsers,
      totalUsers: connectedUsers.length,
      totalNewRuns,
      results
    };

  } catch (error) {
    logger.error('❌ Strava sync-all error:', error);
    throw error;
  }
}

// GET /api/strava/last-sync - Get info about the last and next scheduled sync
router.get('/last-sync', async (_req, res): Promise<void> => {
  try {
    const info = getSyncInfo();
    res.json({
      data: {
        last_sync_attempt: info.lastSyncAttempt,
        last_sync_status: info.lastSyncStatus,
        next_sync_estimated: info.nextSyncEstimated,
        users_synced: info.usersSynced,
        total_users: info.totalUsers,
        new_runs: info.newRuns,
      }
    });
  } catch (error) {
    logger.error('❌ Error fetching sync info:', error);
    res.status(500).json({ error: 'Failed to get sync info' });
  }
});

// POST /api/strava/backfill-extended - Admin: re-fetch all Strava activities and fill extended fields
router.post('/backfill-extended', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const supabase = getSupabaseClient();
    const { data: connectedUsers, error } = await supabase
      .from('strava_tokens')
      .select('user_id, access_token, refresh_token, expires_at, connection_date, users!inner(name)')
      .not('access_token', 'is', null);

    if (error || !connectedUsers?.length) {
      res.json({ success: true, message: 'No connected users', updated: 0 }); return;
    }

    let totalUpdated = 0;
    const summary: Array<{ user: string; updated: number; error?: string }> = [];

    for (const user of connectedUsers) {
      try {
        // Refresh token if expired
        const now = Math.floor(Date.now() / 1000);
        let accessToken = user.access_token;
        if (user.expires_at && user.expires_at < now) {
          const refreshed = await refreshStravaToken(user.refresh_token, user.user_id);
          if (!refreshed.success) throw new Error('Token refresh failed');
          accessToken = refreshed.access_token!;
        }

        // Get all existing Strava runs for this user
        const { data: existingRuns } = await supabase
          .from('runs')
          .select('id, external_id')
          .eq('user_id', user.user_id)
          .eq('source', 'strava')
          .not('external_id', 'is', null);

        if (!existingRuns?.length) {
          summary.push({ user: (user.users as any).name, updated: 0 });
          continue;
        }

        const externalIdToRunId = new Map(existingRuns.map((r: any) => [r.external_id, r.id]));

        // Fetch all activities from Strava (paginated)
        const after = user.connection_date
          ? Math.floor(new Date(user.connection_date).getTime() / 1000)
          : Math.floor(Date.now() / 1000) - 365 * 24 * 3600; // fallback: 1 year ago

        let page = 1;
        let userUpdated = 0;

        while (true) {
          const stravaRes = await fetch(
            `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200&page=${page}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!stravaRes.ok) break;
          const activities: any[] = await stravaRes.json();
          if (!activities.length) break;

          // Update matching runs in batches of 10
          const matches = activities.filter((a: any) => externalIdToRunId.has(a.id.toString()));
          for (let i = 0; i < matches.length; i += 10) {
            const batch = matches.slice(i, i + 10);
            const results = await Promise.allSettled(batch.map(async (activity: any) => {
              const fields = extractExtendedFields(activity);
              const runId = externalIdToRunId.get(activity.id.toString());
              const { error } = await supabase.from('runs').update(fields).eq('id', runId);
              if (error) {
                logger.error(`❌ Failed to update run ${runId} (activity ${activity.id}): ${error.message}`, { fields });
                throw error;
              }
            }));
            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            if (failed > 0) logger.error(`❌ ${failed}/${batch.length} updates failed in batch`);
            userUpdated += succeeded;
            if (i + 10 < matches.length) await new Promise(r => setTimeout(r, 500));
          }

          if (activities.length < 200) break;
          page++;
          await new Promise(r => setTimeout(r, 1000)); // rate limit between pages
        }

        totalUpdated += userUpdated;
        summary.push({ user: (user.users as any).name, updated: userUpdated });
        logger.info(`✅ Backfilled ${userUpdated} runs for ${(user.users as any).name}`);
      } catch (userErr) {
        logger.error(`❌ Backfill failed for user:`, userErr);
        summary.push({ user: (user.users as any).name, updated: 0, error: 'Failed' });
      }

      await new Promise(r => setTimeout(r, 2000)); // delay between users
    }

    logger.info(`🎯 Backfill complete: ${totalUpdated} runs updated across ${connectedUsers.length} users`);
    res.json({ success: true, totalUpdated, summary });
  } catch (error) {
    logger.error('❌ Backfill error:', error);
    res.status(500).json({ error: 'Backfill failed' }); return;
  }
});

// GET /api/strava/sync-all - Admin-only endpoint to trigger a full sync
router.get('/sync-all', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const result = await syncAllStravaUsers();
    res.json(result);
  } catch (error) {
    logger.error('❌ API Error in /strava/sync-all:', error);
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
      logger.info('🔄 Access token expired, refreshing...');
      
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
    
    logger.info(`💾 Found ${existingRuns?.length || 0} existing Strava runs in database`);
    if (existingRuns && existingRuns.length > 0) {
      existingRuns.forEach((run: any) => {
        logger.info(`  - External ID: ${run.external_id}, Date: ${run.date}, Distance: ${run.distance}km`);
      });
    }
    
    const existingIds = new Set(existingRuns?.map((run: any) => run.external_id) || []);
    
    // Calculate smart 'after' timestamp based on most recent imported run
    let after: number;
    
    if (existingRuns && existingRuns.length > 0) {
      // Find the most recent imported run date
      const dates = existingRuns.map((run: any) => new Date(run.date).getTime());
      const mostRecentRunDate = new Date(Math.max(...dates));
      
      // Go back 7 days from most recent run to catch any missed activities
      const sevenDaysBeforeMostRecent = new Date(mostRecentRunDate);
      sevenDaysBeforeMostRecent.setDate(sevenDaysBeforeMostRecent.getDate() - 7);
      sevenDaysBeforeMostRecent.setHours(0, 0, 0, 0);
      after = Math.floor(sevenDaysBeforeMostRecent.getTime() / 1000);
      
      logger.info(`📅 Most recent imported run: ${mostRecentRunDate.toISOString().split('T')[0]}`);
      logger.info(`📅 Fetching activities from 7 days before that: ${sevenDaysBeforeMostRecent.toISOString().split('T')[0]}`);
    } else if (tokens.connection_date) {
      // No existing runs, use connection date
      const connectionDate = new Date(tokens.connection_date);
      connectionDate.setHours(0, 0, 0, 0);
      after = Math.floor(connectionDate.getTime() / 1000);
      logger.info(`📅 No existing runs, using connection date: ${connectionDate.toISOString().split('T')[0]}`);
    } else {
      // Fallback to 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      after = Math.floor(thirtyDaysAgo.getTime() / 1000);
      logger.info(`⚠️ No connection date, falling back to 30 days ago: ${thirtyDaysAgo.toISOString().split('T')[0]}`);
    }
    
    logger.info(`📅 Final 'after' timestamp: ${new Date(after * 1000).toISOString()}`);
    
    // Increase per_page to 200 (Strava API max) to catch more activities
    const stravaResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (!stravaResponse.ok) {
      const errorData = await stravaResponse.json();
      logger.error('❌ Strava API error:', errorData);
      return { success: false, error: 'Failed to fetch Strava activities' };
    }
    
    const activities = await stravaResponse.json();
    logger.info(`📊 Fetched ${activities.length} activities from Strava`);
    
    // Log all activities for debugging
    if (activities.length > 0) {
      logger.info('🔍 All activities found:');
      activities.forEach((activity: any, index: number) => {
        const distance = (activity.distance / 1000).toFixed(2);
        const date = activity.start_date_local.split('T')[0];
        logger.info(`  ${index + 1}. ${date}: ${distance}km, Type: ${activity.type}, ID: ${activity.id}`);
      });
    }
    
    // Filter for running activities only (new ones not yet in DB)
    const runningActivities = activities.filter((activity: any) =>
      isRunningActivity(activity) &&
      !existingIds.has(activity.id.toString())
    );
    
    logger.info(`🏃‍♂️ Found ${runningActivities.length} new running activities`);
    logger.info(`🚫 Existing activity IDs in database: [${Array.from(existingIds).join(', ')}]`);
    
    if (runningActivities.length === 0) {
      return { 
        success: true, 
        newRuns: 0, 
        totalActivities: activities.length,
        message: 'No new running activities found'
      };
    }
    
    // Insert all new runs in parallel (placeholder XP — reprocessRunsFromDate will recalculate)
    logger.info(`🔄 Inserting ${runningActivities.length} new runs in parallel...`);

    const validActivities = runningActivities.filter((a: any) => a.distance / 1000 > 0);

    const insertResults = await Promise.allSettled(
      validActivities.map(async (activity: any) => {
        const distance = activity.distance / 1000;
        const date = activity.start_date_local.split('T')[0];
        const fields = extractExtendedFields(activity);
        const { error } = await supabase.from('runs').insert({
          user_id: userId,
          date,
          distance,
          source: 'strava',
          external_id: activity.id.toString(),
          ...fields,
          // XP placeholders — recalculated by reprocessRunsFromDate
          base_xp: 0,
          km_xp: 0,
          distance_bonus: 0,
          streak_bonus: 0,
          multiplier: 1.0,
          streak_day: 1,
          xp_gained: 0,
          created_at: new Date().toISOString()
        });
        if (error) {
          logger.error(`❌ Failed to insert run (activity ${activity.id}): ${error.message}`, { fields });
          throw error;
        }
      })
    );

    const importedRuns = insertResults.filter(r => r.status === 'fulfilled').length;
    const failedCount = insertResults.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      logger.error(`❌ ${failedCount} runs failed to insert`);
    }

    logger.info(`✅ Inserted ${importedRuns} new runs`);

    if (importedRuns > 0) {
      // Reprocess from earliest new run date — one pass fixes streaks + XP for all affected runs
      const dates = validActivities
        .map((a: any) => a.start_date_local.split('T')[0])
        .sort();
      const earliestDate = dates[0];
      logger.info(`🔄 Reprocessing from ${earliestDate} to recalculate streaks and XP...`);
      await reprocessRunsFromDate(userId, earliestDate);
      await calculateUserTotals(userId);
    }

    return {
      success: true,
      newRuns: importedRuns,
      totalActivities: activities.length,
      message: `Successfully imported ${importedRuns} new runs from Strava`
    };

  } catch (error) {
    logger.error('❌ Error syncing Strava activities:', error);
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
      logger.error('❌ Token refresh failed:', tokenData);
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
      logger.error('❌ Failed to update refreshed tokens:', error);
      return { success: false, error: 'Failed to save new tokens' };
    }
    
    logger.info('✅ Strava token refreshed successfully');
    return { 
      success: true, 
      access_token: tokenData.access_token 
    };
    
  } catch (error) {
    logger.error('❌ Token refresh error:', error);
    return { success: false, error: 'Token refresh failed' };
  }
}

export default router;
