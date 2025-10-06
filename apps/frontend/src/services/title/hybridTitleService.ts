// 🔄 Hybrid Title Service - Falls back to old system if new fails
import { optimizedTitleService } from './optimizedTitleService'
import { titleService as oldTitleService } from './titleService'

export const hybridTitleService = {
  async getUserTitles(userId: string) {
    console.log(`🔄 HybridTitleService: Trying optimized service first for user ${userId}...`);
    
    try {
      // Try the new optimized service first
      const optimizedResult = await optimizedTitleService.getUserTitles(userId);
      
      if (optimizedResult && optimizedResult.length > 0) {
        console.log('✅ Optimized service returned data:', optimizedResult.length, 'titles');
        return optimizedResult;
      }
      
      console.log('⚠️ Optimized service returned empty, trying fallback...');
      
      // Fall back to old service if optimized returns empty
      const fallbackResult = await oldTitleService.getUserTitles(userId);
      console.log('🔄 Fallback service returned:', fallbackResult.length, 'titles');
      
      return fallbackResult;
      
    } catch (error) {
      console.error('❌ Error in hybrid service:', error);
      
      // If everything fails, try old service as last resort
      try {
        console.log('🆘 Last resort: trying old service...');
        const lastResortResult = await oldTitleService.getUserTitles(userId);
        console.log('🔄 Last resort returned:', lastResortResult.length, 'titles');
        return lastResortResult;
      } catch (fallbackError) {
        console.error('❌ Even fallback failed:', fallbackError);
        return [];
      }
    }
  },

  // Forward other methods to optimized service
  async getTitleLeaderboard() {
    return optimizedTitleService.getTitleLeaderboard();
  },

  async getAllTitles() {
    return optimizedTitleService.getAllTitles();
  },

  async getTitleHolders() {
    // For backward compatibility - use optimized title holders with transformation
    console.log('🔄 HybridTitleService: getTitleHolders() called - using optimized getTitleHolders()');
    return optimizedTitleService.getTitleHolders();
  },

  async checkAndUpdateUserTitles(userId: string, runs: any[], totalKm: number, longestStreak: number) {
    return optimizedTitleService.checkAndUpdateUserTitles(userId, runs, totalKm, longestStreak);
  },

  async checkTitle(titleName: string, userId: string, userValue: number, minRequirement: number, earnedAt: string, allRuns: any[]) {
    return optimizedTitleService.checkTitle(titleName, userId, userValue, minRequirement, earnedAt, allRuns);
  },

  // 🔄 Refresh title leaderboards when data changes
  async refreshTitleLeaderboards() {
    console.log('🔄 HybridTitleService: Refreshing title leaderboards...');
    return optimizedTitleService.refreshTitleLeaderboards();
  }
};