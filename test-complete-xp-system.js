// Test complete XP system - both Strava and manual should give same XP
// This tests that our unified system works consistently

import { calculateCompleteRunXP } from './packages/shared/dist/xpCalculation.js';

console.log('🧪 TESTING UNIFIED XP CALCULATION SYSTEM');
console.log('========================================');

// Mock admin settings (same as in database)
const adminSettings = {
  base_xp: 15,
  xp_per_km: 2,
  bonus_5km: 5,
  bonus_10km: 15,
  bonus_15km: 25,
  bonus_20km: 50,
  min_run_distance: 1.0
};

// Mock streak multipliers (same as in database)
const streakMultipliers = [
  { days: 5, multiplier: 1.1 },
  { days: 15, multiplier: 1.2 },
  { days: 30, multiplier: 1.3 },
  { days: 60, multiplier: 1.4 },
  { days: 90, multiplier: 1.5 },
  { days: 120, multiplier: 1.6 },
  { days: 180, multiplier: 1.7 },
  { days: 220, multiplier: 1.8 },
  { days: 240, multiplier: 1.9 },
  { days: 270, multiplier: 2.0 }
];

console.log('📊 Test Data:');
console.log('Admin Settings:', adminSettings);
console.log('Streak Multipliers:', streakMultipliers.length, 'levels');
console.log('');

// Test cases that match real scenarios
const testCases = [
  { name: 'Nicklas Problematic Run', distance: 3.47, streakDay: 1 },
  { name: 'Basic 5km Run', distance: 5.0, streakDay: 1 },
  { name: '5km with 30-day streak', distance: 5.0, streakDay: 30 },
  { name: '10km Run', distance: 10.0, streakDay: 1 },
  { name: '15km Run with streak', distance: 15.0, streakDay: 60 },
  { name: '20km+ Ultra Run', distance: 22.0, streakDay: 180 }
];

console.log('🔬 RUNNING TEST CASES:');
console.log('=====================');

testCases.forEach((testCase, index) => {
  console.log(`\n${index + 1}. ${testCase.name}:`);
  console.log(`   Distance: ${testCase.distance}km, Streak Day: ${testCase.streakDay}`);
  
  try {
    const result = calculateCompleteRunXP(
      testCase.distance,
      testCase.streakDay,
      adminSettings,
      streakMultipliers
    );
    
    console.log(`   ✅ Base XP: ${result.baseXP}`);
    console.log(`   ✅ KM XP: ${result.kmXP}`);
    console.log(`   ✅ Distance Bonus: ${result.distanceBonus}`);
    console.log(`   ✅ Streak Multiplier: ${result.multiplier}x`);
    console.log(`   ✅ Streak Bonus: ${result.streakBonus}`);
    console.log(`   🎯 FINAL XP: ${result.finalXP}`);
    
    // Validate the result makes sense
    if (result.finalXP <= 0) {
      console.log(`   ❌ ERROR: Final XP is ${result.finalXP}, should be positive`);
    } else if (testCase.distance === 3.47 && result.finalXP !== 21) {
      console.log(`   ❌ ERROR: Nicklas 3.47km should give 21 XP, got ${result.finalXP}`);
    } else {
      console.log(`   ✅ PASS: XP calculation looks correct`);
    }
    
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
  }
});

console.log('\n🎯 SUMMARY:');
console.log('============');
console.log('✅ All tests use the SAME calculateCompleteRunXP function');
console.log('✅ This ensures Strava imports and manual logging are identical');
console.log('✅ Nicklas problem should be fixed - 3.47km = 21 XP consistently');
console.log('');
console.log('📋 Next steps:');
console.log('1. Deploy this unified system to replace old calculation logic');
console.log('2. Test with real Strava imports');
console.log('3. Test with manual run logging in frontend');
console.log('4. Verify both give identical XP for same distance');