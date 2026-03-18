import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';

// Type definitions for leaderboard data
interface LeaderboardRow {
  title_id: string;
  title_name: string;
  title_description: string;
  position: number;
  value: number;
  earned_at: string;
  status: string;
}

interface UserTitle {
  title_id: string;
  value: number;
  earned_at: string;
  titles?: {
    name: string;
    description: string;
  };
}

interface LeaderboardTitle {
  title_id: string;
  title_name: string;
  title_description: string;
  position: number | null;
  value: number;
  earned_at: string;
  is_current_holder: boolean;
  status: string;
}

/**
 * Optimized title service for high-performance title leaderboard operations
 */
export class TitleLeaderboardService {
  
  /**
   * Triggers automatic title leaderboard recalculation
   * Uses database function to refresh all title leaderboards
   */
  async triggerTitleRecalculation(): Promise<void> {
    try {
      logger.info('🔄 Triggering title leaderboard recalculation...');
      
      // Call database function directly to avoid circular reference
      await this.refreshAllTitleLeaderboards();
      
      logger.info('✅ Title recalculation completed successfully');
    } catch (error) {
      logger.error('❌ Error triggering title recalculation:', error);
      throw new Error(`Failed to recalculate titles: ${error}`);
    }
  }
  
  /**
   * Get complete title leaderboard with holders and runners-up
   * Uses the optimized title_leaderboard_view for maximum performance
   */
  async getTitleLeaderboard(): Promise<any[]> {
    try {
      logger.info('🏆 Fetching optimized title leaderboard...');
      
      const { data, error } = await supabase.client
        .from('title_leaderboard_view')
        .select('*')
        .order('title_name')
        .order('position');

      if (error) {
        logger.error('❌ Error fetching title leaderboard:', error);
        throw error;
      }

      logger.info('🔍 Raw title_leaderboard_view data:', data);
      logger.info('📊 Found', data?.length || 0, 'rows in title_leaderboard_view');

      // Group by title for easier frontend consumption
      const titleGroups: Record<string, any> = {};
      
      for (const row of data || []) {
        if (!titleGroups[row.title_id]) {
          titleGroups[row.title_id] = {
            id: row.title_id,
            name: row.title_name,
            description: row.title_description,
            unlock_requirement: row.unlock_requirement,
            metric_key: row.metric_key,
            holder: null,
            runners_up: []
          };
        }
        
        if (row.position === 1 && row.user_id) {
          titleGroups[row.title_id].holder = {
            user_id: row.user_id,
            user_name: row.user_name,
            user_gender: row.user_gender ?? null,
            profile_picture: row.profile_picture,
            value: row.value,
            earned_at: row.earned_at
          };
        } else if (row.position && row.position <= 3 && row.user_id) {
          titleGroups[row.title_id].runners_up.push({
            position: row.position,
            user_id: row.user_id,
            user_name: row.user_name,
            user_gender: row.user_gender ?? null,
            profile_picture: row.profile_picture,
            value: row.value,
            earned_at: row.earned_at
          });
        }
      }

      const result = Object.values(titleGroups);
      logger.info(`✅ Loaded ${result.length} titles with optimized query`);
      
      return result;
      
    } catch (error) {
      logger.error('❌ Error in getTitleLeaderboard:', error);
      throw error;
    }
  }

  /**
   * Get titles held by a specific user
   */
  async getUserTitles(userId: string): Promise<any[]> {
    try {
      logger.info(`🏆 Fetching titles for user: ${userId}`);
      
      // First try to get from leaderboard view (top 10 positions)
      const { data: leaderboardData, error: leaderboardError } = await supabase.client
        .from('title_leaderboard_view')
        .select('*')
        .eq('user_id', userId)
        .order('position');

      if (leaderboardError) {
        logger.error('❌ Error fetching user titles from leaderboard:', leaderboardError);
      }

      // Also get ALL user titles (including those not in top 10)
      const { data: allUserTitles, error: allTitlesError } = await supabase.client
        .from('user_titles')
        .select(`
          title_id,
          value,
          earned_at,
          titles!user_titles_title_id_fkey (
            name,
            description
          )
        `)
        .eq('user_id', userId);

      if (allTitlesError) {
        logger.error('❌ Error fetching all user titles:', allTitlesError);
      }

      // Combine and deduplicate
      const leaderboardTitles = (leaderboardData || []).map((row: LeaderboardRow) => ({
        title_id: row.title_id,
        title_name: row.title_name,
        title_description: row.title_description,
        position: row.position,
        value: row.value,
        earned_at: row.earned_at,
        is_current_holder: row.position === 1,
        status: row.status
      }));

      // Add titles not in leaderboard (position > 10 or no position)
      const leaderboardTitleIds = new Set(leaderboardTitles.map((t: LeaderboardTitle) => t.title_id));
      const additionalTitles = (allUserTitles || [])
        .filter((ut: UserTitle) => !leaderboardTitleIds.has(ut.title_id))
        .map((ut: UserTitle) => ({
          title_id: ut.title_id,
          title_name: ut.titles?.name || '',
          title_description: ut.titles?.description || '',
          position: null, // Not in top 10
          value: ut.value,
          earned_at: ut.earned_at,
          is_current_holder: false, // Can't be holder if not in top 10
          status: 'participant'
        }));

      const allTitles = [...leaderboardTitles, ...additionalTitles];
      logger.info(`✅ Found ${allTitles.length} titles for user ${userId} (${leaderboardTitles.length} in leaderboard, ${additionalTitles.length} additional)`);
      return allTitles;
      
    } catch (error) {
      logger.error('❌ Error in getUserTitles:', error);
      throw error;
    }
  }

  /**
   * Force refresh of all title leaderboards
   * Should be called after bulk operations
   */
  async refreshAllTitleLeaderboards(): Promise<void> {
    try {
      logger.info('🔄 Refreshing all title leaderboards...');
      
      const { error } = await supabase.client.rpc('update_all_title_leaderboards');
      
      if (error) {
        logger.error('❌ Error refreshing title leaderboards:', error);
        throw error;
      }
      
      logger.info('✅ All title leaderboards refreshed');
      
    } catch (error) {
      logger.error('❌ Error in refreshAllTitleLeaderboards:', error);
      throw error;
    }
  }

  /**
   * Refresh leaderboard for a specific title
   */
  async refreshTitleLeaderboard(titleId: string): Promise<void> {
    try {
      logger.info(`🔄 Refreshing leaderboard for title: ${titleId}`);
      
      const { error } = await supabase.client.rpc('update_title_leaderboard', { 
        p_title_id: titleId 
      });
      
      if (error) {
        logger.error('❌ Error refreshing title leaderboard:', error);
        throw error;
      }
      
      logger.info(`✅ Leaderboard refreshed for title ${titleId}`);
      
    } catch (error) {
      logger.error('❌ Error in refreshTitleLeaderboard:', error);
      throw error;
    }
  }

  /**
   * Get all titles (without leaderboard data)
   * Simple fetch of all available titles
   */
  async getAllTitles(): Promise<any[]> {
    try {
      logger.info('🏆 Fetching all titles...');
      
      const { data, error } = await supabase.client
        .from('titles')
        .select('*')
        .order('name');

      if (error) {
        logger.error('❌ Error fetching all titles:', error);
        throw error;
      }

      logger.info(`✅ Fetched ${data?.length || 0} titles`);
      return data || [];
      
    } catch (error) {
      logger.error('❌ Error in getAllTitles:', error);
      throw error;
    }
  }

  /**
   * Populate title leaderboard using the robust trigger system
   * (Replaced table clearing with automatic trigger system)
   */
  async populateTitleLeaderboard(): Promise<void> {
    try {
      logger.info('🔄 Populating title leaderboard using trigger system...');
      
      // Use the robust trigger system instead of clearing and repopulating
      logger.info('� Calling triggerTitleRecalculation() instead of clearing table...');
      await this.refreshAllTitleLeaderboards();
      
      logger.info('✅ Title leaderboard populated using trigger system');
      return;
      
    } catch (error) {
      logger.error('❌ Error in populateTitleLeaderboard:', error);
      throw error;
    }
  }
}

export const titleLeaderboardService = new TitleLeaderboardService();