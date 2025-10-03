/**
 * Optimized Title API Service
 * Replaces the old title services with high-performance backend API calls
 */

const API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://your-backend-url.com/api' 
  : 'http://localhost:3001/api';

export interface TitleLeaderboard {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  holder: {
    user_id: string;
    user_name: string;
    profile_picture?: string;
    value: number;
    earned_at: string;
  } | null;
  runners_up: Array<{
    position: number;
    user_id: string;
    user_name: string;
    profile_picture?: string;
    value: number;
    earned_at: string;
  }>;
}

export interface UserTitleStatus {
  title_id: string;
  title_name: string;
  title_description: string;
  position: number;
  value: number;
  earned_at: string;
  is_current_holder: boolean;
  status: 'holder' | 'runner_up' | 'top_10';
}

class OptimizedTitleService {
  private getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    };
  }

  /**
   * Get complete title leaderboard with holders and runners-up
   * Single API call replaces old N+1 query pattern
   */
  async getTitleLeaderboard(): Promise<TitleLeaderboard[]> {
    try {
      console.log('🏆 Fetching optimized title leaderboard...');
      
      const response = await fetch(`${API_BASE}/titles/leaderboard`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch title leaderboard');
      }

      console.log(`✅ Loaded ${result.data.length} titles in ${result.meta?.timestamp}`);
      return result.data;

    } catch (error) {
      console.error('❌ Error fetching title leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get titles for a specific user with their rankings
   */
  async getUserTitles(userId: string): Promise<UserTitleStatus[]> {
    try {
      console.log(`🏆 Fetching titles for user: ${userId}`);
      
      const response = await fetch(`${API_BASE}/titles/user/${userId}`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch user titles');
      }

      console.log(`✅ Found ${result.data.length} titles for user ${userId}`);
      return result.data;

    } catch (error) {
      console.error('❌ Error fetching user titles:', error);
      throw error;
    }
  }

  /**
   * Force refresh all title leaderboards (admin function)
   */
  async refreshAllTitleLeaderboards(): Promise<void> {
    try {
      console.log('🔄 Refreshing all title leaderboards...');
      
      const response = await fetch(`${API_BASE}/titles/refresh`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to refresh title leaderboards');
      }

      console.log('✅ All title leaderboards refreshed');

    } catch (error) {
      console.error('❌ Error refreshing title leaderboards:', error);
      throw error;
    }
  }

  /**
   * Legacy compatibility methods - redirect to new API
   */
  async getTitleHolders(): Promise<TitleLeaderboard[]> {
    console.log('📦 Legacy getTitleHolders() called - redirecting to optimized API...');
    return this.getTitleLeaderboard();
  }

  async checkAndUpdateUserTitles(userId: string, runs: any[], totalKm: number, longestStreak: number): Promise<void> {
    console.log('📦 Legacy checkAndUpdateUserTitles() called - titles are now updated automatically on backend');
    // This is now handled automatically on the backend when runs are processed
    return Promise.resolve();
  }
}

export const optimizedTitleService = new OptimizedTitleService();

// For backward compatibility, export with old name too
export const titleService = optimizedTitleService;