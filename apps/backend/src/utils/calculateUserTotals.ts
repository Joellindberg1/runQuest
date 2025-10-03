import { getSupabaseClient } from '../config/database.js';
import { getLevelFromXP } from './xpCalculation.js';
import { enhancedTitleService } from '../services/enhancedTitleService.js';

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
    const totalXP = runs.reduce((sum, run) => sum + (run.xp_gained || 0), 0);
    const totalDistance = runs.reduce((sum, run) => sum + (run.distance || 0), 0);
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
        total_distance: totalDistance,
        total_runs: totalRuns,
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

    // 🏆 Process titles after user totals are updated
    try {
      console.log('🏆 Processing titles after user totals update...');
      await enhancedTitleService.processUserTitlesAfterRun(
        userId, 
        runs.map(run => ({
          date: run.date,
          distance_km: run.distance,
          created_at: run.date // For title calculations
        })), 
        totalDistance, 
        longestStreak
      );
      console.log('✅ Title processing completed');
    } catch (titleError) {
      console.error('❌ Error processing titles:', titleError);
      // Don't fail the whole operation if title processing fails
    }

  } catch (error) {
    console.error('Error in calculateUserTotals:', error);
  }
}