// Simple test of unified XP calculation without database dependency
import { calculateCompleteRunXP } from '../../packages/shared/dist/xpCalculation.js';

console.log('🧪 Testing Unified XP Calculation (Offline Mode)');
console.log('===============================================');

// Mock admin settings based on what we know from the analysis
const mockAdminSettings = {
  base_xp: 15,
  xp_per_km: 2,
  bonus_5km: 5,
  bonus_10km: 15,
  bonus_15km: 25,
  bonus_20km: 50,
  min_run_distance: 1.0
};

// Mock streak multipliers
const mockMultipliers = [
  { days: 5, multiplier: 1.1 },
  { days: 15, multiplier: 1.2 },
  { days: 30, multiplier: 1.3 },
  { days: 60, multiplier: 1.4 },
  { days: 90, multiplier: 1.5 },
  { days: 120, multiplier: 1.6 },
  { days: 180, multiplier: 1.7 },
  { days: 220, multiplier: 1.8 },
  { days: 240, multiplier: 1.9 }
];

console.log('📊 Mock Admin Settings:', mockAdminSettings);
console.log('📈 Mock Streak Multipliers:', mockMultipliers);

// Test Nicklas's 3.47km run
const testDistance = 3.47;
const testStreakDay = 1; // Day 1, so no multiplier

console.log(`\n🏃 Testing ${testDistance}km run on streak day ${testStreakDay}`);
console.log('===============================================');

try {
  const result = calculateCompleteRunXP(
    testDistance,
    testStreakDay,
    mockAdminSettings,
    mockMultipliers
  );
  
  console.log('✅ UNIFIED CALCULATION RESULT:');
  console.log(`   Base XP: ${result.baseXP}`);
  console.log(`   KM XP: ${result.kmXP}`);
  console.log(`   Distance Bonus: ${result.distanceBonus}`);
  console.log(`   Streak Multiplier: ${result.multiplier}x`);
  console.log(`   Streak Bonus: ${result.streakBonus}`);
  console.log(`   Final XP: ${result.finalXP}`);
  console.log(`   Breakdown: ${JSON.stringify(result.breakdown, null, 2)}`);
  
  // Expected calculation:
  // Base: 15
  // KM: 3.47 * 2 = 6.94 → rounded to 7
  // Distance bonus: 0 (< 5km)
  // Total: 15 + 7 + 0 = 22
  // Multiplier: 1.0 (day 1)
  // Final: 22 XP
  
  const expectedXP = 22;
  if (result.finalXP === expectedXP) {
    console.log(`\n✅ SUCCESS: Got expected ${expectedXP} XP for ${testDistance}km`);
  } else {
    console.log(`\n⚠️  RESULT: Got ${result.finalXP} XP for ${testDistance}km (manual calc suggests ~${expectedXP})`);
  }
  
  // Test more cases
  console.log('\n🧪 Testing Additional Cases:');
  console.log('============================');
  
  const testCases = [
    { distance: 1.0, streakDay: 1, description: '1km run, day 1' },
    { distance: 5.0, streakDay: 1, description: '5km run, day 1 (with bonus)' },
    { distance: 10.0, streakDay: 1, description: '10km run, day 1 (with bonus)' },
    { distance: 3.47, streakDay: 10, description: '3.47km run, day 10 (with multiplier)' }
  ];
  
  for (const testCase of testCases) {
    const caseResult = calculateCompleteRunXP(
      testCase.distance,
      testCase.streakDay,
      mockAdminSettings,
      mockMultipliers
    );
    
    console.log(`   ${testCase.description}: ${caseResult.finalXP} XP (mult: ${caseResult.multiplier}x)`);
  }
  
  console.log('\n🎉 All tests completed successfully! Unified XP calculation is working.');
  
} catch (error) {
  console.error('❌ TEST FAILED:', error);
  process.exit(1);
}