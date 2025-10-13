import { getSupabaseClient } from '../config/database.js';
import { getLevelFromXP } from './xpCalculation.js';

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

    // 🏆 Process user titles after totals update
    // This populates user_titles table with achieved titles
    try {
      console.log('🏆 Processing user titles...');
      const { EnhancedTitleService } = await import('../services/enhancedTitleService.js');
      const titleService = new EnhancedTitleService();
      
      // Process titles based on user's stats
      await titleService.processUserTitlesAfterRun(
        userId,
        runs,
        totalDistance,
        longestStreak
      );
      
      console.log('✅ User titles processed successfully');
      
      // Now refresh the title leaderboard with updated user_titles data
      console.log('🏆 Refreshing title leaderboard...');
      const supabase = getSupabaseClient();
      const { error: leaderboardError } = await supabase.rpc('update_all_title_leaderboards');
      
      if (leaderboardError) {
        console.error('❌ Failed to refresh title leaderboard:', leaderboardError);
      } else {
        console.log('✅ Title leaderboard refreshed successfully');
      }
      
    } catch (titleError) {
      console.error('❌ Error processing titles:', titleError);
      // Don't throw - user totals were saved successfully
    }

  } catch (error) {
    console.error('Error in calculateUserTotals:', error);
  }
}