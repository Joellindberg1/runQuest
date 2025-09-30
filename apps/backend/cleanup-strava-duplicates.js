// Clean up duplicate Strava runs added by mistake
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupDuplicateStravaRuns() {
  console.log('🧹 Cleaning up duplicate Strava runs for Karl...');
  const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
  
  // Find all runs with external_id (Strava runs I just added)
  const { data: stravaRuns, error } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', karlUserId)
    .not('external_id', 'is', null);
  
  if (error) {
    console.error('❌ Error fetching Strava runs:', error);
    return;
  }
  
  console.log(`🔍 Found ${stravaRuns.length} Strava runs to delete:`);
  stravaRuns.forEach((run, index) => {
    console.log(`${index + 1}. ${run.date}: ${run.distance}km, ${run.xp_gained} XP, external_id: ${run.external_id}`);
  });
  
  if (stravaRuns.length === 0) {
    console.log('✅ No Strava runs to delete');
    return;
  }
  
  // Delete all Strava runs
  const { error: deleteError } = await supabase
    .from('runs')
    .delete()
    .eq('user_id', karlUserId)
    .not('external_id', 'is', null);
  
  if (deleteError) {
    console.error('❌ Error deleting Strava runs:', deleteError);
    return;
  }
  
  console.log(`✅ Deleted ${stravaRuns.length} duplicate Strava runs`);
  
  // Recalculate user totals
  console.log('🔄 Recalculating user totals...');
  const { data: remainingRuns } = await supabase
    .from('runs')
    .select('distance, xp_gained')
    .eq('user_id', karlUserId);
  
  const totalKm = remainingRuns.reduce((sum, run) => sum + (run.distance || 0), 0);
  const totalXP = remainingRuns.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
  
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
    console.log(`📊 Remaining runs: ${remainingRuns.length} (all manual)`);
  }
}

cleanupDuplicateStravaRuns();