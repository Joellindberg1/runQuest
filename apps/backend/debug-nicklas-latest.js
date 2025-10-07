import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';

// Load environment variables
dotenv.config();

async function debugNicklasLatest() {
  console.log('🔍 DEBUGGING NICKLAS LATEST RUN');
  console.log('================================');
  
  const supabase = getSupabaseClient();
  const nicklasId = 'f2b12fa7-548f-43d4-b0f2-c9eb0a10ebc8';
  
  try {
    // Get the problematic run (latest)
    const { data: latestRun } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', nicklasId)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    console.log('🚨 LATEST RUN DETAILS:');
    console.log('=======================');
    console.log('ID:', latestRun.id);
    console.log('Date:', latestRun.date);
    console.log('Distance:', latestRun.distance, 'km');
    console.log('XP Gained:', latestRun.xp_gained);
    console.log('Base XP:', latestRun.base_xp);
    console.log('KM XP:', latestRun.km_xp);
    console.log('Distance Bonus:', latestRun.distance_bonus);
    console.log('Streak Bonus:', latestRun.streak_bonus);
    console.log('Multiplier:', latestRun.multiplier);
    console.log('Streak Day:', latestRun.streak_day);
    console.log('Source:', latestRun.source);
    console.log('External ID:', latestRun.external_id);
    console.log('Created At:', latestRun.created_at);

    // Check what XP SHOULD be for this distance
    const distance = latestRun.distance;
    const expectedBaseXP = 15;
    const expectedKmXP = Math.floor(distance * 2);
    let expectedDistanceBonus = 0;
    if (distance >= 20) expectedDistanceBonus = 50;
    else if (distance >= 15) expectedDistanceBonus = 25;
    else if (distance >= 10) expectedDistanceBonus = 15;
    else if (distance >= 5) expectedDistanceBonus = 5;
    
    const expectedTotalXP = expectedBaseXP + expectedKmXP + expectedDistanceBonus;

    console.log('\n🧮 EXPECTED VALUES:');
    console.log('===================');
    console.log('Expected Base XP:', expectedBaseXP);
    console.log('Expected KM XP:', expectedKmXP);
    console.log('Expected Distance Bonus:', expectedDistanceBonus);
    console.log('Expected Total XP (no multiplier):', expectedTotalXP);

    // Check user's current state
    const { data: user } = await supabase
      .from('users')
      .select('total_xp, current_streak, longest_streak')
      .eq('id', nicklasId)
      .single();

    console.log('\n👤 USER CURRENT STATE:');
    console.log('======================');
    console.log('Total XP:', user.total_xp);
    console.log('Current Streak:', user.current_streak);
    console.log('Longest Streak:', user.longest_streak);

    // Identify the issue
    console.log('\n🔍 PROBLEM ANALYSIS:');
    console.log('====================');
    
    if (latestRun.xp_gained === 0) {
      console.log('❌ PRIMARY ISSUE: XP is 0');
      
      if (latestRun.base_xp === null || latestRun.base_xp === 0) {
        console.log('❌ Base XP is missing/zero');
      }
      if (latestRun.km_xp === null || latestRun.km_xp === 0) {
        console.log('❌ KM XP is missing/zero');
      }
      if (latestRun.multiplier === null || latestRun.multiplier === 0) {
        console.log('❌ Multiplier is missing/zero');
      }
      if (latestRun.streak_day === null || latestRun.streak_day === 0) {
        console.log('❌ Streak day is missing/zero');
      }
    }

    if (user.current_streak === 0 && latestRun.date) {
      console.log('❌ SECONDARY ISSUE: Current streak is 0');
      console.log('   This suggests streak calculation failed');
    }

    console.log('\n💡 LIKELY CAUSES:');
    console.log('=================');
    console.log('1. XP calculation failed during Strava import');
    console.log('2. Streak calculation failed, resulting in 0 multiplier');
    console.log('3. Database transaction failed partially');
    console.log('4. Validation logic prevented saving correct values');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  }
}

debugNicklasLatest();