require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

class StreakService {
  static calculateLongestStreak(sortedDays) {
    if (sortedDays.length === 0) return 0;

    let longestStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1]);
      const currDate = new Date(sortedDays[i]);
      
      const daysDiff = Math.floor(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        currentStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    }

    return Math.max(longestStreak, currentStreak);
  }

  static calculateCurrentStreak(sortedDays) {
    if (sortedDays.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Kontrollera om senaste run är idag eller igår
    const latestDay = sortedDays[sortedDays.length - 1];
    if (latestDay !== todayStr && latestDay !== yesterdayStr) {
      return 0; // Streak är bruten
    }

    // Räkna bakåt från senaste dagen
    let streak = 1;
    for (let i = sortedDays.length - 2; i >= 0; i--) {
      const currDate = new Date(sortedDays[i]);
      const nextDate = new Date(sortedDays[i + 1]);
      
      const daysDiff = Math.floor(
        (nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  static calculateStreakDayForSpecificRun(sortedDays, targetDate) {
    const targetIndex = sortedDays.indexOf(targetDate);
    if (targetIndex === -1) return 1;

    let streakDay = 1;
    
    // Räkna bakåt från target datum
    for (let i = targetIndex - 1; i >= 0; i--) {
      const currDate = new Date(sortedDays[i]);
      const nextDate = new Date(sortedDays[i + 1]);
      
      const daysDiff = Math.floor(
        (nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        streakDay++;
      } else {
        break;
      }
    }

    return streakDay;
  }

  static async calculateUserStreaks(userId, newRunDate) {
    // Hämta alla runs för användaren
    const { data: allRuns, error } = await supabase
      .from('runs')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching runs:', error);
      return { currentStreak: 0, streakDayForRun: 1, longestStreak: 0 };
    }

    const runs = allRuns || [];
    if (newRunDate) {
      runs.push({ date: newRunDate });
    }

    // Skapa set av unika dagar
    const uniqueDays = new Set(runs.map(run => run.date));
    const sortedDays = Array.from(uniqueDays).sort();

    if (sortedDays.length === 0) {
      return { currentStreak: 0, streakDayForRun: 1, longestStreak: 0 };
    }

    const longestStreak = this.calculateLongestStreak(sortedDays);
    const currentStreak = this.calculateCurrentStreak(sortedDays);

    let streakDayForRun = 1;
    if (newRunDate) {
      streakDayForRun = this.calculateStreakDayForSpecificRun(sortedDays, newRunDate);
    }

    return {
      currentStreak,
      streakDayForRun,
      longestStreak
    };
  }

  static testStreakLogic() {
    console.log('🧪 Testing Streak Logic...\n');

    // Test case 1: Karl's actual situation
    const karlDays = ['2025-09-30'];
    console.log('Test 1 - Karl (only 2025-09-30):');
    console.log('Days:', karlDays);
    console.log('Longest streak:', this.calculateLongestStreak(karlDays));
    console.log('Current streak:', this.calculateCurrentStreak(karlDays));
    console.log('Streak day for 2025-09-30:', this.calculateStreakDayForSpecificRun(karlDays, '2025-09-30'));
    console.log('');

    // Test case 2: Consecutive days
    const consecutiveDays = ['2025-09-28', '2025-09-29', '2025-09-30'];
    console.log('Test 2 - Consecutive (28, 29, 30):');
    console.log('Days:', consecutiveDays);
    console.log('Longest streak:', this.calculateLongestStreak(consecutiveDays));
    console.log('Current streak:', this.calculateCurrentStreak(consecutiveDays));
    console.log('Streak day for 2025-09-30:', this.calculateStreakDayForSpecificRun(consecutiveDays, '2025-09-30'));
    console.log('');

    // Test case 3: Adding run in retrospect
    const retroDays = ['2025-09-28', '2025-09-29', '2025-09-30', '2025-10-01'];
    console.log('Test 3 - Adding runs retrospectively (28, 29, 30, 01):');
    console.log('Days:', retroDays);
    console.log('Longest streak:', this.calculateLongestStreak(retroDays));
    console.log('Current streak:', this.calculateCurrentStreak(retroDays));
    console.log('Streak day for 2025-10-01:', this.calculateStreakDayForSpecificRun(retroDays, '2025-10-01'));
    console.log('');
  }
}

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