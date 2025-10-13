import { supabase } from '../config/database';
import { titleLeaderboardService } from './titleLeaderboardService';

/**
 * Enhanced title processing service that integrates with the new optimized system
 */
export class EnhancedTitleService {
  
  /**
   * Process titles for a user after run updates          // Get user's runs
          const { data: runs, error: runsError } = await supabase.client
            .from('runs')
            .select('date, distance')
            .eq('user_id', user.id)
            .order('date', { ascending: true});

          // Add distance_km alias for compatibility with calculateUserValues
          const runsWithAlias = runs?.map(run => ({
            ...run,
            distance_km: run.distance
          }));This replaces the old checkAndUpdateUserTitles method
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
   * Calculate weekend average correctly:
   * 1. Group runs by weekend (Sat-Sun pairs)
   * 2. Calculate average per weekend
   * 3. Take last 4 weekends
   * 4. Calculate average of those 4 weekend averages
   * 
   * Example:
   * Week 1: Sat 15km, Sun 7.5km → avg 11.25
   * Week 2: Sat 10km → avg 10 (only one day)
   * Week 3: Sat 10km, Sun 6km → avg 8
   * Total: (11.25 + 10 + 8) / 3 = 9.75
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
    // Use ISO week number to group correctly
    const weekendGroups = new Map<string, any[]>();
    
    for (const run of weekendRuns) {
      const date = new Date(run.date);
      const dayOfWeek = date.getDay();
      
      // Get the Saturday of this weekend as the key
      const saturday = new Date(date);
      if (dayOfWeek === 0) {
        // If Sunday, go back 1 day to get Saturday
        saturday.setDate(date.getDate() - 1);
      }
      // If already Saturday (6), keep it
      saturday.setHours(0, 0, 0, 0);
      
      const weekKey = saturday.toISOString().split('T')[0];
      
      if (!weekendGroups.has(weekKey)) {
        weekendGroups.set(weekKey, []);
      }
      weekendGroups.get(weekKey)!.push(run);
    }

    // 3. Calculate average distance for each weekend
    const weekendAverages: { date: Date; avg: number }[] = [];
    
    for (const [weekKey, weekRuns] of weekendGroups.entries()) {
      const weekTotal = weekRuns.reduce((sum, run) => 
        sum + (parseFloat(run.distance_km) || 0), 0
      );
      const weekAvg = weekTotal / weekRuns.length;
      
      weekendAverages.push({
        date: new Date(weekKey),
        avg: weekAvg
      });
    }

    // 4. Sort by date (most recent first) and take last 4 weekends
    const recentWeekends = weekendAverages
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 4);

    if (recentWeekends.length === 0) return 0;

    // 5. Calculate average of the weekend averages
    const totalAvg = recentWeekends.reduce((sum, w) => sum + w.avg, 0) / recentWeekends.length;

    console.log(`📊 Weekend calculation: ${recentWeekends.length} weekends, averages:`, 
      recentWeekends.map(w => w.avg.toFixed(2)).join(', '),
      `→ Total avg: ${totalAvg.toFixed(2)}`
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
            console.error('❌ Error updating user title:', updateError);
            return false;
          }
          console.log(`🔄 Updated title ${title.name} for user ${userId}: ${existingTitle.value} → ${achievementValue}`);
        } else {
          console.log(`✓ Title ${title.name} value unchanged: ${achievementValue}`);
        }
      } else {
        // Insert new title
        const { error: insertError } = await supabase.client
          .from('user_titles')
          .insert(titleData);

        if (insertError) {
          console.error('❌ Error inserting user title:', insertError);
          return false;
        }
        console.log(`🆕 Added new title ${title.name} for user ${userId} with value ${achievementValue}`);
      }

      // Always return true if user has this title (whether new or existing)
      // This ensures leaderboard gets refreshed even for existing titles
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
   * Process titles for ALL users
   * This ensures complete leaderboard rankings
   */
  async processAllUsersTitles(): Promise<void> {
    try {
      console.log('🏆 Processing titles for ALL users...');
      
      // Get all users with their totals
      const { data: users, error: usersError } = await supabase.client
        .from('users')
        .select('id, total_km, longest_streak');

      if (usersError) {
        console.error('❌ Error fetching users:', usersError);
        return;
      }

      console.log(`📊 Found ${users.length} users to process`);

      let processedCount = 0;
      
      // Process each user
      for (const user of users) {
        try {
          // Get user's runs
          const { data: runs, error: runsError } = await supabase.client
            .from('runs')
            .select('date, distance')
            .eq('user_id', user.id)
            .order('date', { ascending: true });

          if (runsError) {
            console.error(`❌ Error fetching runs for user ${user.id}:`, runsError);
            continue;
          }

          if (!runs || runs.length === 0) {
            console.log(`⏭️ User ${user.id} has no runs, skipping`);
            continue;
          }

          // Add distance_km alias for compatibility with calculateUserValues
          const runsWithAlias = runs.map((run: any) => ({
            ...run,
            distance_km: run.distance
          }));

          // Process titles for this user
          await this.processUserTitlesAfterRun(
            user.id,
            runsWithAlias,
            user.total_km || 0,
            user.longest_streak || 0
          );

          processedCount++;
          
        } catch (userError) {
          console.error(`❌ Error processing user ${user.id}:`, userError);
          // Continue with next user
        }
      }

      console.log(`✅ Processed titles for ${processedCount}/${users.length} users`);

    } catch (error) {
      console.error('❌ Error processing all users titles:', error);
      throw error;
    }
  }
}

export const enhancedTitleService = new EnhancedTitleService();