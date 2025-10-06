// Test XP calculation for Nicklas's 3.57km run
import dotenv from 'dotenv';
import { calculateRunXP } from './src/utils/xpCalculation.ts';

dotenv.config();

async function testXPCalculation() {
  console.log('🧪 TESTING XP CALCULATION FOR NICKLAS RUN');
  console.log('==========================================');
  
  const testDistance = 3.57; // Nicklas's problematic run
  
  try {
    console.log(`📏 Testing distance: ${testDistance}km`);
    
    const result = await calculateRunXP(testDistance);
    
    console.log('📊 XP Calculation Result:');
    console.log(`  Base XP: ${result.baseXP}`);
    console.log(`  KM XP: ${result.kmXP}`);
    console.log(`  Distance Bonus: ${result.distanceBonus}`);
    console.log(`  Total XP: ${result.totalXP}`);
    
    if (result.totalXP === 0) {
      console.log('❌ PROBLEM FOUND: calculateRunXP returns 0 XP!');
    } else {
      console.log('✅ XP calculation working - problem is elsewhere');
    }
    
    // Test with Karl's successful distances for comparison
    console.log('\n📊 COMPARISON WITH KARL\'S SUCCESSFUL RUNS:');
    
    const karlRun1 = await calculateRunXP(1.02);
    console.log(`Karl 1.02km: ${karlRun1.totalXP} XP`);
    
    const karlRun2 = await calculateRunXP(10.81);
    console.log(`Karl 10.81km: ${karlRun2.totalXP} XP`);
    
  } catch (error) {
    console.error('❌ Error in XP calculation:', error);
  }
}

testXPCalculation();