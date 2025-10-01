// Need to compile TS first and run as CommonJS
const { StreakService } = require('./dist/services/streakService.js');

async function testStreakService() {
  console.log('🧪 Testing Universal Streak Service\n');
  
  // Test the static logic methods
  StreakService.testStreakLogic();
  
  // Test Karl's actual streak
  console.log('🔍 Testing Karl\'s actual streak from database:');
  const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
  
  try {
    const karlStreak = await StreakService.calculateUserStreaks(karlUserId);
    console.log('Karl\'s streak result:', karlStreak);
    
    // Test what streak_day Karl's 2025-09-30 run should have
    const specificRun = await StreakService.calculateUserStreaks(karlUserId, '2025-09-30');
    console.log('Karl\'s 2025-09-30 run should have streak_day:', specificRun.streakDayForRun);
    
  } catch (error) {
    console.error('Error testing Karl\'s streak:', error);
  }
}

testStreakService();