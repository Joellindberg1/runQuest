import { Request, Response } from 'express';
import { supabase } from '../../config/database';

/**
 * Optimized title service for high-performance title leaderboard operations
 */
export class TitleLeaderboardService {
  
  /**
   * Get complete title leaderboard with holders and runners-up
   * Uses the optimized title_leaderboard_view for maximum performance
   */
  async getTitleLeaderboard(): Promise<any[]> {
    try {
      console.log('🏆 Fetching optimized title leaderboard...');
      
      const { data, error } = await supabase.client
        .from('title_leaderboard_view')
        .select('*')
        .order('title_name')
        .order('position');

      if (error) {
        console.error('❌ Error fetching title leaderboard:', error);
        throw error;
      }

      // Group by title for easier frontend consumption
      const titleGroups: Record<string, any> = {};
      
      for (const row of data || []) {
        if (!titleGroups[row.title_id]) {
          titleGroups[row.title_id] = {
            id: row.title_id,
            name: row.title_name,
            description: row.title_description,
            unlock_requirement: row.unlock_requirement,
            holder: null,
            runners_up: []
          };
        }
        
        if (row.position === 1 && row.user_id) {
          titleGroups[row.title_id].holder = {
            user_id: row.user_id,
            user_name: row.user_name,
            profile_picture: row.profile_picture,
            value: row.value,
            earned_at: row.earned_at
          };
        } else if (row.position && row.position <= 3 && row.user_id) {
          titleGroups[row.title_id].runners_up.push({
            position: row.position,
            user_id: row.user_id,
            user_name: row.user_name,
            profile_picture: row.profile_picture,
            value: row.value,
            earned_at: row.earned_at
          });
        }
      }

      const result = Object.values(titleGroups);
      console.log(`✅ Loaded ${result.length} titles with optimized query`);
      
      return result;
      
    } catch (error) {
      console.error('❌ Error in getTitleLeaderboard:', error);
      throw error;
    }
  }

  /**
   * Get titles held by a specific user
   */
  async getUserTitles(userId: string): Promise<any[]> {
    try {
      console.log(`🏆 Fetching titles for user: ${userId}`);
      
      const { data, error } = await supabase.client
        .from('title_leaderboard_view')
        .select('*')
        .eq('user_id', userId)
        .order('position');

      if (error) {
        console.error('❌ Error fetching user titles:', error);
        throw error;
      }

      const userTitles = (data || []).map(row => ({
        title_id: row.title_id,
        title_name: row.title_name,
        title_description: row.title_description,
        position: row.position,
        value: row.value,
        earned_at: row.earned_at,
        is_current_holder: row.position === 1,
        status: row.status
      }));

      console.log(`✅ Found ${userTitles.length} titles for user ${userId}`);
      return userTitles;
      
    } catch (error) {
      console.error('❌ Error in getUserTitles:', error);
      throw error;
    }
  }

  /**
   * Force refresh of all title leaderboards
   * Should be called after bulk operations
   */
  async refreshAllTitleLeaderboards(): Promise<void> {
    try {
      console.log('🔄 Refreshing all title leaderboards...');
      
      const { error } = await supabase.client.rpc('update_all_title_leaderboards');
      
      if (error) {
        console.error('❌ Error refreshing title leaderboards:', error);
        throw error;
      }
      
      console.log('✅ All title leaderboards refreshed');
      
    } catch (error) {
      console.error('❌ Error in refreshAllTitleLeaderboards:', error);
      throw error;
    }
  }

  /**
   * Refresh leaderboard for a specific title
   */
  async refreshTitleLeaderboard(titleId: string): Promise<void> {
    try {
      console.log(`🔄 Refreshing leaderboard for title: ${titleId}`);
      
      const { error } = await supabase.client.rpc('update_title_leaderboard', { 
        p_title_id: titleId 
      });
      
      if (error) {
        console.error('❌ Error refreshing title leaderboard:', error);
        throw error;
      }
      
      console.log(`✅ Leaderboard refreshed for title ${titleId}`);
      
    } catch (error) {
      console.error('❌ Error in refreshTitleLeaderboard:', error);
      throw error;
    }
  }
}

export const titleLeaderboardService = new TitleLeaderboardService();