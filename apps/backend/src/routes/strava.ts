// 🔗 Strava Integration Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { calculateUserTotals } from '../utils/calculateUserTotals.js';
import { reprocessRunsFromDate } from './runs.js';
import { getXpConfig } from '../services/xpConfig.js';
import { isTreadmillActivity } from '../utils/stravaActivity.js';
import { calculateCompleteRunXP, STRAVA_CONSENT_VERSION } from '@runquest/shared';
import type { StravaCallbackRequest, StravaCallbackResponse, StravaStatusResponse } from '@runquest/shared';
import { checkEventQualification } from '../services/eventService.js';
import { getSyncInfo } from '../scheduler/stravaSync.js';
import { WeatherService } from '../services/weatherService.js';
import { stravaLookback } from '../utils/stravaLookback.js';
import { isValidAthleteId } from '../services/stravaAthlete.js';
import { fetchAthleteActivities, fetchDetailedActivity, getValidAccessToken, stravaFetch, type AccessTokenResult } from '../services/stravaClient.js';
import { exceedsImportDistance, extractExtendedFields, importStravaActivity, isRunningActivity, type ImportedRun } from '../services/stravaImport.js';

const router = express.Router();

/** The message the sync and the debug endpoint give for a token that could not be had. */
function tokenFailureMessage(token: Extract<AccessTokenResult, { ok: false }>): string {
  return token.reason === 'not_connected' ? 'User not connected to Strava' : 'Failed to refresh Strava token';
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
    
    const token = await getValidAccessToken(userId);

    if (!token.ok && token.reason === 'not_connected') {
      logger.info('❌ No Strava tokens found for user');
      const notConnected: StravaStatusResponse = { connected: false, expired: false };
      res.json(notConnected); return;
    }

    // Om token är expired förnyar getValidAccessToken den (auto-refresh)
    if (token.ok && token.refreshed) {
      logger.info('✅ Token auto-refreshed successfully');
      const refreshed: StravaStatusResponse = {
        connected: true,
        expired: false, // No longer expired after refresh
        auto_refreshed: true,
        consent_version: token.consentVersion
      };
      res.json(refreshed);
      return; // utan denna skickades ett andra res.json nedan (ERR_HTTP_HEADERS_SENT)
    }
    if (!token.ok && token.reason === 'refresh_failed') {
      logger.info('❌ Auto-refresh failed, connection truly expired');
      const refreshFailed: StravaStatusResponse = {
        connected: true,
        expired: true,
        refresh_failed: true,
        consent_version: token.consentVersion
      };
      res.json(refreshFailed);
      return;
    }

    const expired = !token.ok; // kvar här: antingen giltig, eller utgången utan refresh-token
    const supabase = getSupabaseClient();

    // Get last global sync time (based on most recent Strava run imported by anyone)
    const { data: lastGlobalStravaRun, error: syncError } = await supabase
      .from('runs')
      .select('created_at')
      .eq('source', 'strava')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    logger.info('🔍 Last global sync query result:', { lastGlobalStravaRun, syncError });

    logger.info('✅ Strava status:', { connected: true, expired, expires_at: token.expiresAt });
    
    const body: StravaStatusResponse = {
      connected: true,
      expired,
      // Raderna lagrar null när Strava inte gav något värde; svaret är som före utbrytningen (typen säger undefined).
      expires_at: token.expiresAt as number | undefined,
      connection_date: token.connectionDate as string | undefined,
      last_sync: lastGlobalStravaRun?.created_at || null,
      // null för kopplingar som gjordes före samtyckesloggen (ADR 010 beslut 12, D4).
      consent_version: token.consentVersion
    };
    res.json(body);
    
  } catch (error) {
    logger.error('❌ Strava status error:', error);
    res.status(500).json({ error: 'Failed to check Strava status' }); return;
  }
});

// POST /api/strava/callback - Handle Strava OAuth callback
router.post('/callback', authenticateJWT, async (req, res): Promise<void> => {
  try {
    // Opålitlig indata: fälten kan saknas eller ha fel typ, därför Partial och en strikt jämförelse nedan.
    const { code, consent_version: consentVersion }: Partial<StravaCallbackRequest> = req.body;
    const userId = req.user!.user_id;

    if (!code) {
      res.status(400).json({ error: 'Authorization code required' }); return;
    }

    // Samtycket krävs innan koden byts mot token hos Strava (ADR 010 beslut 12). consented_at skickas aldrig av klienten.
    if (consentVersion !== STRAVA_CONSENT_VERSION) {
      logger.warn('⚠️ Strava callback without current consent_version', { user_id: userId, has_consent_version: consentVersion !== undefined && consentVersion !== null });
      res.status(400).json({ error: 'Consent required' }); return;
    }
    
    logger.info(`🔗 Processing Strava callback for user: ${req.user!.name}`);
    
    // Exchange code for access token
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      res.status(500).json({ error: 'Strava credentials not configured' }); return;
    }
    
    const tokenResponse = await stravaFetch('https://www.strava.com/oauth/token', {
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
    
    // Aldrig någon del av token-värdet i loggen — bara om den finns.
    logger.info('✅ Strava tokens received:', {
      has_access_token: Boolean(tokenData.access_token),
      expires_at: tokenData.expires_at
    });
    
    // Stravas athlete-id kopplar webhook-händelser (owner_id) till användaren. Saknas det sparas kopplingen ändå
    // (den syns som "unmapped" i hälsokontrollen), men det är ett fel: utan id når inga händelser, inte heller raderingar.
    const athleteId = tokenData.athlete?.id;
    const hasAthleteId = isValidAthleteId(athleteId);
    if (!hasAthleteId) {
      logger.error('❌ Strava token response has no usable athlete id; connection saved without strava_athlete_id', {
        user_id: userId,
        has_athlete_object: Boolean(tokenData.athlete)
      });
    }

    // Save tokens to database
    const supabase = getSupabaseClient();
    const connectedAt = new Date().toISOString();
    const { error } = await supabase
      .from('strava_tokens')
      .upsert({
        user_id: userId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        connection_date: connectedAt,
        // Samtyckesloggen: versionen är kontrollerad ovan, tidpunkten sätts av servern. En återanslutning skriver nya värden.
        consent_version: STRAVA_CONSENT_VERSION,
        consented_at: connectedAt,
        // Utelämnas (inte null) när Strava inte skickade något id, så en återanslutning inte raderar ett känt id.
        ...(hasAthleteId ? { strava_athlete_id: athleteId } : {}),
        // En ny anslutning är aldrig pausad.
        sync_paused: false,
        paused_at: null
      });

    if (error?.code === '23505' && `${error.message} ${error.details ?? ''}`.includes('strava_tokens_athlete_id_key')) {
      // Samma Strava-konto är redan kopplat till en annan RunQuest-användare (unikt index, migration 045).
      logger.warn('⚠️ Strava account already connected to another user', { user_id: userId });
      res.status(409).json({ error: 'This Strava account is already connected to another RunQuest user' }); return;
    }

    if (error) {
      logger.error('❌ Failed to save Strava tokens:', error);
      res.status(500).json({ error: 'Failed to save Strava connection' }); return;
    }
    
    logger.info('✅ Strava tokens saved successfully');
    
    // Klienten läser bara om anropet lyckades; Stravas athlete-objekt (profildata) skickas inte vidare.
    const body: StravaCallbackResponse = { success: true, message: 'Strava connected successfully' };
    res.json(body);
    
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
    
    const token = await getValidAccessToken(userId);
    if (!token.ok) {
      res.status(400).json({ error: tokenFailureMessage(token) }); return;
    }
    const accessToken = token.accessToken;

    // Get existing runs from database
    const { data: existingRuns } = await supabase
      .from('runs')
      .select('external_id, date, distance, source')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .not('external_id', 'is', null);
    
    const existingIds = new Set(existingRuns?.map((run: any) => run.external_id) || []);
    
    // Calculate smart 'after' timestamp (same logic as sync)
    const lookback = stravaLookback((existingRuns ?? []).map((run: any) => run.date), token.connectionDate, new Date());
    const after = lookback.after;
    const afterCalculationMethod =
      lookback.method === 'recent-run' ? `Most recent run (${lookback.mostRecentRunDay}) minus 7 days`
      : lookback.method === 'connection-date' ? 'Connection date (no existing runs)'
      : '30 days ago (fallback)';

    // Fetch from Strava with increased limit
    const stravaResponse = await fetchAthleteActivities(accessToken, after);

    if (!stravaResponse.ok) {
      const errorData = await stravaResponse.json();
      res.status(500).json({ error: 'Strava API error', details: errorData }); return;
    }
    
    const activities = await stravaResponse.json();
    
    // Filter for runs
    const runningActivities = activities.filter((a: any) => isRunningActivity(a));
    const newRuns = runningActivities.filter((a: any) => !existingIds.has(a.id.toString()));
    
    res.json({
      connection_date: token.connectionDate,
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
router.get('/last-sync', authenticateJWT, async (_req, res): Promise<void> => {
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
      .select('user_id, users!inner(name)')
      .not('access_token', 'is', null);

    if (error || !connectedUsers?.length) {
      res.json({ success: true, message: 'No connected users', updated: 0 }); return;
    }

    let totalUpdated = 0;
    const summary: Array<{ user: string; updated: number; error?: string }> = [];

    for (const user of connectedUsers) {
      try {
        const token = await getValidAccessToken(user.user_id);
        if (!token.ok) throw new Error('Token refresh failed');
        const accessToken = token.accessToken;

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

        const externalIdToRunId = new Map<string, string>(existingRuns.map((r: any) => [r.external_id, r.id] as [string, string]));

        // Fetch each activity individually (detail endpoint includes splits_metric)
        let userUpdated = 0;
        const externalIds = Array.from(externalIdToRunId.keys());

        for (let i = 0; i < externalIds.length; i += 10) {
          const batch = externalIds.slice(i, i + 10);
          const results = await Promise.allSettled(batch.map(async (externalId: string) => {
            const activity = await fetchDetailedActivity(externalId, accessToken);
            if (!activity) return;
            const fields = extractExtendedFields(activity);
            const runId = externalIdToRunId.get(externalId);
            const { error } = await supabase.from('runs').update(fields).eq('id', runId);
            if (error) {
              logger.error(`❌ Failed to update run ${runId} (activity ${externalId}): ${error.message}`, { fields });
              throw error;
            }
          }));
          const succeeded = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          if (failed > 0) logger.error(`❌ ${failed}/${batch.length} updates failed in batch`);
          userUpdated += succeeded;
          if (i + 10 < externalIds.length) await new Promise(r => setTimeout(r, 1000)); // rate limit
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
  // Äldsta datum bland importerade rundor som aldrig fick sin XP (se självläkningen nedan); consumed = den nya importens omräkning tog över.
  let healFrom: string | null = null;
  let healConsumed = false;
  try {
    const supabase = getSupabaseClient();

    const token = await getValidAccessToken(userId);
    if (!token.ok) {
      return { success: false, error: tokenFailureMessage(token) };
    }
    const accessToken = token.accessToken;

    // Get existing runs to avoid duplicates
    const { data: existingRuns, error: runsError } = await supabase
      .from('runs')
      .select('external_id, date, distance, xp_gained')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .not('external_id', 'is', null);

    if (runsError) {
      return { success: false, error: 'Failed to fetch existing runs' };
    }

    // Självläkning (RUN-215): en import vars omräkning felade lämnar rader med placeholder-XP 0, och nästa synk ser
    // dem som "redan importerade" och räknar aldrig om dem. Läk bara rader som BORDE ha XP > 0 (samma beräkning och
    // inställningar som reprocess) men har xp_gained ≤ 0 — en 0.3 km-runda ger legitimt 0 XP och skulle annars trigga
    // en omräkning + calculateUserTotals vid varje synk. Distansspärren gör att inställningarna bara läses när det
    // finns en kandidat. Själva läkningen körs senare (`finally`) eller, om synken importerar nya rundor, i deras
    // omräkning från det tidigaste av de två datumen — aldrig två gånger.
    // Begränsning: förväntad XP räknas utan streak-/boost-effekt (streakdag 1, boost 0); en runda vars XP bara blev 0
    // av en negativ boost kan därför läkas i onödan (ofarligt: omräkningen är idempotent).
    const zeroXpCandidates = (existingRuns ?? []).filter((run: any) => !(Number(run.xp_gained) > 0) && Number(run.distance) > 0);
    if (zeroXpCandidates.length > 0) {
      try {
        const { settings, streak_multipliers } = await getXpConfig();
        const unprocessed = zeroXpCandidates.filter(
          (run: any) => calculateCompleteRunXP(Number(run.distance), 1, settings, streak_multipliers, 0).finalXP > 0,
        );
        if (unprocessed.length > 0) {
          healFrom = unprocessed.map((run: any) => run.date as string).sort()[0];
          logger.warn(`⚠️ ${unprocessed.length} imported Strava run(s) have placeholder XP 0 — will reprocess from ${healFrom}`);
        }
      } catch (configError) {
        logger.error(`❌ Could not evaluate Strava runs for self-heal (user ${userId}):`, configError);
      }
    }
    
    logger.info(`💾 Found ${existingRuns?.length || 0} existing Strava runs in database`);
    if (existingRuns && existingRuns.length > 0) {
      existingRuns.forEach((run: any) => {
        logger.info(`  - External ID: ${run.external_id}, Date: ${run.date}, Distance: ${run.distance}km`);
      });
    }
    
    const existingIds = new Set(existingRuns?.map((run: any) => run.external_id) || []);
    
    // Calculate smart 'after' timestamp based on most recent imported run
    // Window start is a Stockholm calendar day (stravaLookback), not the server process's local midnight
    const lookback = stravaLookback((existingRuns ?? []).map((run: any) => run.date), token.connectionDate, new Date());
    const after = lookback.after;

    if (lookback.method === 'recent-run') {
      logger.info(`📅 Most recent imported run: ${lookback.mostRecentRunDay}`);
      logger.info(`📅 Fetching activities from 7 days before that: ${lookback.anchorDay}`);
    } else if (lookback.method === 'connection-date') {
      logger.info(`📅 No existing runs, using connection date: ${lookback.anchorDay}`);
    } else {
      logger.info(`⚠️ No connection date, falling back to 30 days ago: ${lookback.anchorDay}`);
    }

    logger.info(`📅 Final 'after' timestamp: ${new Date(after * 1000).toISOString()}`);
    
    // per_page 200 (Strava API max) to catch more activities
    const stravaResponse = await fetchAthleteActivities(accessToken, after);

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

    const validActivities = runningActivities.filter(exceedsImportDistance);

    const insertResults = await Promise.allSettled(
      validActivities.map((activity: any) => importStravaActivity(userId, activity, accessToken))
    );

    // 'exists' = another import (the webhook worker) got there first: neither new nor a failure.
    const importedResults = insertResults.flatMap(r => (r.status === 'fulfilled' && r.value.status === 'imported' ? [r.value.run] : []));
    const importedRuns = importedResults.length;
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
      // Läkningen (om någon) ingår i samma omräkning: det tidigaste av läkningsdatumet och importdatumet, en gång.
      const earliestDate = healFrom && healFrom < dates[0] ? healFrom : dates[0];
      healConsumed = true;
      logger.info(`🔄 Reprocessing from ${earliestDate} to recalculate streaks and XP...`);
      // Ett omräkningsfel avbryter inte resten: totaler, väder och eventkvalificering körs best-effort (annars är datat
      // sämre än före RUN-215), och synken rapporteras som misslyckad. Rader med XP 0 läks av nästa synk (se ovan).
      let reprocessError: unknown = null;
      try {
        await reprocessRunsFromDate(userId, earliestDate);
      } catch (e) {
        reprocessError = e;
        logger.error(`❌ Reprocess after Strava import failed for user ${userId}:`, e);
      }

      // Fetch weather before title calculation so all data is available
      const newRunData: ImportedRun[] = importedResults.filter(Boolean);
      try {
        await WeatherService.fetchAndSaveWeatherForRuns(newRunData);
      } catch (weatherError) {
        if (!reprocessError) throw weatherError;
        logger.error(`❌ Weather fetch failed after failed reprocess for user ${userId}:`, weatherError);
      }

      await calculateUserTotals(userId);

      // Check event qualification for each new run (fire-and-forget)
      for (const run of newRunData) {
        const activity = validActivities.find((a: any) => a.id.toString() === run.external_id);
        if (!activity) continue;
        checkEventQualification({
          userId,
          runId: run.id,
          runDate: activity.start_date_local.split('T')[0],
          distanceKm: activity.distance / 1000,
          isTreadmill: isTreadmillActivity(activity),
        }).catch((e: unknown) => logger.error('❌ checkEventQualification (strava) error:', e));
      }

      if (reprocessError) {
        return {
          success: false,
          newRuns: importedRuns,
          totalActivities: activities.length,
          error: 'Imported runs but failed to recalculate XP',
        };
      }
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
  } finally {
    // Ingen ny import tog över läkningen (inga nya rundor, Strava-API-fel, alla inserts föll): läk här, best-effort.
    // Misslyckas den försöker nästa synk igen; synkresultatet påverkas inte.
    if (healFrom && !healConsumed) {
      try {
        await reprocessRunsFromDate(userId, healFrom);
        await calculateUserTotals(userId);
      } catch (healError) {
        logger.error(`❌ Self-heal reprocess from ${healFrom} failed for user ${userId}:`, healError);
      }
    }
  }
}

export default router;
