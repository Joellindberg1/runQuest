// Test edge cases that could cause calculateRunXP to return 0
import dotenv from 'dotenv';
import { calculateRunXP } from './src/utils/xpCalculation.ts';

dotenv.config();

async function testEdgeCases() {
  console.log('🧪 TESTING EDGE CASES FOR XP CALCULATION');
  console.log('========================================');
  
  const testCases = [
    { distance: 3.57, description: "Nicklas's exact case" },
    { distance: 0, description: "Zero distance" },
    { distance: -1, description: "Negative distance" },
    { distance: 0.5, description: "Very short distance" },
    { distance: 1.5, description: "Under minimum distance?" },
    { distance: null, description: "Null distance" },
    { distance: undefined, description: "Undefined distance" },
    { distance: NaN, description: "NaN distance" }
  ];
  
  for (const testCase of testCases) {
    try {
      console.log(`\n📏 Testing ${testCase.description}: ${testCase.distance}`);
      
      if (testCase.distance === null || testCase.distance === undefined || isNaN(testCase.distance)) {
        console.log('⚠️ Invalid input - would cause error');
        continue;
      }
      
      const result = await calculateRunXP(testCase.distance);
      
      console.log(`  Result: ${result.totalXP} XP`);
      console.log(`  Breakdown: Base=${result.baseXP}, KM=${result.kmXP}, Bonus=${result.distanceBonus}`);
      
      if (result.totalXP === 0) {
        console.log('❌ WARNING: Zero XP result!');
      }
      
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
    }
  }
}

testEdgeCases();