import { getSupabaseClient } from '../config/database.js';
import { getLevelFromXP } from './xpCalculation.js';
import { TitleLeaderboardService } from '../services/titleLeaderboardService.js';

export async function calculateUserTotals(userId: string) {
  try {
    const supabase = getSupabaseClient();
    
    // Get all runs for the user
    const { data: runs, error } = await supabase
      .from('runs')
      .select('xp_gained, distance, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching user runs:', error);
      return;
    }

    if (!runs || runs.length === 0) {
      console.log('No runs found for user');
      return;
    }

    // Calculate totals
    const totalXP = runs.reduce((sum: number, run: any) => sum + (run.xp_gained || 0), 0);
    const totalDistance = runs.reduce((sum: number, run: any) => sum + (run.distance || 0), 0);
    const totalRuns = runs.length;

    // Calculate level from XP using database level requirements
    const level = await getLevelFromXP(totalXP);

    // Calculate current streak using new StreakService
    const { StreakService } = await import('../services/streakService.js');
    const streakResult = await StreakService.calculateUserStreaks(userId);
    const currentStreak = streakResult.currentStreak;
    const longestStreak = Math.max(streakResult.longestStreak, currentStreak);

    // Update user record with consistent level calculation
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_xp: totalXP,
        total_km: totalDistance,  // ✅ FIXED: Use correct column name 'total_km'
        current_streak: currentStreak,
        longest_streak: longestStreak,
        current_level: level  // Now consistent with frontend!
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user totals:', updateError);
    } else {
      console.log(`✅ Updated user ${userId} totals: ${totalXP} XP, Level ${level}, ${currentStreak} day streak`);
    }

    // 🏆 Trigger automatic title recalculation after user totals are updated
    // Safety mechanism: Skip if environment variable is set to disable auto-triggers
    if (process.env.DISABLE_AUTO_TITLE_TRIGGERS === 'true') {
      console.log('⚠️ Automatic title triggers disabled via environment variable');
    } else {
      try {
        console.log('🏆 Triggering title leaderboard recalculation...');
        const titleService = new TitleLeaderboardService();
        await titleService.triggerTitleRecalculation();
        console.log('✅ Title recalculation completed successfully');
      } catch (titleError) {
        console.error('❌ Error triggering title recalculation:', titleError);
        // Don't fail the whole operation if title processing fails
      }
    }

  } catch (error) {
    console.error('Error in calculateUserTotals:', error);
  }
}