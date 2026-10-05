import { getSupabaseClient } from '../config/database.js';
import { logger } from './logger.js';
import { getLevelFromXP } from '../services/levelService.js';
import { reconcileTokensForLevel } from '../services/challengeService.js';
import { recordLevelUps, recordRunMilestones } from '../services/activityLog.js';

export async function calculateUserTotals(userId: string, groupId?: string) {
  try {
    const startTime = Date.now();
    const supabase = getSupabaseClient();

    // Get all runs for the user
    const { data: runs, error } = await supabase
      .from('runs')
      .select('xp_gained, distance, date, start_time, total_elevation_gain, pace_std_dev, moving_time')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error) {
      logger.error('Error fetching user runs:', error);
      return;
    }

    // OBS: ingen tidig return vid noll rundor (bugg #3). Raderas sista rundan
    // måste totaler, level, streak, tokens och titlar nollställas/omräknas —
    // annars står gammal XP/streak kvar. Beräkningen nedan hanterar tom lista:
    // totalXP = event_xp, distans 0, streak 0, titlar återkallas.
    const userRuns = runs ?? [];

    // Fetch event_xp separately — accumulated from event settlements.
    // current_level/total_km/group_id läses i SAMMA select och är "föregående värden" för Pack News
    // (level_up/run_milestone, ADR 008); gruppen kommer ur users.group_id, inte ur groupId-parametern.
    const { data: userData } = await supabase
      .from('users')
      .select('event_xp, current_level, total_km, group_id')
      .eq('id', userId)
      .single();
    const eventXP: number = userData?.event_xp ?? 0;
    const prevLevel: number | null = typeof userData?.current_level === 'number' ? userData.current_level : null;
    const prevTotalKm: number | null = userData?.total_km == null ? null : Number(userData.total_km);
    const userGroupId: string | null = userData?.group_id ?? null;

    // Calculate totals
    const runsXP = userRuns.reduce((sum: number, run: any) => sum + (run.xp_gained || 0), 0);
    const totalXP = runsXP + eventXP;
    const totalDistance = userRuns.reduce((sum: number, run: any) => sum + (run.distance || 0), 0);

    // Fetch level and streak in parallel (current_level no longer needed here)
    const { StreakService } = await import('../services/streakService.js');
    const [level, streakResult] = await Promise.all([
      getLevelFromXP(totalXP),
      StreakService.calculateUserStreaks(userId),
    ]);
    const currentStreak = streakResult.currentStreak;
    const longestStreak = Math.max(streakResult.longestStreak, currentStreak);

    // Reconcile challenge tokens against the user's current level.
    // Awards tokens for newly reached levels; removes unsent tokens if level dropped.
    await reconcileTokensForLevel(userId, level);

    // Update user record with consistent level calculation
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_xp: totalXP,
        total_km: totalDistance,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        current_level: level
      })
      .eq('id', userId);

    if (updateError) {
      logger.error('Error updating user totals:', updateError);
    } else {
      logger.info(`✅ Updated user ${userId} totals: ${totalXP} XP, Level ${level}, ${currentStreak} day streak`);

      // Pack News: loggen skrivs EFTER att totalerna sparats och rör aldrig deras beräkning (ADR 005/008).
      // Båda anropen är icke-kastande och jämför mot FÖREGÅENDE värden — ingen historieflod vid deploy.
      await recordLevelUps(userId, prevLevel, level, userGroupId);
      // users.total_km är numeric(8,2): jämförs avrundat så att "föregående" (lagrat) och "nytt" är på samma skala.
      await recordRunMilestones(userId, prevTotalKm, Math.round(totalDistance * 100) / 100, userGroupId);
    }

    // 🏆 Process titles for ALL users to ensure complete leaderboard
    // This is necessary because title rankings depend on ALL users' achievements
    try {
      logger.info('🏆 Processing titles for all users...');
      const { EnhancedTitleService } = await import('../services/enhancedTitleService.js');
      const titleService = new EnhancedTitleService();
      
      // Process titles for all users in the same group
      // This ensures leaderboard always shows correct rankings within the group
      await titleService.processAllUsersTitles(groupId);
      
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

    logger.info(`✅ calculateUserTotals:${userId} completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    logger.error('Error in calculateUserTotals:', error);
  }
}