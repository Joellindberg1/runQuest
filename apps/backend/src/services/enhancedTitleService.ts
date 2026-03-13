import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import { titleLeaderboardService } from './titleLeaderboardService';
import { titleEngineRegistry } from '../titleEngines/index';
import type { RunData, UserStats } from '../titleEngines/types';

/**
 * Enhanced title processing service that integrates with the new optimized system
 */
export class EnhancedTitleService {

  /**
   * Process titles for a user after run updates.
   */
  async processUserTitlesAfterRun(userId: string, runs: any[], totalKm: number, longestStreak: number): Promise<void> {
    try {
      logger.info('🏆 Processing titles for user:', userId);
      logger.info('📈 Stats:', { totalKm, longestStreak, runsCount: runs.length });

      const { data: titles, error: titlesError } = await supabase.client
        .from('titles')
        .select('id, name, description, unlock_requirement, metric_key');

      if (titlesError) {
        logger.error('❌ Error fetching titles:', titlesError);
        return;
      }

      const runData: RunData[] = runs.map((r: any) => ({
        date: r.date,
        distance_km: parseFloat(r.distance_km) || 0,
      }));
      const userStats: UserStats = { totalKm, longestStreak };

      const earnedAt = new Date().toISOString();

      const titleCheckResults = await Promise.allSettled(
        titles.map((title: any) => this.checkAndUpdateTitle(title, userId, runData, userStats, earnedAt))
      );

      const titlesToUpdate: string[] = titles
        .filter((_: any, i: number) =>
          titleCheckResults[i].status === 'fulfilled' &&
          (titleCheckResults[i] as PromiseFulfilledResult<boolean>).value
        )
        .map((t: any) => t.id);

      await Promise.allSettled(
        titlesToUpdate.map((titleId: string) => titleLeaderboardService.refreshTitleLeaderboard(titleId))
      );

      logger.info(`✅ Processed ${titles.length} titles, updated ${titlesToUpdate.length} leaderboards`);

    } catch (error) {
      logger.error('❌ Error processing user titles:', error);
    }
  }

  /**
   * Calculate user achievement values from runs (public for use in API endpoints)
   */
  calculateUserValues(runs: any[], totalKm: number, longestStreak: number) {
    const runData: RunData[] = runs.map((r: any) => ({
      date: r.date,
      distance_km: parseFloat(r.distance_km) || 0,
    }));
    const userStats: UserStats = { totalKm, longestStreak };

    const result: Record<string, number> = {};
    for (const [key, engine] of titleEngineRegistry) {
      result[key] = engine.calculate(runData, userStats);
    }
    return result;
  }

  /**
   * Check and update a specific title for a user
   */
  private async checkAndUpdateTitle(
    title: any,
    userId: string,
    runs: RunData[],
    userStats: UserStats,
    earnedAt: string
  ): Promise<boolean> {
    try {
      const engine = titleEngineRegistry.get(title.metric_key);
      if (!engine) {
        logger.warn(`⚠️ No engine registered for metric_key: "${title.metric_key}" (title: "${title.name}")`);
        return false;
      }

      const userValue = engine.calculate(runs, userStats);
      logger.info(`🔍 Checking title: "${title.name}" — value: ${userValue}, required: ${title.unlock_requirement}`);

      if (userValue < title.unlock_requirement) {
        logger.info(`❌ Requirement not met (${userValue} < ${title.unlock_requirement})`);
        return false;
      }

      const { data: existingTitle, error: existingError } = await supabase.client
        .from('user_titles')
        .select('id, value')
        .eq('user_id', userId)
        .eq('title_id', title.id)
        .single();

      if (existingError && existingError.code !== 'PGRST116') {
        logger.error('❌ Error checking existing title:', existingError);
        return false;
      }

      const titleData = { user_id: userId, title_id: title.id, value: userValue, earned_at: earnedAt };

      if (existingTitle) {
        if (existingTitle.value !== userValue) {
          const { error } = await supabase.client.from('user_titles').update(titleData).eq('id', existingTitle.id);
          if (error) { logger.error('❌ Error updating user title:', error); return false; }
          logger.info(`🔄 Updated "${title.name}": ${existingTitle.value} → ${userValue}`);
        } else {
          logger.info(`✓ "${title.name}" value unchanged: ${userValue}`);
        }
      } else {
        const { error } = await supabase.client.from('user_titles').insert(titleData);
        if (error) { logger.error('❌ Error inserting user title:', error); return false; }
        logger.info(`🆕 Awarded "${title.name}" to user ${userId} with value ${userValue}`);
      }

      return true;

    } catch (error) {
      logger.error(`❌ Error checking title "${title.name}":`, error);
      return false;
    }
  }

  /**
   * Process titles for all users (optionally scoped to a group)
   */
  async processAllUsersTitles(groupId?: string): Promise<void> {
    try {
      logger.info(groupId
        ? `🏆 Processing titles for users in group ${groupId}...`
        : '🏆 Processing titles for ALL users...'
      );

      let query = supabase.client.from('users').select('id, total_km, longest_streak');
      if (groupId) query = query.eq('group_id', groupId);

      const { data: users, error: usersError } = await query;
      if (usersError) { logger.error('❌ Error fetching users:', usersError); return; }

      logger.info(`📊 Found ${users.length} users to process`);
      const startTime = Date.now();

      const userResults = await Promise.allSettled(
        users.map(async (user: any) => {
          const { data: runs, error: runsError } = await supabase.client
            .from('runs')
            .select('date, distance')
            .eq('user_id', user.id)
            .order('date', { ascending: true });

          if (runsError) throw new Error(`Runs fetch failed: ${runsError.message}`);
          if (!runs || runs.length === 0) return;

          const runsWithAlias = runs.map((run: any) => ({ ...run, distance_km: run.distance }));
          await this.processUserTitlesAfterRun(user.id, runsWithAlias, user.total_km || 0, user.longest_streak || 0);
        })
      );

      const processedCount = userResults.filter(r => r.status === 'fulfilled').length;
      const failedCount = userResults.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) logger.error(`❌ Title processing failed for ${failedCount} users`);

      logger.info(`✅ Processed titles for ${processedCount}/${users.length} users in ${Date.now() - startTime}ms`);

    } catch (error) {
      logger.error('❌ Error processing all users titles:', error);
      throw error;
    }
  }
}

export const enhancedTitleService = new EnhancedTitleService();
