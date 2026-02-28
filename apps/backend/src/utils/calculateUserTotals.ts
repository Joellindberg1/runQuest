import { getSupabaseClient } from '../config/database.js';
import { logger } from './logger.js';
import { getLevelFromXP } from './xpCalculation.js';

export async function calculateUserTotals(userId: string) {
  try {
    console.time(`calculateUserTotals:${userId}`);
    const supabase = getSupabaseClient();

    // Get all runs for the user
    const { data: runs, error } = await supabase
      .from('runs')
      .select('xp_gained, distance, date')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      logger.error('Error fetching user runs:', error);
      return;
    }

    if (!runs || runs.length === 0) {
      logger.info('No runs found for user');
      return;
    }

    // Calculate totals
    const totalXP = runs.reduce((sum: number, run: any) => sum + (run.xp_gained || 0), 0);
    const totalDistance = runs.reduce((sum: number, run: any) => sum + (run.distance || 0), 0);

    // Fetch level and streak in parallel
    const { StreakService } = await import('../services/streakService.js');
    const [level, streakResult] = await Promise.all([
      getLevelFromXP(totalXP),
      StreakService.calculateUserStreaks(userId)
    ]);
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
      logger.error('Error updating user totals:', updateError);
    } else {
      logger.info(`✅ Updated user ${userId} totals: ${totalXP} XP, Level ${level}, ${currentStreak} day streak`);
    }

    // 🏆 Process titles for ALL users to ensure complete leaderboard
    // This is necessary because title rankings depend on ALL users' achievements
    try {
      logger.info('🏆 Processing titles for all users...');
      const { EnhancedTitleService } = await import('../services/enhancedTitleService.js');
      const titleService = new EnhancedTitleService();
      
      // Process titles for ALL users (not just the one who triggered this)
      // This ensures leaderboard always shows correct rankings
      await titleService.processAllUsersTitles();
      
      logger.info('✅ All users titles processed successfully');
      
      // Now refresh the title leaderboard with complete user_titles data
      logger.info('🏆 Refreshing title leaderboard...');
      const supabase = getSupabaseClient();
      const { error: leaderboardError } = await supabase.rpc('update_all_title_leaderboards');
      
      if (leaderboardError) {
        logger.error('❌ Failed to refresh title leaderboard:', leaderboardError);
      } else {
        logger.info('✅ Title leaderboard refreshed successfully');
      }
      
    } catch (titleError) {
      logger.error('❌ Error processing titles:', titleError);
      // Don't throw - user totals were saved successfully
    }

    console.timeEnd(`calculateUserTotals:${userId}`);
  } catch (error) {
    logger.error('Error in calculateUserTotals:', error);
  }
}