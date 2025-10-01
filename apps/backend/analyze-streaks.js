// Analyze Karl's streak data in detail
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeKarlStreaks() {
  console.log('🔍 Analyzing Karl\'s streak data...\n');
  
  const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
  
  // 1. Check users table current_streak
  console.log('👤 USERS TABLE:');
  const { data: userInfo } = await supabase
    .from('users')
    .select('name, current_streak, longest_streak, total_km, total_xp')
    .eq('id', karlUserId)
    .single();
  
  if (userInfo) {
    console.log(`Name: ${userInfo.name}`);
    console.log(`Current Streak: ${userInfo.current_streak}`);
    console.log(`Longest Streak: ${userInfo.longest_streak}`);
    console.log(`Total KM: ${userInfo.total_km}`);
    console.log(`Total XP: ${userInfo.total_xp}`);
  }
  
  // 2. Check runs table recent streak_day values
  console.log('\n🏃 RUNS TABLE (last 10 runs):');
  const { data: recentRuns } = await supabase
    .from('runs')
    .select('date, distance, streak_day, xp_gained, source, external_id')
    .eq('user_id', karlUserId)
    .order('date', { ascending: false })
    .limit(10);
  
  if (recentRuns) {
    recentRuns.forEach((run, index) => {
      console.log(`${index + 1}. ${run.date}: ${run.distance}km, streak_day: ${run.streak_day}, XP: ${run.xp_gained}, source: ${run.source || 'manual'}`);
    });
  }
  
  // 3. Check for streak calculation logic - look at consecutive days
  console.log('\n📅 STREAK ANALYSIS:');
  if (recentRuns && recentRuns.length > 0) {
    const sortedRuns = recentRuns.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    console.log('Chronological order:');
    let expectedStreak = 0;
    let lastDate = null;
    
    sortedRuns.forEach((run, index) => {
      const runDate = new Date(run.date);
      let daysDiff = null;
      
      if (lastDate) {
        daysDiff = Math.floor((runDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff === 1) {
          expectedStreak++;
        } else if (daysDiff === 0) {
          // Same day - keep streak
        } else {
          expectedStreak = 1; // Reset streak
        }
      } else {
        expectedStreak = 1; // First run
      }
      
      console.log(`  ${run.date}: streak_day=${run.streak_day} (expected: ${expectedStreak}) - ${daysDiff ? `+${daysDiff}d` : 'first'}`);
      lastDate = runDate;
    });
    
    console.log(`\nCalculated current streak should be: ${expectedStreak}`);
  }
  
  // 4. Check what the current actual streak should be (consecutive days from today backwards)
  console.log('\n🎯 CURRENT STREAK VERIFICATION:');
  const today = new Date('2025-09-30'); // Using current date context
  let currentStreakCalculation = 0;
  
  // Go backwards from today to find consecutive days
  for (let i = 0; i < 30; i++) { // Check last 30 days
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() - i);
    const dateStr = checkDate.toISOString().split('T')[0];
    
    const runOnDay = recentRuns?.find(run => run.date === dateStr);
    
    if (runOnDay) {
      currentStreakCalculation++;
      console.log(`  ${dateStr}: ✅ Run found (${runOnDay.distance}km)`);
    } else {
      console.log(`  ${dateStr}: ❌ No run`);
      break; // Streak broken
    }
  }
  
  console.log(`\nACTUAL current streak should be: ${currentStreakCalculation}`);
  
  // 5. Summary of discrepancies
  console.log('\n📊 DISCREPANCY SUMMARY:');
  console.log(`Users table says: ${userInfo?.current_streak}`);
  console.log(`Latest run streak_day: ${recentRuns?.[0]?.streak_day}`);
  console.log(`Calculated current streak: ${currentStreakCalculation}`);
  
  if (recentRuns?.[0]?.streak_day !== userInfo?.current_streak) {
    console.log(`❌ MISMATCH: runs.streak_day (${recentRuns[0].streak_day}) ≠ users.current_streak (${userInfo?.current_streak})`);
  }
  
  if (currentStreakCalculation !== userInfo?.current_streak) {
    console.log(`❌ MISMATCH: calculated streak (${currentStreakCalculation}) ≠ users.current_streak (${userInfo?.current_streak})`);
  }
}

analyzeKarlStreaks();