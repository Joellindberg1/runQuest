import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

// ✅ FIXED: ES modules compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

/**
 * Optimized title service for high-performance title leaderboard operations
 */
export class TitleLeaderboardService {
  
  /**
   * Triggers automatic title leaderboard recalculation
   * This function executes the Node.js trigger system to recalculate all titles
   */
  async triggerTitleRecalculation(): Promise<void> {
    try {
      console.log('🔄 Triggering title leaderboard recalculation...');
      
      const scriptPath = path.join(__dirname, '../../titleTriggerSystem.cjs');
      const { stdout, stderr } = await execAsync(`node "${scriptPath}"`);
      
      if (stderr) {
        console.warn('Title recalculation stderr:', stderr);
      }
      
      console.log('✅ Title recalculation completed:', stdout);
    } catch (error) {
      console.error('❌ Error triggering title recalculation:', error);
      throw new Error(`Failed to recalculate titles: ${error}`);
    }
  }
  
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

      console.log('🔍 Raw title_leaderboard_view data:', data);
      console.log('📊 Found', data?.length || 0, 'rows in title_leaderboard_view');

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
      
      // First try to get from leaderboard view (top 10 positions)
      const { data: leaderboardData, error: leaderboardError } = await supabase.client
        .from('title_leaderboard_view')
        .select('*')
        .eq('user_id', userId)
        .order('position');

      if (leaderboardError) {
        console.error('❌ Error fetching user titles from leaderboard:', leaderboardError);
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
        console.error('❌ Error fetching all user titles:', allTitlesError);
      }

      // Combine and deduplicate
      const leaderboardTitles = (leaderboardData || []).map(row => ({
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
      const leaderboardTitleIds = new Set(leaderboardTitles.map(t => t.title_id));
      const additionalTitles = (allUserTitles || [])
        .filter(ut => !leaderboardTitleIds.has(ut.title_id))
        .map(ut => ({
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
      console.log(`✅ Found ${allTitles.length} titles for user ${userId} (${leaderboardTitles.length} in leaderboard, ${additionalTitles.length} additional)`);
      return allTitles;
      
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

  /**
   * Get all titles (without leaderboard data)
   * Simple fetch of all available titles
   */
  async getAllTitles(): Promise<any[]> {
    try {
      console.log('🏆 Fetching all titles...');
      
      const { data, error } = await supabase.client
        .from('titles')
        .select('*')
        .order('name');

      if (error) {
        console.error('❌ Error fetching all titles:', error);
        throw error;
      }

      console.log(`✅ Fetched ${data?.length || 0} titles`);
      return data || [];
      
    } catch (error) {
      console.error('❌ Error in getAllTitles:', error);
      throw error;
    }
  }

  /**
   * Populate title leaderboard using the robust trigger system
   * (Replaced table clearing with automatic trigger system)
   */
  async populateTitleLeaderboard(): Promise<void> {
    try {
      console.log('🔄 Populating title leaderboard using trigger system...');
      
      // Use the robust trigger system instead of clearing and repopulating
      console.log('� Calling triggerTitleRecalculation() instead of clearing table...');
      await this.triggerTitleRecalculation();
      
      console.log('✅ Title leaderboard populated using trigger system');
      return;
      
    } catch (error) {
      console.error('❌ Error in populateTitleLeaderboard:', error);
      throw error;
    }
  }
}

export const titleLeaderboardService = new TitleLeaderboardService();