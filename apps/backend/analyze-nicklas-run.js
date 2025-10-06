// Detailed analysis of Nicklas's problematic run
import dotenv from 'dotenv';
import { getSupabaseClient } from './src/config/database.ts';

dotenv.config();

async function analyzeNicklasRun() {
  const supabase = getSupabaseClient();
  
  console.log('🔍 DETAILED ANALYSIS OF NICKLAS PROBLEMATIC RUN');
  console.log('===============================================');
  
  // Get Nicklas's exact problematic run
  const { data: nicklasRun } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', 'f2b12fa7-548f-43d4-b0f2-c9eb0a10ebc8')
    .eq('source', 'strava')
    .eq('distance', 3.57)
    .single();
    
  if (nicklasRun) {
    console.log('📋 PROBLEMATIC RUN DETAILS:');
    console.log('Date:', nicklasRun.date);
    console.log('Distance:', nicklasRun.distance, 'km');
    console.log('XP Gained:', nicklasRun.xp_gained);
    console.log('Source:', nicklasRun.source);
    console.log('External ID:', nicklasRun.external_id);
    console.log('Created At:', nicklasRun.created_at);
    console.log('Base XP:', nicklasRun.base_xp);
    console.log('KM XP:', nicklasRun.km_xp);
    console.log('Distance Bonus:', nicklasRun.distance_bonus);
    console.log('Streak Bonus:', nicklasRun.streak_bonus);
    console.log('Multiplier:', nicklasRun.multiplier);
    console.log('Streak Day:', nicklasRun.streak_day);
    
    // Check if all XP fields are null/0
    const allXPFieldsZero = (
      (!nicklasRun.base_xp || nicklasRun.base_xp === 0) &&
      (!nicklasRun.km_xp || nicklasRun.km_xp === 0) &&
      (!nicklasRun.distance_bonus || nicklasRun.distance_bonus === 0) &&
      (!nicklasRun.streak_bonus || nicklasRun.streak_bonus === 0)
    );
    
    if (allXPFieldsZero) {
      console.log('❌ ROOT CAUSE FOUND: All XP breakdown fields are 0/null!');
      console.log('This indicates the run was saved WITHOUT XP calculation');
    } else {
      console.log('🤔 XP breakdown exists but xp_gained is 0 - calculation error?');
    }
  }
  
  // Compare with Karl's working runs
  console.log('\n📊 KARL\'S WORKING STRAVA RUNS FOR COMPARISON:');
  const { data: karlRuns } = await supabase
    .from('runs')
    .select('*')
    .eq('user_id', 'd802fe3f-81f6-4007-8834-59664fc9711d')
    .eq('source', 'strava')
    .limit(2);
    
  karlRuns?.forEach((run, i) => {
    console.log(`\nKarl Run ${i+1}:`);
    console.log('  Distance:', run.distance, 'km');
    console.log('  XP Gained:', run.xp_gained);
    console.log('  Base XP:', run.base_xp);
    console.log('  KM XP:', run.km_xp);  
    console.log('  Distance Bonus:', run.distance_bonus);
    console.log('  Streak Bonus:', run.streak_bonus);
  });
}

analyzeNicklasRun();