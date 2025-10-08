// Quick script to find Nicklas user ID and sync his Strava data
import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.js';

// Load environment variables
dotenv.config();

const supabase = getSupabaseClient();

async function findNicklasAndSync() {
  try {
    console.log('🔍 Looking for Nicklas Von Elling...');
    
    // Find Nicklas user
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .ilike('name', '%nicklas%');
    
    if (userError) {
      console.error('❌ Error finding user:', userError);
      return;
    }
    
    console.log('📋 Found users:', users);
    
    if (users.length === 0) {
      console.log('❌ No users found matching "nicklas"');
      return;
    }
    
    const nicklas = users.find(u => u.name.toLowerCase().includes('nicklas'));
    if (!nicklas) {
      console.log('❌ No user found with "nicklas" in name');
      return;
    }
    
    console.log(`✅ Found Nicklas: ${nicklas.name} (ID: ${nicklas.id})`);
    
    // Check his current runs
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('id, date, distance, xp_gained, source, external_id')
      .eq('user_id', nicklas.id)
      .order('date', { ascending: false })
      .limit(5);
    
    if (runsError) {
      console.error('❌ Error fetching runs:', runsError);
      return;
    }
    
    console.log(`📊 Nicklas has ${runs.length} recent runs:`);
    runs.forEach(run => {
      console.log(`  - ${run.date}: ${run.distance}km, ${run.xp_gained} XP, source: ${run.source || 'manual'}, external_id: ${run.external_id || 'none'}`);
    });
    
    // Check Strava connection
    const { data: stravaTokens, error: stravaError } = await supabase
      .from('strava_tokens')
      .select('access_token, expires_at, connection_date')
      .eq('user_id', nicklas.id)
      .single();
    
    if (stravaError) {
      console.log('❌ No Strava connection found for Nicklas');
      return;
    }
    
    console.log('✅ Strava connection found');
    console.log(`📅 Connected: ${stravaTokens.connection_date}`);
    console.log(`⏰ Token expires: ${new Date(stravaTokens.expires_at * 1000).toISOString()}`);
    
    // Now trigger manual sync for this specific user directly
    console.log('🔄 Triggering direct Strava sync for Nicklas...');
    
    const syncResult = await syncUserStravaActivities(nicklas.id);
    console.log('📋 Direct sync result:', JSON.stringify(syncResult, null, 2));
    
    if (syncResult.success) {
      console.log(`🎉 SUCCESS! Synced ${syncResult.newRuns} new runs for Nicklas`);
      
      // Show updated runs
      const { data: newRuns, error: newRunsError } = await supabase
        .from('runs')
        .select('id, date, distance, xp_gained, source, external_id')
        .eq('user_id', nicklas.id)
        .order('date', { ascending: false })
        .limit(10);
      
      if (!newRunsError) {
        console.log('📊 Updated runs list:');
        newRuns.forEach(run => {
          console.log(`  - ${run.date}: ${run.distance}km, ${run.xp_gained} XP, source: ${run.source || 'manual'}, external_id: ${run.external_id || 'none'}`);
        });
      }
    } else {
      console.log(`❌ Sync failed: ${syncResult.error}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Import the sync function we need
async function syncUserStravaActivities(userId) {
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
    const existingIds = new Set(existingRuns?.map((run) => run.external_id) || []);
    
    // Fetch activities from Strava (from connection date onwards)
    let after;
    
    if (tokens.connection_date) {
      const connectionDate = new Date(tokens.connection_date);
      connectionDate.setHours(0, 0, 0, 0);
      after = Math.floor(connectionDate.getTime() / 1000);
      console.log(`📅 Using connection date as starting point: ${connectionDate.toISOString()}`);
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      after = Math.floor(thirtyDaysAgo.getTime() / 1000);
      console.log(`⚠️ No connection date found, falling back to 30 days ago: ${thirtyDaysAgo.toISOString()}`);
    }
    
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
      activities.forEach((activity, index) => {
        const distance = (activity.distance / 1000).toFixed(2);
        const date = activity.start_date_local.split('T')[0];
        console.log(`  ${index + 1}. ${date}: ${distance}km, Type: ${activity.type}, ID: ${activity.id}`);
      });
    }
    
    // Filter for running activities only
    const runningActivities = activities.filter((activity) => 
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
    
    console.log('🔄 Processing new running activities...');
    let processedRuns = 0;
    
    for (const activity of runningActivities) {
      try {
        console.log(`\n🏃 Processing activity ${activity.id}: ${activity.name}`);
        
        const distance = activity.distance / 1000; // Convert to km
        const date = activity.start_date_local.split('T')[0]; // YYYY-MM-DD
        
        if (distance < 1.0) {
          console.log(`  ⚠️ Skipping activity under 1km: ${distance.toFixed(2)}km`);
          continue;
        }
        
        console.log(`  📏 Distance: ${distance.toFixed(2)}km on ${date}`);
        
        // Calculate XP using the unified calculation
        const { calculateCompleteRunXP } = await import('../../packages/shared/dist/xpCalculation.js');
        
        // Get admin settings
        const { data: settings } = await supabase
          .from('admin_settings')
          .select('*')
          .single();
        
        // Get streak multipliers
        const { data: multipliers, error: multipliersError } = await supabase
          .from('streak_multipliers')
          .select('*')
          .order('days');
        
        if (multipliersError) {
          console.log(`⚠️ Warning: Could not fetch multipliers: ${multipliersError.message}`);
        }
        
        // Get existing runs for streak calculation
        const { data: userRuns } = await supabase
          .from('runs')
          .select('date')
          .eq('user_id', userId)
          .order('date', { ascending: true });
        
        // Ensure multipliers is always an array
        const safeMultipliers = Array.isArray(multipliers) ? multipliers : [];
        console.log(`🔧 Using ${safeMultipliers.length} streak multipliers`);
        
        // Calculate streak for this specific date
        const { StreakService } = await import('./src/services/streakService.js');
        const streakResult = await StreakService.calculateUserStreaks(userId, date);
        
        const result = await calculateCompleteRunXP(
          distance,
          streakResult.streakDayForRun,
          settings,
          safeMultipliers
        );
        
        console.log(`  ✅ XP calculated: ${result.finalXP} (Base: ${result.baseXP}, KM: ${result.kmXP}, Bonus: ${result.distanceBonus}, Streak: ${result.streakBonus}, Multiplier: ${result.multiplier})`);
        
        // Save to database
        const runData = {
          user_id: userId,
          date: date,
          distance: distance,
          xp_gained: result.finalXP,
          multiplier: result.multiplier,
          streak_day: streakResult.streakDayForRun,
          base_xp: result.baseXP,
          km_xp: result.kmXP,
          distance_bonus: result.distanceBonus,
          streak_bonus: result.streakBonus,
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
          console.error(`  ❌ Database insert failed: ${insertError.message}`);
          continue;
        }
        
        console.log(`  ✅ Run saved with ID: ${savedRun.id}`);
        processedRuns++;
        
      } catch (error) {
        console.error(`  ❌ Error processing activity ${activity.id}:`, error);
      }
    }
    
    // Update user totals if any runs were imported
    if (processedRuns > 0) {
      console.log(`🔄 Updating user totals after importing ${processedRuns} runs...`);
      const { calculateUserTotals } = await import('./src/utils/calculateUserTotals.js');
      await calculateUserTotals(userId);
      console.log('✅ User totals updated');
    }
    
    return {
      success: true,
      newRuns: processedRuns,
      totalActivities: activities.length,
      message: `Processed ${processedRuns} new running activities`
    };
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    return { success: false, error: error.message };
  }
}

async function refreshStravaToken(refreshToken, userId) {
  // Simple refresh implementation - you might want to import this from the actual module
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  
  if (!response.ok) {
    return { success: false, error: 'Token refresh failed' };
  }
  
  const tokenData = await response.json();
  
  // Save new tokens
  const supabase = getSupabaseClient();
  await supabase
    .from('strava_tokens')
    .update({
      access_token: tokenData.access_token,
      expires_at: tokenData.expires_at
    })
    .eq('user_id', userId);
  
  return { success: true, access_token: tokenData.access_token };
}

findNicklasAndSync();