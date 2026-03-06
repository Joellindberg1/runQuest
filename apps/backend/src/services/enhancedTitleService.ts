import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import { titleLeaderboardService } from './titleLeaderboardService';

/**
 * Enhanced title processing service that integrates with the new optimized system
 */
export class EnhancedTitleService {
  
  /**
   * Process titles for a user after run updates.
   * Replaces the old checkAndUpdateUserTitles method.
   */
  async processUserTitlesAfterRun(userId: string, runs: any[], totalKm: number, longestStreak: number): Promise<void> {
    try {
      logger.info('🏆 Processing titles for user:', userId);
      logger.info('📈 Stats:', { totalKm, longestStreak, runsCount: runs.length });

      // Get all titles to check
      const { data: titles, error: titlesError } = await supabase.client
        .from('titles')
        .select('id, name, description, unlock_requirement');

      if (titlesError) {
        logger.error('❌ Error fetching titles:', titlesError);
        return;
      }

      const userValues = this.calculateUserValues(runs, totalKm, longestStreak);
      logger.info('🎯 Achievement values:', userValues);

      const earnedAt = new Date().toISOString();

      // Check all titles in parallel
      const titleCheckResults = await Promise.allSettled(
        titles.map((title: any) => this.checkAndUpdateTitle(title, userId, userValues, earnedAt, runs))
      );

      const titlesToUpdate: string[] = titles
        .filter((_: any, i: number) => titleCheckResults[i].status === 'fulfilled' && (titleCheckResults[i] as PromiseFulfilledResult<boolean>).value)
        .map((t: any) => t.id);

      // Refresh leaderboards in parallel
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
    // Calculate longest single run
    const longestRun = runs.reduce((max, run) => {
      const distance = parseFloat(run.distance_km) || 0;
      return Math.max(max, distance);
    }, 0);

    // Calculate weekend average (last 4 weekends)
    // Correct algorithm: Average of weekend averages, not average of all runs
    const weekendAvg = this.calculateWeekendAverage(runs);

    return {
      totalKm,
      longestRun,
      longestStreak,
      weekendAvg
    };
  }

  /**
   * Calculate weekend average correctly (matching frontend):
   * 1. Group runs by weekend (Sat-Sun pairs)
   * 2. Calculate TOTAL distance per weekend (sum all runs in that weekend)
   * 3. Take last 4 weekends
   * 4. Calculate average of those 4 weekend totals
   * 
   * Example:
   * Week 1: Sat 5km + Sun 7km = 12km total
   * Week 2: Sat 13km + Sun 2km = 15km total
   * Week 3: Sat 3.7km = 3.7km total
   * Week 4: Sat 14km + Sun 5km = 19km total
   * Average: (12 + 15 + 3.7 + 19) / 4 = 12.4km
   */
  private calculateWeekendAverage(runs: any[]): number {
    // 1. Filter weekend runs (Saturday = 6, Sunday = 0)
    const weekendRuns = runs.filter(run => {
      const date = new Date(run.date);
      const day = date.getDay();
      return day === 0 || day === 6;
    });

    if (weekendRuns.length === 0) return 0;

    // 2. Group runs by weekend (Saturday-Sunday pairs)
    // Use Monday of the week as key to match frontend
    const weekendTotals = new Map<string, number>();
    
    for (const run of weekendRuns) {
      const date = new Date(run.date);
      const dayOfWeek = date.getDay();
      
      // Get the Monday of the week containing this weekend day (matching frontend)
      const monday = new Date(date);
      monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      monday.setHours(0, 0, 0, 0);
      
      const weekKey = monday.toISOString().split('T')[0];
      
      // Sum up total distance for this weekend (not average)
      const distance = parseFloat(run.distance_km) || 0;
      weekendTotals.set(weekKey, (weekendTotals.get(weekKey) || 0) + distance);
    }

    // 3. Get all weekend totals
    const weekendValues: { date: Date; total: number }[] = [];
    
    for (const [weekKey, total] of weekendTotals.entries()) {
      weekendValues.push({
        date: new Date(weekKey),
        total: total
      });
    }

    // 4. Sort by date (most recent first) — use ALL weekends (not just last 4)
    const recentWeekends = weekendValues
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    if (recentWeekends.length === 0) return 0;

    // 5. Calculate average of the weekend TOTALS (not averages)
    const totalAvg = recentWeekends.reduce((sum, w) => sum + w.total, 0) / recentWeekends.length;

    logger.info(`📊 Weekend calculation: ${recentWeekends.length} weekends, totals:`, 
      recentWeekends.map(w => w.total.toFixed(2)).join(', '),
      `→ Average of totals: ${totalAvg.toFixed(2)}`
    );

    return totalAvg;
  }

  /**
   * Check and update a specific title for a user
   */
  private async checkAndUpdateTitle(
    title: any,
    userId: string,
    userValues: any,
    earnedAt: string,
    allRuns: any[]
  ): Promise<boolean> {
    try {
      // Determine which value to use based on title name
      let userValue = 0;
      let titleKey = '';

      switch (title.name) {
        case 'The Reborn Eliud Kipchoge':
          userValue = userValues.longestRun;
          titleKey = 'longestRun';
          break;
        case 'The Daaaaaviiiiiid GOGGINGS':
          userValue = userValues.longestStreak;
          titleKey = 'longestStreak';
          break;
        case 'The Ultra Man':
          userValue = userValues.totalKm;
          titleKey = 'totalKm';
          break;
        case 'The Weekend Destroyer':
          userValue = userValues.weekendAvg;
          titleKey = 'weekendAvg';
          break;
        default:
          logger.info(`⚠️ Unknown title: ${title.name}`);
          return false;
      }

      logger.info(`🔍 Checking title: "${title.name}" - User: ${userValue}, Required: ${title.unlock_requirement}`);

      // Check if user meets basic requirement
      if (userValue < title.unlock_requirement) {
        logger.info(`❌ User doesn't meet requirement (${userValue} < ${title.unlock_requirement})`);
        return false;
      }

      // Calculate precise achievement value based on runs up to earned_at
      const achievementValue = this.calculateAchievementValue(titleKey, allRuns, new Date(earnedAt));

      logger.info(`📊 Achievement value: ${achievementValue} for ${title.name}`);

      // Check if user already has this title with same or better value
      const { data: existingTitle, error: existingError } = await supabase.client
        .from('user_titles')
        .select('id, value, earned_at')
        .eq('user_id', userId)
        .eq('title_id', title.id)
        .single();

      if (existingError && existingError.code !== 'PGRST116') { // PGRST116 = not found
        logger.error('❌ Error checking existing title:', existingError);
        return false;
      }

      // Add or update user title
      const titleData = {
        user_id: userId,
        title_id: title.id,
        value: achievementValue,
        earned_at: earnedAt
      };

      if (existingTitle) {
        // Check if value changed
        const valueChanged = !existingTitle.value || existingTitle.value !== achievementValue;
        
        if (valueChanged) {
          // Update existing with new value
          const { error: updateError } = await supabase.client
            .from('user_titles')
            .update(titleData)
            .eq('id', existingTitle.id);

          if (updateError) {
            logger.error('❌ Error updating user title:', updateError);
            return false;
          }
          logger.info(`🔄 Updated title ${title.name} for user ${userId}: ${existingTitle.value} → ${achievementValue}`);
        } else {
          logger.info(`✓ Title ${title.name} value unchanged: ${achievementValue}`);
        }
      } else {
        // Insert new title
        const { error: insertError } = await supabase.client
          .from('user_titles')
          .insert(titleData);

        if (insertError) {
          logger.error('❌ Error inserting user title:', insertError);
          return false;
        }
        logger.info(`🆕 Added new title ${title.name} for user ${userId} with value ${achievementValue}`);
      }

      // Always return true if user has this title (whether new or existing)
      // This ensures leaderboard gets refreshed even for existing titles
      return true;

    } catch (error) {
      logger.error(`❌ Error checking title ${title.name}:`, error);
      return false;
    }
  }

  /**
   * Calculate achievement value based on runs up to a specific date
   */
  private calculateAchievementValue(titleKey: string, allRuns: any[], earnedAtDate: Date): number {
    // Filter runs up to the earned_at timestamp
    const relevantRuns = allRuns.filter(run => {
      const runDate = new Date(run.date);
      return runDate <= earnedAtDate;
    });

    switch (titleKey) {
      case 'longestRun':
        return relevantRuns.reduce((max, run) => {
          const distance = parseFloat(run.distance_km) || 0;
          return Math.max(max, distance);
        }, 0);

      case 'totalKm':
        return relevantRuns.reduce((sum, run) => {
          return sum + (parseFloat(run.distance_km) || 0);
        }, 0);

      case 'longestStreak':
        return this.calculateLongestStreakFromRuns(relevantRuns, earnedAtDate);

      case 'weekendAvg':
        // Use the correct weekend average calculation
        return this.calculateWeekendAverage(relevantRuns);

      default:
        return 0;
    }
  }

  /**
   * Calculate longest streak from runs up to a specific date
   */
  private calculateLongestStreakFromRuns(runs: any[], upToDate: Date): number {
    if (runs.length === 0) return 0;

    // Sort runs by date
    const sortedRuns = runs
      .filter(run => new Date(run.date) <= upToDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (sortedRuns.length === 0) return 0;

    let maxStreak = 1;
    let currentStreak = 1;
    let lastDate = new Date(sortedRuns[0].date);

    for (let i = 1; i < sortedRuns.length; i++) {
      const currentDate = new Date(sortedRuns[i].date);
      const daysDiff = Math.floor((currentDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === 1) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else if (daysDiff > 1) {
        currentStreak = 1;
      }
      // If daysDiff === 0, it's the same day, don't reset streak

      lastDate = currentDate;
    }

    return maxStreak;
  }

  /**
   * Process titles for all users (optionally scoped to a group)
   * This ensures complete leaderboard rankings
   */
  async processAllUsersTitles(groupId?: string): Promise<void> {
    try {
      logger.info(groupId
        ? `🏆 Processing titles for users in group ${groupId}...`
        : '🏆 Processing titles for ALL users...'
      );

      // Get users with their totals, optionally filtered by group
      let query = supabase.client
        .from('users')
        .select('id, total_km, longest_streak');

      if (groupId) {
        query = query.eq('group_id', groupId);
      }

      const { data: users, error: usersError } = await query;

      if (usersError) {
        logger.error('❌ Error fetching users:', usersError);
        return;
      }

      logger.info(`📊 Found ${users.length} users to process`);
      const startTime = Date.now();

      // Process all users in parallel
      const userResults = await Promise.allSettled(
        users.map(async (user: any) => {
          const { data: runs, error: runsError } = await supabase.client
            .from('runs')
            .select('date, distance')
            .eq('user_id', user.id)
            .order('date', { ascending: true });

          if (runsError) throw new Error(`Runs fetch failed: ${runsError.message}`);
          if (!runs || runs.length === 0) return; // skip users with no runs

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