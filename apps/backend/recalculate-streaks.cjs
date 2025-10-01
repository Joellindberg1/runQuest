require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

class StreakService {
  static calculateLongestStreak(sortedDays) {
    if (sortedDays.length === 0) return 0;
    let longestStreak = 1;
    let currentStreak = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1]);
      const currDate = new Date(sortedDays[i]);
      const daysDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
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
    const latestDay = sortedDays[sortedDays.length - 1];
    if (latestDay !== todayStr && latestDay !== yesterdayStr) {
      return 0;
    }
    let streak = 1;
    for (let i = sortedDays.length - 2; i >= 0; i--) {
      const currDate = new Date(sortedDays[i]);
      const nextDate = new Date(sortedDays[i + 1]);
      const daysDiff = Math.floor((nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
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
    for (let i = targetIndex - 1; i >= 0; i--) {
      const currDate = new Date(sortedDays[i]);
      const nextDate = new Date(sortedDays[i + 1]);
      const daysDiff = Math.floor((nextDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        streakDay++;
      } else {
        break;
      }
    }
    return streakDay;
  }

  static async calculateUserStreaks(userId, newRunDate = null) {
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
}

async function recalculateAllStreaks() {
  console.log('🔄 Recalculating all user streaks and run streak_day values...\n');

  try {
    // 1. Get all users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name');

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return;
    }

    console.log(`Found ${users.length} users to process:\n`);

    for (const user of users) {
      console.log(`👤 Processing ${user.name} (${user.id})...`);

      // 2. Calculate new streak values
      const streakResult = await StreakService.calculateUserStreaks(user.id);
      
      console.log(`  Current streak: ${streakResult.currentStreak}`);
      console.log(`  Longest streak: ${streakResult.longestStreak}`);

      // 3. Update user's current_streak and longest_streak
      const { error: updateUserError } = await supabase
        .from('users')
        .update({
          current_streak: streakResult.currentStreak,
          longest_streak: streakResult.longestStreak
        })
        .eq('id', user.id);

      if (updateUserError) {
        console.error(`  ❌ Error updating user ${user.name}:`, updateUserError);
        continue;
      }

      // 4. Get all runs for this user to update streak_day values
      const { data: runs, error: runsError } = await supabase
        .from('runs')
        .select('id, date')
        .eq('user_id', user.id)
        .order('date', { ascending: true });

      if (runsError) {
        console.error(`  ❌ Error fetching runs for ${user.name}:`, runsError);
        continue;
      }

      if (runs.length === 0) {
        console.log(`  No runs to update for ${user.name}`);
        continue;
      }

      console.log(`  Updating ${runs.length} runs...`);

      // 5. Calculate correct streak_day for each run
      const uniqueDays = [...new Set(runs.map(run => run.date))].sort();
      
      for (const run of runs) {
        const correctStreakDay = StreakService.calculateStreakDayForSpecificRun(uniqueDays, run.date);
        
        // Update the run's streak_day
        const { error: updateRunError } = await supabase
          .from('runs')
          .update({ streak_day: correctStreakDay })
          .eq('id', run.id);

        if (updateRunError) {
          console.error(`    ❌ Error updating run ${run.id}:`, updateRunError);
        }
      }

      console.log(`  ✅ Updated ${user.name} successfully\n`);
    }

    console.log('🎉 All streaks recalculated successfully!');

    // 6. Show summary for verification
    console.log('\n📊 VERIFICATION - Karl\'s data after recalculation:');
    const karlUserId = 'd802fe3f-81f6-4007-8834-59664fc9711d';
    
    const { data: karlUser } = await supabase
      .from('users')
      .select('name, current_streak, longest_streak')
      .eq('id', karlUserId)
      .single();

    const { data: karlRuns } = await supabase
      .from('runs')
      .select('date, streak_day, distance')
      .eq('user_id', karlUserId)
      .order('date', { ascending: false })
      .limit(5);

    if (karlUser) {
      console.log(`${karlUser.name}:`);
      console.log(`  Current streak: ${karlUser.current_streak} (should be 1)`);
      console.log(`  Longest streak: ${karlUser.longest_streak} (should be 1)`);
    }

    if (karlRuns && karlRuns.length > 0) {
      console.log('  Recent runs:');
      karlRuns.forEach(run => {
        console.log(`    ${run.date}: ${run.distance}km, streak_day: ${run.streak_day}`);
      });
    }

  } catch (error) {
    console.error('Error in recalculateAllStreaks:', error);
  }
}

recalculateAllStreaks();