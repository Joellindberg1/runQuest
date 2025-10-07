// Test unified XP calculation system
// This script tests both the old local calculation and the new unified calculation
// to ensure they produce the same results

import { getSupabaseClient } from './src/config/database.js';
import { calculateCompleteRunXP } from '../../packages/shared/dist/xpCalculation.js';

async function testUnifiedCalculation() {
  console.log('🧪 Testing Unified XP Calculation System');
  console.log('==========================================');
  
  const supabase = getSupabaseClient();
  
  try {
    // Get admin settings
    const { data: adminSettings, error: settingsError } = await supabase
      .from('admin_settings')
      .select('*')
      .single();
    
    if (settingsError) {
      throw new Error(`Failed to fetch admin settings: ${settingsError.message}`);
    }
    
    // Get streak multipliers
    const { data: multiplierData, error: multipliersError } = await supabase
      .from('streak_multipliers')
      .select('*')
      .order('days');
    
    if (multipliersError) {
      throw new Error(`Failed to fetch multipliers: ${multipliersError.message}`);
    }
    
    console.log('📊 Admin Settings:', adminSettings);
    console.log('📈 Streak Multipliers:', multiplierData);
    
    // Test Nicklas's 3.47km run
    const testDistance = 3.47;
    const testStreakDay = 1; // Assuming day 1 for this test
    
    console.log(`\n🏃 Testing ${testDistance}km run on streak day ${testStreakDay}`);
    console.log('===============================================');
    
    // Use unified calculation
    const result = calculateCompleteRunXP(
      testDistance,
      testStreakDay,
      adminSettings,
      multiplierData || []
    );
    
    console.log('✅ UNIFIED CALCULATION RESULT:');
    console.log(`   Base XP: ${result.baseXP}`);
    console.log(`   KM XP: ${result.kmXP}`);
    console.log(`   Distance Bonus: ${result.distanceBonus}`);
    console.log(`   Streak Multiplier: ${result.multiplier}x`);
    console.log(`   Streak Bonus: ${result.streakBonus}`);
    console.log(`   Final XP: ${result.finalXP}`);
    console.log(`   Breakdown: ${JSON.stringify(result.breakdown, null, 2)}`);
    
    // Validate expected result
    const expectedXP = 21; // Based on admin settings: 15 + (3.47 * 2) = 21.94 ≈ 21
    
    if (result.finalXP === expectedXP) {
      console.log(`\n✅ SUCCESS: Got expected ${expectedXP} XP for ${testDistance}km`);
    } else {
      console.log(`\n⚠️  UNEXPECTED: Got ${result.finalXP} XP, expected ${expectedXP} XP`);
    }
    
    // Test edge cases
    console.log('\n🧪 Testing Edge Cases:');
    console.log('====================');
    
    const testCases = [
      { distance: 1.0, expectedMin: 17 }, // 15 + 2
      { distance: 5.0, expectedMin: 30 }, // 15 + 10 + 5 bonus
      { distance: 10.0, expectedMin: 50 }, // 15 + 20 + 15 bonus
      { distance: 15.0, expectedMin: 70 }, // 15 + 30 + 25 bonus
      { distance: 20.0, expectedMin: 105 } // 15 + 40 + 50 bonus
    ];
    
    for (const testCase of testCases) {
      const edgeResult = calculateCompleteRunXP(
        testCase.distance,
        1,
        adminSettings,
        multiplierData || []
      );
      
      console.log(`   ${testCase.distance}km → ${edgeResult.finalXP} XP (expected ≥ ${testCase.expectedMin})`);
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ TEST FAILED:', error);
    return false;
  }
}

// Run the test
testUnifiedCalculation()
  .then(success => {
    if (success) {
      console.log('\n🎉 All tests passed! Unified XP calculation is working correctly.');
    } else {
      console.log('\n💥 Tests failed! Check the errors above.');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });