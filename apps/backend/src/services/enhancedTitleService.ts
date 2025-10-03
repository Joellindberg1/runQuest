import { supabase } from '../config/database';
import { titleLeaderboardService } from './titleLeaderboardService';

/**
 * Enhanced title processing service that integrates with the new optimized system
 */
export class EnhancedTitleService {
  
  /**
   * Process titles for a user after run updates
   * This replaces the old checkAndUpdateUserTitles method
   */
  async processUserTitlesAfterRun(userId: string, runs: any[], totalKm: number, longestStreak: number): Promise<void> {
    try {
      console.log('🏆 Processing titles for user:', userId);
      console.log('📈 Stats:', { totalKm, longestStreak, runsCount: runs.length });

      // Get all titles to check
      const { data: titles, error: titlesError } = await supabase.client
        .from('titles')
        .select('*');

      if (titlesError) {
        console.error('❌ Error fetching titles:', titlesError);
        return;
      }

      const userValues = this.calculateUserValues(runs, totalKm, longestStreak);
      console.log('🎯 Achievement values:', userValues);

      const earnedAt = new Date().toISOString();
      const titlesToUpdate = new Set<string>();

      // Check each title
      for (const title of titles) {
        const updated = await this.checkAndUpdateTitle(
          title,
          userId,
          userValues,
          earnedAt,
          runs
        );
        
        if (updated) {
          titlesToUpdate.add(title.id);
        }
      }

      // Refresh leaderboards for updated titles
      for (const titleId of titlesToUpdate) {
        await titleLeaderboardService.refreshTitleLeaderboard(titleId);
      }

      console.log(`✅ Processed ${titles.length} titles, updated ${titlesToUpdate.size} leaderboards`);

    } catch (error) {
      console.error('❌ Error processing user titles:', error);
    }
  }

  /**
   * Calculate user achievement values from runs
   */
  private calculateUserValues(runs: any[], totalKm: number, longestStreak: number) {
    // Calculate longest single run
    const longestRun = runs.reduce((max, run) => {
      const distance = parseFloat(run.distance_km) || 0;
      return Math.max(max, distance);
    }, 0);

    // Calculate weekend average (last 4 weekends)
    const weekendRuns = runs.filter(run => {
      const runDate = new Date(run.date);
      const dayOfWeek = runDate.getDay();
      return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
    });

    const recentWeekendRuns = weekendRuns
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8); // Last 8 weekend runs (roughly 4 weekends)

    const weekendAvg = recentWeekendRuns.length > 0
      ? recentWeekendRuns.reduce((sum, run) => sum + (parseFloat(run.distance_km) || 0), 0) / recentWeekendRuns.length
      : 0;

    return {
      totalKm,
      longestRun,
      longestStreak,
      weekendAvg
    };
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
          console.log(`⚠️ Unknown title: ${title.name}`);
          return false;
      }

      console.log(`🔍 Checking title: "${title.name}" - User: ${userValue}, Required: ${title.unlock_requirement}`);

      // Check if user meets basic requirement
      if (userValue < title.unlock_requirement) {
        console.log(`❌ User doesn't meet requirement (${userValue} < ${title.unlock_requirement})`);
        return false;
      }

      // Calculate precise achievement value based on runs up to earned_at
      const achievementValue = this.calculateAchievementValue(titleKey, allRuns, new Date(earnedAt));

      console.log(`📊 Achievement value: ${achievementValue} for ${title.name}`);

      // Check if user already has this title with same or better value
      const { data: existingTitle, error: existingError } = await supabase.client
        .from('user_titles')
        .select('*')
        .eq('user_id', userId)
        .eq('title_id', title.id)
        .single();

      if (existingError && existingError.code !== 'PGRST116') { // PGRST116 = not found
        console.error('❌ Error checking existing title:', existingError);
        return false;
      }

      // If user already has this title with better or equal value, skip
      if (existingTitle && existingTitle.value && existingTitle.value >= achievementValue) {
        console.log(`⏭️ User already has better/equal value for ${title.name}: ${existingTitle.value} >= ${achievementValue}`);
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
        // Update existing
        const { error: updateError } = await supabase.client
          .from('user_titles')
          .update(titleData)
          .eq('id', existingTitle.id);

        if (updateError) {
          console.error('❌ Error updating user title:', updateError);
          return false;
        }
        console.log(`🔄 Updated title ${title.name} for user ${userId}`);
      } else {
        // Insert new
        const { error: insertError } = await supabase.client
          .from('user_titles')
          .insert(titleData);

        if (insertError) {
          console.error('❌ Error inserting user title:', insertError);
          return false;
        }
        console.log(`🆕 Added new title ${title.name} for user ${userId}`);
      }

      return true;

    } catch (error) {
      console.error(`❌ Error checking title ${title.name}:`, error);
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
        const weekendRuns = relevantRuns.filter(run => {
          const runDate = new Date(run.date);
          const dayOfWeek = runDate.getDay();
          return dayOfWeek === 0 || dayOfWeek === 6;
        });

        const recentWeekendRuns = weekendRuns
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 8);

        return recentWeekendRuns.length > 0
          ? recentWeekendRuns.reduce((sum, run) => sum + (parseFloat(run.distance_km) || 0), 0) / recentWeekendRuns.length
          : 0;

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
}

export const enhancedTitleService = new EnhancedTitleService();