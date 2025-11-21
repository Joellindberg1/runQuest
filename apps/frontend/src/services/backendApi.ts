// 🔗 Backend API Service - Production Ready
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Debug logging
console.log('🔧 Environment check:');
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
console.log('API_BASE_URL:', API_BASE_URL);
console.log('Mode:', import.meta.env.MODE);

export interface LoginResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  error?: string;
}

// Specific API response types
interface UserData {
  id: string;
  name: string;
  email: string;
  total_xp?: number;
  current_level?: number;
  total_km?: number;
  current_streak?: number;
  longest_streak?: number;
  profile_picture?: string;
}

interface RunData {
  id: string;
  user_id: string;
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
}

interface TitleData {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
}

interface RecalculationResult {
  user_id: string;
  runs_updated: number;
  new_total_xp: number;
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

class BackendApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // 🔐 Authentication methods
  async login(name: string, password: string): Promise<LoginResponse> {
    try {
      console.log('🔐 Attempting backend login for:', name);
      
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, password }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ Backend login failed:', data.error);
        return { success: false, error: data.error || 'Login failed' };
      }

      console.log('✅ Backend login successful:', data.user?.name);
      
      // Store JWT token in localStorage
      if (data.token) {
        localStorage.setItem('runquest_token', data.token);
        localStorage.setItem('runquest_user', JSON.stringify(data.user));
      }

      return {
        success: true,
        token: data.token,
        user: data.user
      };
      
    } catch (error) {
      console.error('❌ Backend login error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 🔄 Token refresh (placeholder)
  async refreshToken(): Promise<ApiResponse> {
    try {
      const token = localStorage.getItem('runquest_token');
      if (!token) {
        return { success: false, error: 'No token found' };
      }

      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      return { success: response.ok, data };
      
    } catch (error) {
      console.error('❌ Token refresh error:', error);
      return { success: false, error: 'Token refresh failed' };
    }
  }

  // 🔐 Change password
  async changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse> {
    try {
      console.log('🔐 Attempting password change');
      
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      const response = await fetch(`${this.baseUrl}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ Password change failed:', data.error);
        return { success: false, error: data.error || 'Password change failed' };
      }

      console.log('✅ Password changed successfully');
      return { success: true, data };
      
    } catch (error) {
      console.error('❌ Password change error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 👥 Admin: Get all users
  async getAllUsers(): Promise<ApiResponse> {
    try {
      console.log('👥 Fetching all users (admin)');
      
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      const response = await fetch(`${this.baseUrl}/auth/users`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ Failed to fetch users:', data.error);
        return { success: false, error: data.error || 'Failed to fetch users' };
      }

      console.log('✅ Users fetched successfully');
      return { success: true, data: data.data };
      
    } catch (error) {
      console.error('❌ Error fetching users:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 👥 Get all users with their runs (for leaderboard)
  async getUsersWithRuns(): Promise<ApiResponse> {
    try {
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      const response = await fetch(`${this.baseUrl}/auth/users-with-runs`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to fetch users with runs' };
      }

      return { success: true, data: data.data };
      
    } catch (error) {
      console.error('❌ Error fetching users with runs:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 👤 Admin: Create new user
  async createUser(name: string, email: string, password: string): Promise<ApiResponse> {
    try {
      console.log('👤 Creating new user (admin)');
      
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      const response = await fetch(`${this.baseUrl}/auth/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ Failed to create user:', data.error);
        return { success: false, error: data.error || 'Failed to create user' };
      }

      console.log('✅ User created successfully');
      return { success: true, data: data.data };
      
    } catch (error) {
      console.error('❌ Error creating user:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 🔐 Admin: Reset user password
  async resetUserPassword(userId: string, newPassword: string): Promise<ApiResponse> {
    try {
      console.log('🔐 Resetting user password (admin)');
      
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'Not authenticated' };
      }

      const response = await fetch(`${this.baseUrl}/auth/users/${userId}/password`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPassword }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ Failed to reset password:', data.error);
        return { success: false, error: data.error || 'Failed to reset password' };
      }

      console.log('✅ Password reset successfully');
      return { success: true, data };
      
    } catch (error) {
      console.error('❌ Error resetting password:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 🚪 Logout
  logout(): void {
    console.log('🚪 Logging out - clearing tokens');
    localStorage.removeItem('runquest_token');
    localStorage.removeItem('runquest_user');
  }

  // 🔍 Check if user is authenticated
  isAuthenticated(): boolean {
    const token = localStorage.getItem('runquest_token');
    const user = localStorage.getItem('runquest_user');
    return !!(token && user);
  }

  // 👤 Get current user from localStorage
  getCurrentUser(): any | null {
    const userStr = localStorage.getItem('runquest_user');
    if (!userStr) return null;
    
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }

  // 🔑 Get auth token
  getToken(): string | null {
    return localStorage.getItem('runquest_token');
  }

  // 📡 Make authenticated API request
  async authenticatedRequest<T = any>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'No authentication token' };
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();
      
      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || 'Request failed'
      };
      
    } catch (error) {
      console.error('❌ Authenticated request error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }

  // 🔗 Strava Integration Methods
  async getStravaConfig(): Promise<ApiResponse<{ client_id: string }>> {
    try {
      const response = await fetch(`${this.baseUrl}/strava/config`);
      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get Strava config' };
      }
      
      return { success: true, data };
    } catch (error) {
      return { success: false, error: 'Network error' };
    }
  }

  async getStravaStatus(): Promise<ApiResponse<{ connected: boolean; expired: boolean; expires_at?: number; auto_refreshed?: boolean; refresh_failed?: boolean; connection_date?: string; last_sync?: string }>> {
    return this.authenticatedRequest('/strava/status');
  }

  async connectStrava(code: string): Promise<ApiResponse> {
    return this.authenticatedRequest('/strava/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async syncStrava(): Promise<ApiResponse<{ newRuns: number; totalActivities: number; message: string }>> {
    return this.authenticatedRequest('/strava/sync', {
      method: 'POST',
    });
  }

  async disconnectStrava(): Promise<ApiResponse> {
    return this.authenticatedRequest('/strava/disconnect', {
      method: 'DELETE',
    });
  }

  async getStravaLastSync(): Promise<ApiResponse<{ 
    last_sync_attempt: string | null; 
    last_sync_status: string; 
    next_sync_estimated: string | null; 
    users_synced?: number; 
    total_users?: number; 
    new_runs?: number;
  }>> {
    try {
      const response = await fetch(`${this.baseUrl}/strava/last-sync`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      
      if (!response.ok) {
        return { success: false, error: result.error || 'Failed to get sync info' };
      }

      return { success: true, data: result.data };
      
    } catch (error) {
      console.error('❌ Get last sync error:', error);
      return { success: false, error: 'Failed to get sync info' };
    }
  }

  // 🏆 Title System Methods
  async getTitleLeaderboard(): Promise<ApiResponse<any[]>> {
    console.log('🏆 Fetching title leaderboard from optimized backend...');
    const response = await this.authenticatedRequest('/titles/leaderboard');
    
    // Extract the actual data from the nested response structure
    if (response.success && response.data && response.data.data) {
      return { success: true, data: response.data.data };
    }
    
    return response;
  }

  async getUserTitles(userId: string): Promise<ApiResponse<any[]>> {
    console.log(`🏆 BackendAPI: Fetching titles for user ${userId}...`);
    const response = await this.authenticatedRequest(`/titles/user/${userId}`);
    console.log(`🔍 BackendAPI Response for user ${userId}:`, response);
    
    // Extract the actual data from the nested response structure
    if (response.success && response.data && response.data.data) {
      const extractedData = response.data.data;
      console.log(`🔍 Extracted data:`, extractedData);
      return { success: true, data: extractedData };
    }
    
    return response;
  }

  async getAllTitles(): Promise<ApiResponse<any[]>> {
    console.log('🏆 Fetching all titles...');
    const response = await this.authenticatedRequest('/titles');
    
    // Extract the actual data from the nested response structure
    if (response.success && response.data && response.data.data) {
      return { success: true, data: response.data.data };
    }
    
    return response;
  }

  // 🔄 Refresh title leaderboards after data changes
  async refreshTitleLeaderboards(): Promise<ApiResponse<any>> {
    console.log('🔄 BackendAPI: Refreshing title leaderboards...');
    
    try {
      const response = await this.authenticatedRequest('/titles/refresh', {
        method: 'POST'
      });
      
      if (!response.success) {
        console.error('❌ Failed to refresh title leaderboards:', response.error);
        return { success: false, error: response.error };
      }
      
      console.log('✅ Title leaderboards refreshed successfully');
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error refreshing title leaderboards:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // 🔧 Admin Settings Management
  async getAdminSettings(): Promise<ApiResponse<any>> {
    try {
      console.log('🔍 Fetching admin settings from backend...');
      const response = await fetch(`${API_BASE_URL}/auth/admin-settings`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch admin settings');
      }

      console.log('✅ Admin settings fetched successfully');
      return { success: true, data: data.data };
    } catch (error) {
      console.error('❌ Error fetching admin settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateAdminSettings(settings: {
    base_xp: number;
    xp_per_km: number;
    bonus_5km: number;
    bonus_10km: number;
    bonus_15km: number;
    bonus_20km: number;
    min_run_distance: number;
  }): Promise<ApiResponse<any>> {
    try {
      console.log('💾 Updating admin settings in backend...');
      const response = await fetch(`${API_BASE_URL}/auth/admin-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update admin settings');
      }

      console.log('✅ Admin settings updated successfully');
      return { success: true, data: data.data, message: data.message };
    } catch (error) {
      console.error('❌ Error updating admin settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getStreakMultipliers(): Promise<ApiResponse<any[]>> {
    try {
      console.log('🔍 Fetching streak multipliers from backend...');
      const response = await fetch(`${API_BASE_URL}/auth/streak-multipliers`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch streak multipliers');
      }

      console.log('✅ Streak multipliers fetched successfully');
      return { success: true, data: data.data };
    } catch (error) {
      console.error('❌ Error fetching streak multipliers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateStreakMultipliers(multipliers: Array<{days: number, multiplier: number}>): Promise<ApiResponse<any[]>> {
    try {
      console.log('💾 Updating streak multipliers in backend...');
      const response = await fetch(`${API_BASE_URL}/auth/streak-multipliers`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ multipliers }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update streak multipliers');
      }

      console.log('✅ Streak multipliers updated successfully');
      return { success: true, data: data.data, message: data.message };
    } catch (error) {
      console.error('❌ Error updating streak multipliers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateRun(runId: string, updates: {
    distance?: number;
    date?: string;
    duration?: number;
    title?: string;
    description?: string;
  }): Promise<ApiResponse<any>> {
    try {
      console.log(`💾 Updating run ${runId} in backend...`, updates);
      const response = await fetch(`${API_BASE_URL}/runs/${runId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update run');
      }

      console.log('✅ Run updated successfully');
      return { success: true, data: data.run, message: data.message };
    } catch (error) {
      console.error('❌ Error updating run:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteRun(runId: string): Promise<ApiResponse<void>> {
    try {
      console.log(`🗑️ Deleting run ${runId} in backend...`);
      const response = await fetch(`${API_BASE_URL}/runs/${runId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete run');
      }

      console.log('✅ Run deleted successfully');
      return { success: true, message: data.message };
    } catch (error) {
      console.error('❌ Error deleting run:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getGroupRunHistory(): Promise<ApiResponse<any[]>> {
    try {
      console.log('📊 Fetching group run history from backend...');
      const response = await fetch(`${API_BASE_URL}/runs/group-history`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch group run history');
      }

      console.log('✅ Group run history fetched successfully');
      return { success: true, data: data.runs };
    } catch (error) {
      console.error('❌ Error fetching group run history:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
export const backendApi = new BackendApiService();

export default backendApi;