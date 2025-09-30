// Manual sync for Karl to get missing Strava runs
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// XP calculation function (simplified version)
function calculateXP(distanceKm) {
  const baseXP = Math.floor(distanceKm * 18.75);
  return Math.min(baseXP, 60); // Cap at 60 XP
}

async function manualSyncKarl() {
  console.log('🔄 Manual sync for Karl Persson...');
  const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
  
  // Get Karl's token
  const { data: tokens } = await supabase
    .from('strava_tokens')
    .select('*')
    .eq('user_id', karlUserId);
  
  if (!tokens || tokens.length === 0) {
    console.error('❌ No token found');
    return;
  }
  
  const token = tokens[0];
  
  // Get all Strava activities from last 90 days
  const ninetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
  const stravaResponse = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${ninetyDaysAgo}`,
    {
      headers: {
        'Authorization': `Bearer ${token.access_token}`
      }
    }
  );
  
  if (!stravaResponse.ok) {
    console.error('❌ Strava API error:', stravaResponse.status);
    return;
  }
  
  const activities = await stravaResponse.json();
  const runningActivities = activities.filter(a => a.type === 'Run');
  
  console.log(`🏃 Found ${runningActivities.length} running activities`);
  
  let syncedCount = 0;
  let skippedCount = 0;
  
  for (const activity of runningActivities) {
    // Check if already exists
    const { data: existingRun } = await supabase
      .from('runs')
      .select('id')
      .eq('external_id', activity.id.toString())
      .single();
    
    if (existingRun) {
      console.log(`⏭️  Skipping existing run: ${activity.name}`);
      skippedCount++;
      continue;
    }
    
    // Calculate XP
    const distanceKm = activity.distance / 1000;
    const xp = calculateXP(distanceKm);
    const date = activity.start_date.split('T')[0]; // Get date part only
    
    // Insert new run
    const { data: newRun, error } = await supabase
      .from('runs')
      .insert({
        user_id: karlUserId,
        distance: distanceKm,
        date: date,
        xp_gained: xp,
        external_id: activity.id.toString(),
        source: 'strava',
        base_xp: Math.floor(distanceKm * 15), // Base XP calculation
        km_xp: Math.floor(distanceKm * 3.75), // Additional km XP
        multiplier: 1,
        streak_day: 1, // Will be recalculated later
        distance_bonus: 0,
        streak_bonus: 0,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error(`❌ Error inserting run ${activity.name}:`, error);
    } else {
      console.log(`✅ Synced: ${activity.name} - ${distanceKm.toFixed(2)}km, ${xp} XP`);
      syncedCount++;
    }
  }
  
  console.log(`\\n📊 Sync complete: ${syncedCount} new runs, ${skippedCount} skipped`);
  
  if (syncedCount > 0) {
    console.log('🔄 Updating user totals...');
    
    // Recalculate totals
    const { data: allRuns } = await supabase
      .from('runs')
      .select('distance, xp_gained')
      .eq('user_id', karlUserId);
    
    const totalKm = allRuns.reduce((sum, run) => sum + (run.distance || 0), 0);
    const totalXP = allRuns.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
    
    // Update user
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_km: totalKm,
        total_xp: totalXP,
        updated_at: new Date().toISOString()
      })
      .eq('id', karlUserId);
    
    if (updateError) {
      console.error('❌ Error updating user totals:', updateError);
    } else {
      console.log(`✅ Updated totals: ${totalKm.toFixed(2)}km, ${totalXP} XP`);
    }
  }
}

manualSyncKarl();