// 🏆 Optimized Title Service - Uses backend API for performance
import { backendApi } from '@/shared/services/backendApi'

export const optimizedTitleService = {
  // 📊 Get title leaderboard (optimized with caching)
  async getTitleLeaderboard() {
    console.log('🏆 Getting optimized title leaderboard...');
    
    try {
      // Check if user is authenticated first
      if (!backendApi.isAuthenticated()) {
        console.warn('⚠️ User not authenticated, cannot fetch titles');
        return [];
      }
      
      const response = await backendApi.getTitleLeaderboard();
      
      if (!response.success) {
        console.error('❌ Failed to get title leaderboard:', response.error);
        return [];
      }
      
      console.log('✅ Title leaderboard fetched:', response.data?.length || 0, 'titles');
      return response.data || [];
      
    } catch (error) {
      console.error('❌ Error getting title leaderboard:', error);
      return [];
    }
  },

  // 👤 Get titles for specific user
  async getUserTitles(userId: string) {
    console.log(`🏆 OptimizedTitleService: Getting titles for user ${userId}...`);
    
    try {
      // Check if user is authenticated first
      if (!backendApi.isAuthenticated()) {
        console.warn('⚠️ User not authenticated, cannot fetch user titles');
        return [];
      }
      
      const response = await backendApi.getUserTitles(userId);
      
      console.log(`🔍 Backend API Response:`, response);
      
      if (!response.success) {
        console.error('❌ Failed to get user titles:', response.error);
        // If authentication failed, try to return empty array instead of crashing
        if (response.error?.includes('token') || response.error?.includes('auth')) {
          console.warn('🔐 Authentication issue detected, returning empty titles array');
        }
        return [];
      }
      
      // Ensure we have an array
      const data = response.data || [];
      console.log(`📊 Response data:`, data);
      console.log(`📊 Data type:`, typeof data);
      console.log(`📊 Is array:`, Array.isArray(data));
      
      if (!Array.isArray(data)) {
        console.error('❌ User titles response is not an array:', data);
        return [];
      }
      
      console.log('✅ User titles fetched:', data.length, 'titles');
      console.log('🔍 Sample user title:', data[0]);
      return data;
      
    } catch (error) {
      console.error('❌ Error getting user titles:', error);
      return [];
    }
  },

  // 🏆 Get all titles
  async getAllTitles() {
    console.log('🏆 Getting all titles...');
    
    try {
      const response = await backendApi.getAllTitles();
      
      if (!response.success) {
        console.error('❌ Failed to get all titles:', response.error);
        return [];
      }
      
      console.log('✅ All titles fetched:', response.data?.length || 0, 'titles');
      return response.data || [];
      
    } catch (error) {
      console.error('❌ Error getting all titles:', error);
      return [];
    }
  },

  // 🏆 Get title holders (for title system page)
  async getTitleHolders() {
    console.log('🏆 Getting title holders using optimized leaderboard...');
    
    try {
      // Check if user is authenticated first
      if (!backendApi.isAuthenticated()) {
        console.warn('⚠️ User not authenticated, cannot fetch title holders');
        return [];
      }
      
      const response = await backendApi.getTitleLeaderboard();
      
      if (!response.success) {
        console.error('❌ Failed to get title leaderboard:', response.error);
        return [];
      }
      
      console.log('🔍 Raw leaderboard response:', response.data);
      
      // Transform data to match TitleCard expected format
      const leaderboardData = response.data || [];
      const transformedTitles = leaderboardData.map(title => {
        const transformed = {
          id: title.id,
          name: title.name,
          description: title.description,
          unlock_requirement: title.unlock_requirement,
          current_holder_id: title.holder?.user_id || null,
          current_value: title.holder?.value || null,
          holder_name: title.holder?.user_name || null,
          runners_up: title.runners_up || []
        };
        console.log(`🔍 Transformed title "${title.name}":`, transformed);
        console.log(`🔍 Original holder:`, title.holder);
        console.log(`🔍 Original runners_up:`, title.runners_up);
        return transformed;
      });
      
      console.log('✅ Title holders transformed:', transformedTitles.length, 'titles');
      return transformedTitles;
      
    } catch (error) {
      console.error('❌ Error getting title holders:', error);
      return [];
    }
  },

  // 🔄 Backward compatibility methods
  async checkAndUpdateUserTitles(userId: string, runs: any[], totalKm: number, longestStreak: number) {
    console.log('🔄 Legacy method: checkAndUpdateUserTitles - now handled by backend automatically');
    // This is now handled automatically by the backend triggers
    // We just need to refresh the user's titles
    return this.getUserTitles(userId);
  },

  async checkTitle(titleName: string, userId: string, userValue: number, minRequirement: number, earnedAt: string, allRuns: any[]) {
    console.log('🔄 Legacy method: checkTitle - now handled by backend automatically');
    // This is now handled automatically by the backend triggers
    return null;
  },

  // 🔄 Refresh title leaderboards when data changes
  async refreshTitleLeaderboards() {
    console.log('🔄 OptimizedTitleService: Refreshing title leaderboards...');
    return backendApi.refreshTitleLeaderboards();
  }
};