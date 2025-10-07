import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';

// Load environment variables
dotenv.config();

async function analyzeFullNicklasIssue() {
  console.log('🔍 FULL ANALYSIS OF NICKLAS ISSUE');
  console.log('==================================');
  
  const supabase = getSupabaseClient();
  const nicklasId = 'f2b12fa7-548f-43d4-b0f2-c9eb0a10ebc8';
  
  try {
    // Get the problematic run details again
    const { data: latestRun } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', nicklasId)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    console.log('🚨 LATEST RUN ANALYSIS:');
    console.log('========================');
    console.log('Date:', latestRun.date);
    console.log('Distance:', latestRun.distance, 'km');
    console.log('XP Gained:', latestRun.xp_gained);
    console.log('Base XP:', latestRun.base_xp);
    console.log('KM XP:', latestRun.km_xp);  
    console.log('Distance Bonus:', latestRun.distance_bonus);
    console.log('Streak Bonus:', latestRun.streak_bonus);
    console.log('Multiplier:', latestRun.multiplier);
    console.log('Streak Day:', latestRun.streak_day);
    console.log('External ID:', latestRun.external_id);

    // Get all Nicklas runs to analyze pattern
    const { data: allRuns } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', nicklasId)
      .order('date', { ascending: false })
      .limit(5);

    console.log('\n📊 RECENT RUNS PATTERN:');
    console.log('========================');
    allRuns.forEach((run, i) => {
      console.log(`Run ${i+1}: ${run.date} | ${run.distance}km | XP: ${run.xp_gained} | Streak: ${run.streak_day} | Source: ${run.source}`);
    });

    // Check user totals
    const { data: user } = await supabase
      .from('users')
      .select('total_xp, current_streak, longest_streak')
      .eq('id', nicklasId)
      .single();

    console.log('\n👤 USER TOTALS:');
    console.log('===============');
    console.log('Total XP:', user.total_xp);
    console.log('Current Streak:', user.current_streak);
    console.log('Longest Streak:', user.longest_streak);

    // Manual total calculation
    const totalXPFromRuns = allRuns.reduce((sum, run) => sum + run.xp_gained, 0);
    console.log('\n🧮 MANUAL VERIFICATION:');
    console.log('=======================');
    console.log('XP from last 5 runs:', totalXPFromRuns);

    // Test streak calculation manually for the latest run
    console.log('\n🔄 STREAK ANALYSIS:');
    console.log('==================');
    
    const latestDate = new Date(latestRun.date);
    const secondLatestDate = allRuns[1] ? new Date(allRuns[1].date) : null;
    
    if (secondLatestDate) {
      const daysDifference = Math.abs((latestDate.getTime() - secondLatestDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log('Days between latest and previous run:', daysDifference);
      console.log('Should continue streak?', daysDifference <= 1);
    }

    // Specific analysis of the 0 XP issue
    console.log('\n🎯 ISSUE ANALYSIS:');
    console.log('==================');
    
    if (latestRun.xp_gained === 0 && latestRun.distance > 0) {
      console.log('❌ CONFIRMED: Run has 0 XP despite valid distance');
      
      if (latestRun.base_xp === 0 && latestRun.km_xp === 0) {
        console.log('❌ XP breakdown fields are all 0 - calculation failed completely');
        console.log('❌ This suggests the calculateRunXP function failed during import');
      }
      
      if (latestRun.streak_day === 0) {
        console.log('❌ Streak day is 0 - streak calculation also failed');
      }
      
      console.log('\n💡 LIKELY ROOT CAUSE:');
      console.log('---------------------');
      console.log('1. An exception occurred during XP calculation in import process');
      console.log('2. The run was saved with fallback/default values (all 0s)');
      console.log('3. The import continued without properly handling the error');
      console.log('4. User totals were recalculated, resetting streak to 0');
    }

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  }
}

analyzeFullNicklasIssue();