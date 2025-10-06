// Simulate exactly what happened during Nicklas's import
import dotenv from 'dotenv';
import { calculateRunXP } from './src/utils/xpCalculation.ts';
import { getSupabaseClient } from './src/config/database.ts';

dotenv.config();

async function simulateNicklasImport() {
  console.log('🔄 SIMULATING NICKLAS IMPORT PROCESS');
  console.log('===================================');
  
  const supabase = getSupabaseClient();
  const userId = 'f2b12fa7-548f-43d4-b0f2-c9eb0a10ebc8';
  const distance = 3.57;
  const date = '2025-10-02';
  
  try {
    console.log('📏 Step 1: Calculate XP...');
    const xpResult = await calculateRunXP(distance);
    console.log('✅ XP calculation result:', xpResult);
    
    console.log('\n📊 Step 2: Calculate streak...');
    const { StreakService } = await import('./src/services/streakService.ts');
    const streakResult = await StreakService.calculateUserStreaks(userId, date);
    console.log('✅ Streak calculation result:', streakResult);
    
    console.log('\n🎯 Step 3: Get multipliers...');
    const { data: multipliers } = await supabase
      .from('streak_multipliers')
      .select('*')
      .order('days');
    console.log('✅ Multipliers:', multipliers);
    
    console.log('\n🧮 Step 4: Calculate final values...');
    let streakMultiplier = 1.0;
    if (multipliers) {
      for (const mult of multipliers) {
        if (streakResult.streakDayForRun >= mult.days) {
          streakMultiplier = mult.multiplier;
        }
      }
    }
    
    const finalXP = Math.round(xpResult.totalXP * streakMultiplier);
    const streakBonus = finalXP - xpResult.totalXP;
    
    console.log('📋 FINAL VALUES:');
    console.log('  Distance:', distance);
    console.log('  Base XP:', xpResult.baseXP);
    console.log('  KM XP:', xpResult.kmXP);
    console.log('  Distance Bonus:', xpResult.distanceBonus);
    console.log('  Streak Multiplier:', streakMultiplier);
    console.log('  Streak Day:', streakResult.streakDayForRun);
    console.log('  Final XP:', finalXP);
    console.log('  Streak Bonus:', streakBonus);
    
    if (finalXP === 0) {
      console.log('❌ PROBLEM: Final XP is 0 - this would cause the bug!');
    } else {
      console.log('✅ XP calculation completed successfully');
      console.log('🤔 The problem must be elsewhere in the import process');
    }
    
  } catch (error) {
    console.error('❌ ERROR during simulation:', error);
    console.log('🎯 This could be the cause of 0 XP in database!');
  }
}

simulateNicklasImport();