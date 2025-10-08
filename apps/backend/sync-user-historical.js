#!/usr/bin/env node

/**
 * 🎯 Historical Strava Sync Tool (Admin Only)
 * 
 * Syncs Strava activities from a specific date, bypassing the normal connection_date restriction.
 * This is a backend-only tool for administrative use.
 * 
 * Usage:
 *   node sync-user-historical.js "Username" "2024-01-01"
 *   node sync-user-historical.js "Nicklas Von Elling" "2024-06-01"
 */

import { getSupabaseClient } from './src/config/database.js';
import { calculateCompleteRunXP } from './src/utils/xpCalculationWrapper.js';
import { calculateUserTotals } from './src/utils/calculateUserTotals.js';

async function refreshStravaToken(refreshToken, userId) {
  try {
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to refresh token');
    }

    const tokenData = await tokenResponse.json();
    
    // Update database with new tokens
    const supabase = getSupabaseClient();
    await supabase
      .from('strava_tokens')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
      })
      .eq('user_id', userId);

    return { success: true, access_token: tokenData.access_token };
  } catch (error) {
    console.error('❌ Token refresh failed:', error);
    return { success: false, error: error.message };
  }
}

async function syncHistoricalStrava(username, fromDateString) {
  try {
    console.log(`\n🚀 Starting Historical Strava Sync`);
    console.log(`👤 User: ${username}`);
    console.log(`📅 From Date: ${fromDateString}`);
    console.log(`⚠️  ADMIN OPERATION - Bypassing connection_date restriction\n`);
    
    const supabase = getSupabaseClient();
    
    // 1. Find user by name
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('user_id, name, email')
      .eq('name', username)
      .single();
    
    if (userError || !user) {
      throw new Error(`User "${username}" not found`);
    }
    
    console.log(`✅ Found user: ${user.name} (${user.email})`);
    
    // 2. Get Strava tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at, connection_date')
      .eq('user_id', user.user_id)
      .single();
    
    if (tokenError || !tokens) {
      throw new Error(`User "${username}" is not connected to Strava`);
    }
    
    console.log(`🔗 Strava connection found`);
    console.log(`📅 Original connection date: ${tokens.connection_date || 'Not set'}`);
    
    // 3. Validate and parse fromDate
    const fromDate = new Date(fromDateString);
    if (isNaN(fromDate.getTime())) {
      throw new Error(`Invalid date format: ${fromDateString}. Use YYYY-MM-DD format.`);
    }
    
    // Set to beginning of day
    fromDate.setHours(0, 0, 0, 0);
    const after = Math.floor(fromDate.getTime() / 1000);
    
    console.log(`📊 Will fetch activities from: ${fromDate.toISOString()}`);
    
    // 4. Check and refresh token if needed
    const now = Math.floor(Date.now() / 1000);
    let accessToken = tokens.access_token;
    
    if (tokens.expires_at && tokens.expires_at < now) {
      console.log('🔄 Access token expired, refreshing...');
      const refreshResult = await refreshStravaToken(tokens.refresh_token, user.user_id);
      if (!refreshResult.success) {
        throw new Error('Failed to refresh Strava token');
      }
      accessToken = refreshResult.access_token;
      console.log('✅ Token refreshed successfully');
    }
    
    // 5. Get existing runs to avoid duplicates
    const { data: existingRuns, error: runsError } = await supabase
      .from('runs')
      .select('external_id, date, distance')
      .eq('user_id', user.user_id)
      .eq('source', 'strava')
      .not('external_id', 'is', null);
    
    if (runsError) {
      throw new Error('Failed to fetch existing runs');
    }
    
    const existingIds = new Set(existingRuns?.map(run => run.external_id) || []);
    console.log(`💾 Found ${existingRuns?.length || 0} existing Strava runs in database`);
    
    // 6. Fetch activities from Strava
    console.log(`\n🌐 Fetching activities from Strava API...`);
    
    let allActivities = [];
    let page = 1;
    const perPage = 50; // Strava max is 200, but 50 is safer for rate limits
    
    while (true) {
      console.log(`📄 Fetching page ${page}...`);
      
      const stravaResponse = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=${perPage}&page=${page}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (!stravaResponse.ok) {
        const errorData = await stravaResponse.json();
        throw new Error(`Strava API error: ${JSON.stringify(errorData)}`);
      }
      
      const activities = await stravaResponse.json();
      
      if (activities.length === 0) {
        console.log(`📄 Page ${page}: No more activities found`);
        break;
      }
      
      console.log(`📄 Page ${page}: Found ${activities.length} activities`);
      allActivities = allActivities.concat(activities);
      
      // Rate limiting protection
      if (activities.length < perPage) {
        console.log(`📄 Page ${page}: Last page (fewer than ${perPage} activities)`);
        break;
      }
      
      page++;
      
      // Safety check to avoid infinite loops
      if (page > 20) {
        console.log(`⚠️  Stopping at page ${page} for safety (check if this is correct)`);
        break;
      }
      
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n📊 Total activities fetched: ${allActivities.length}`);
    
    // 7. Filter for running activities
    const runningActivities = allActivities.filter(activity => 
      activity.type === 'Run' && 
      !existingIds.has(activity.id.toString())
    );
    
    console.log(`🏃‍♂️ New running activities: ${runningActivities.length}`);
    
    if (runningActivities.length === 0) {
      console.log(`\n✅ No new running activities to sync`);
      return;
    }
    
    // 8. Process and insert runs
    console.log(`\n🔄 Processing ${runningActivities.length} running activities...`);
    
    let processed = 0;
    let totalXP = 0;
    
    for (const activity of runningActivities) {
      try {
        const distance = activity.distance / 1000; // Convert meters to km
        const duration = Math.round(activity.moving_time / 60); // Convert seconds to minutes
        const date = activity.start_date_local.split('T')[0];
        
        // Calculate XP using the unified system
        const xp = await calculateCompleteRunXP(distance);
        
        // Calculate pace (minutes per km)
        const paceMinutes = activity.moving_time / 60 / distance;
        const paceWholeMinutes = Math.floor(paceMinutes);
        const paceSeconds = Math.round((paceMinutes - paceWholeMinutes) * 60);
        const pace = `${paceWholeMinutes.toString().padStart(2, '0')}:${paceSeconds.toString().padStart(2, '0')}`;
        
        const runData = {
          user_id: user.user_id,
          distance: parseFloat(distance.toFixed(2)),
          duration: duration,
          pace: pace,
          xp: xp,
          date: date,
          location: 'Strava Import',
          notes: activity.name || 'Imported from Strava',
          source: 'strava',
          external_id: activity.id.toString(),
        };
        
        const { error: insertError } = await supabase
          .from('runs')
          .insert([runData]);
        
        if (insertError) {
          console.error(`❌ Failed to insert run ${activity.id}:`, insertError);
          continue;
        }
        
        processed++;
        totalXP += xp;
        
        console.log(`✅ ${processed}/${runningActivities.length}: ${date} - ${distance.toFixed(2)}km - ${xp} XP`);
        
        // Small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        console.error(`❌ Error processing activity ${activity.id}:`, error);
      }
    }
    
    // 9. Recalculate user totals and titles
    console.log(`\n🔄 Recalculating user totals...`);
    await calculateUserTotals(user.user_id);
    console.log(`✅ User totals updated`);
    
    // Summary
    console.log(`\n🎉 Historical Sync Complete!`);
    console.log(`👤 User: ${username}`);
    console.log(`📅 Period: ${fromDateString} to present`);
    console.log(`🏃‍♂️ Activities processed: ${processed}/${runningActivities.length}`);
    console.log(`⭐ Total XP added: ${totalXP}`);
    console.log(`💾 Database updated and user totals recalculated\n`);
    
  } catch (error) {
    console.error(`\n❌ Historical sync failed:`, error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.log(`
🎯 Historical Strava Sync Tool (Admin Only)

Usage:
  node sync-user-historical.js "Username" "YYYY-MM-DD"

Examples:
  node sync-user-historical.js "Nicklas Von Elling" "2024-01-01"
  node sync-user-historical.js "Joel Lindberg" "2024-06-15"

⚠️  This tool bypasses the normal connection_date restriction.
    Use only for administrative purposes.
    `);
    process.exit(1);
  }
  
  const [username, fromDate] = args;
  await syncHistoricalStrava(username, fromDate);
}

main();