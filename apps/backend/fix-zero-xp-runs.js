// Retroactive fix for all Strava runs with 0 XP
import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';
import { calculateRunXP } from './src/utils/xpCalculation.ts';

dotenv.config();

async function fixZeroXPStravaRuns() {
  const supabase = getSupabaseClient();
  
  console.log('🔧 FIXING ALL STRAVA RUNS WITH 0 XP');
  console.log('===================================');
  
  // Find all Strava runs with 0 XP
  const { data: brokenRuns, error } = await supabase
    .from('runs')
    .select('*')
    .eq('source', 'strava')
    .eq('xp_gained', 0)
    .gt('distance', 0); // Only fix runs with actual distance
    
  if (error) {
    console.error('❌ Error fetching broken runs:', error);
    return;
  }
  
  if (!brokenRuns || brokenRuns.length === 0) {
    console.log('✅ No broken Strava runs found - all runs have proper XP!');
    return;
  }
  
  console.log(`🔍 Found ${brokenRuns.length} Strava runs with 0 XP:`);
  
  for (const run of brokenRuns) {
    console.log(`\n🏃‍♂️ Fixing run: ${run.distance}km on ${run.date} (User: ${run.user_id})`);
    console.log(`   Current XP: ${run.xp_gained} (should be > 0)`);
    
    try {
      // Recalculate XP
      const xpResult = await calculateRunXP(run.distance);
      console.log(`   Calculated XP: ${xpResult.totalXP} (Base: ${xpResult.baseXP}, KM: ${xpResult.kmXP}, Bonus: ${xpResult.distanceBonus})`);
      
      // Get streak information (use existing or recalculate)
      const streakMultiplier = run.multiplier || 1.0;
      const streakDay = run.streak_day || 1;
      
      const finalXP = Math.round(xpResult.totalXP * streakMultiplier);
      const streakBonus = finalXP - xpResult.totalXP;
      
      console.log(`   Final XP after streak (${streakMultiplier}x): ${finalXP}`);
      
      // Update the run with correct XP values
      const { error: updateError } = await supabase
        .from('runs')
        .update({
          xp_gained: finalXP,
          base_xp: xpResult.baseXP,
          km_xp: xpResult.kmXP,
          distance_bonus: xpResult.distanceBonus,
          streak_bonus: streakBonus,
          multiplier: streakMultiplier,
          streak_day: streakDay
        })
        .eq('id', run.id);
        
      if (updateError) {
        console.error(`   ❌ Failed to update run:`, updateError);
      } else {
        console.log(`   ✅ Fixed! XP updated from 0 to ${finalXP}`);
      }
      
    } catch (error) {
      console.error(`   ❌ Error fixing run:`, error);
    }
  }
  
  console.log('\n🔄 Recalculating user totals for affected users...');
  
  // Get unique user IDs from fixed runs
  const userIds = [...new Set(brokenRuns.map(run => run.user_id))];
  
  for (const userId of userIds) {
    try {
      console.log(`🔄 Updating totals for user ${userId}...`);
      const { calculateUserTotals } = await import('./src/utils/calculateUserTotals.ts');
      await calculateUserTotals(userId);
      console.log(`✅ User totals updated`);
    } catch (error) {
      console.error(`❌ Error updating user totals:`, error);
    }
  }
  
  console.log('\n🎉 RETROACTIVE FIX COMPLETED!');
  console.log(`📊 Fixed ${brokenRuns.length} Strava runs`);
  console.log(`👥 Updated totals for ${userIds.length} users`);
}

// Check if we should run immediately
const args = process.argv.slice(2);
if (args.includes('--run')) {
  fixZeroXPStravaRuns().catch(console.error);
} else {
  console.log('🔧 Retroactive fix ready!');
  console.log('Run with: npx tsx fix-zero-xp-runs.js --run');
  console.log('This will fix all Strava runs with 0 XP and recalculate user totals.');
}

export { fixZeroXPStravaRuns };