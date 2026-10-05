// 🔗 Backend API Service - Production Ready
import type { Run, User, UserTitle, Challenge, ChallengeToken, UserBoost } from '@runquest/types';
import type {
  WeekLeaderboardResponse, RankDeltaResponse, XpConfigResponse, HeadToHeadResponse,
  ChallengeGroupHistoryResponse, OffsetPageMeta, EventsResponse, EventsHistoryResponse, GroupRunHistoryResponse,
  NewsApiResponse, NewsMeta, NewsQuery, NewsResponse, NewsSeenApiResponse, NewsSeenResponse,
} from '@runquest/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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

export interface AdminSettings {
  base_xp: number;
  xp_per_km: number;
  bonus_5km: number;
  bonus_10km: number;
  bonus_15km: number;
  bonus_20km: number;
  min_run_distance: number;
  min_streak_distance?: number;
  min_run_date?: string;
}

interface TitleData {
  id: string;
  name: string;
  description: string;
  metric_key?: string;
  unlock_requirement: number;
  category?: string;
  icon?: string;
}

/** Shape of GET /titles/leaderboard (title_leaderboard-vyn per titel). */
export interface TitleLeaderboard {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  metric_key?: string;
  holder: {
    user_id: string;
    user_name: string;
    user_gender?: string | null;
    profile_picture?: string;
    value: number;
    earned_at: string;
  } | null;
  runners_up: Array<{
    position: number;
    user_id: string;
    user_name: string;
    user_gender?: string | null;
    profile_picture?: string;
    value: number;
    earned_at: string;
  }>;
}

/** Shape of GET /auth/users (admin user list). */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  created_at: string;
  total_runs: number;
}

/** Shape of each row from GET /titles/group-eligibility. */
export interface GroupEligibilityEntry {
  userId: string;
  name: string;
  gender: string | null;
  values: Record<string, number>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

class BackendApiService {
  private baseUrl: string;
  onUnauthorized?: () => void;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private handleUnauthorized(): void {
    console.warn('⚠️ Session expired - clearing authentication');
    this.logout();
    this.onUnauthorized?.();
  }

  // 🔐 Authentication methods
  async login(name: string, password: string): Promise<LoginResponse> {
    try {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        console.error('❌ Password change failed:', data.error);
        return { success: false, error: data.error || 'Password change failed' };
      }

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
  async getAllUsers(): Promise<ApiResponse<AdminUser[]>> {
    try {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        console.error('❌ Failed to fetch users:', data.error);
        return { success: false, error: data.error || 'Failed to fetch users' };
      }

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
  async getUsersWithRuns(): Promise<ApiResponse<User[]>> {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
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

  // Nya endpoints (ADR 007) svarar { success, data, meta? } / { error }; typerna ligger i @runquest/shared.
  private async getEnvelope<T>(path: string, failure: string): Promise<ApiResponse<T>> {
    try {
      const token = this.getToken();
      if (!token) return { success: false, error: 'Not authenticated' };

      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const body = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        return { success: false, error: body.error || failure };
      }
      return { success: true, data: body.data };
    } catch (error) {
      console.error(`❌ ${failure}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  /** GET /leaderboard/week — veckans rader, dagstaplar, totaler och mover (ADR 007 B1). */
  async getWeekLeaderboard(weekStart?: string): Promise<ApiResponse<WeekLeaderboardResponse>> {
    const query = weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : '';
    return this.getEnvelope<WeekLeaderboardResponse>(`/leaderboard/week${query}`, 'Failed to fetch week leaderboard');
  }

  /** GET /leaderboard/rank-delta — rank mot veckostart (ADR 007 B2). */
  async getRankDelta(): Promise<ApiResponse<RankDeltaResponse>> {
    return this.getEnvelope<RankDeltaResponse>('/leaderboard/rank-delta', 'Failed to fetch rank changes');
  }

  /** GET /config/xp — effektiva XP-inställningar + multiplikatortrappan, läsbar för alla inloggade (ADR 007 B4). */
  async getXpConfig(): Promise<ApiResponse<XpConfigResponse>> {
    return this.getEnvelope<XpConfigResponse>('/config/xp', 'Failed to fetch XP config');
  }

  /** GET /challenges/head-to-head/:userId — anroparens uppgörelser mot en annan medlem (ADR 007 B6). */
  async getHeadToHead(userId: string, limit?: number): Promise<ApiResponse<HeadToHeadResponse>> {
    const query = limit ? `?limit=${limit}` : '';
    return this.getEnvelope<HeadToHeadResponse>(
      `/challenges/head-to-head/${encodeURIComponent(userId)}${query}`,
      'Failed to fetch head to head',
    );
  }

  /**
   * GET /challenges/group-history — gruppens avslutade utmaningar, nyast först (ADR 007 B5). Offset-sidor:
   * `meta.has_more` säger om det finns fler (sidstorlek default 20, max 50).
   */
  async getChallengeGroupHistory(
    limit: number,
    offset: number,
  ): Promise<ApiResponse<ChallengeGroupHistoryResponse> & { meta?: OffsetPageMeta }> {
    try {
      const token = this.getToken();
      if (!token) return { success: false, error: 'Not authenticated' };

      const response = await fetch(`${this.baseUrl}/challenges/group-history?limit=${limit}&offset=${offset}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const body = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        return { success: false, error: body.error || 'Failed to fetch challenge history' };
      }
      return { success: true, data: body.data, meta: body.meta };
    } catch (error) {
      console.error('❌ Failed to fetch challenge history:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // 👤 Admin: Create new user
  async createUser(name: string, email: string, password: string): Promise<ApiResponse<AdminUser>> {
    try {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        console.error('❌ Failed to create user:', data.error);
        return { success: false, error: data.error || 'Failed to create user' };
      }

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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        console.error('❌ Failed to reset password:', data.error);
        return { success: false, error: data.error || 'Failed to reset password' };
      }

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
  getCurrentUser(): { id: string; name: string; email: string } | null {
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
  async authenticatedRequest<T = unknown>(
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

      if (response.status === 401) {
        this.handleUnauthorized();
        return { success: false, error: 'Session expired. Please log in again.' };
      }

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
    } catch {
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

  async debugStravaActivities(): Promise<ApiResponse<{
    connection_date: string;
    after_timestamp: number;
    after_date: string;
    after_calculation_method: string;
    total_activities: number;
    running_activities: number;
    existing_run_ids: string[];
    existing_runs_count: number;
    new_runs_count: number;
    all_activities: Array<{
      id: number;
      name: string;
      type: string;
      distance: string;
      date: string;
      already_imported: boolean;
    }>;
    new_runs: Array<{
      id: number;
      name: string;
      distance: string;
      date: string;
    }>;
  }>> {
    return this.authenticatedRequest('/strava/debug-activities', {
      method: 'GET',
    });
  }

  async disconnectStrava(): Promise<ApiResponse> {
    return this.authenticatedRequest('/strava/disconnect', {
      method: 'DELETE',
    });
  }

  async backfillStravaExtendedData(): Promise<ApiResponse<{
    totalUpdated: number;
    summary: Array<{ user: string; updated: number; error?: string }>;
  }>> {
    return this.authenticatedRequest('/strava/backfill-extended', { method: 'POST' });
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
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getToken()}`
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

  // 👤 User Methods
  async uploadProfilePicture(file: File): Promise<ApiResponse<{ profile_picture: string }>> {
    try {
      const token = this.getToken();
      if (!token) {
        return { success: false, error: 'No authentication token' };
      }

      const response = await fetch(`${this.baseUrl}/users/profile-picture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': file.type,
        },
        body: file,
      });

      const result = await response.json();

      if (response.status === 401) {
        this.handleUnauthorized();
        return { success: false, error: 'Session expired. Please log in again.' };
      }

      if (!response.ok) {
        return { success: false, error: result.error || 'Failed to upload profile picture' };
      }

      return { success: true, data: result.data };

    } catch (error) {
      console.error('❌ Upload profile picture error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // 🏆 Title System Methods
  async getTitleLeaderboard(): Promise<ApiResponse<TitleLeaderboard[]>> {
    const response = await this.authenticatedRequest<{ data: TitleLeaderboard[] }>('/titles/leaderboard');

    // Extract the actual data from the nested response structure
    if (response.success && response.data && response.data.data) {
      return { success: true, data: response.data.data };
    }

    return { success: response.success, data: response.data?.data, error: response.error, message: response.message };
  }

  async getUserTitles(userId: string): Promise<ApiResponse<UserTitle[]>> {
    const response = await this.authenticatedRequest<{ data: UserTitle[] }>(`/titles/user/${userId}`);

    // Extract the actual data from the nested response structure
    if (response.success && response.data && response.data.data) {
      return { success: true, data: response.data.data };
    }

    return { success: response.success, data: response.data?.data, error: response.error, message: response.message };
  }

  async getTitleGroupEligibility(): Promise<ApiResponse<GroupEligibilityEntry[]>> {
    const response = await this.authenticatedRequest<{ data: GroupEligibilityEntry[] }>('/titles/group-eligibility');
    if (response.success && response.data && response.data.data) {
      return { success: true, data: response.data.data };
    }
    return { success: response.success, data: response.data?.data, error: response.error, message: response.message };
  }

  async getAllTitles(): Promise<ApiResponse<TitleData[]>> {
    const response = await this.authenticatedRequest<{ data: TitleData[] }>('/titles');

    // Extract the actual data from the nested response structure
    if (response.success && response.data && response.data.data) {
      return { success: true, data: response.data.data };
    }

    return { success: response.success, data: response.data?.data, error: response.error, message: response.message };
  }

  async updateDisplayedTitles(titleIds: string[]): Promise<ApiResponse<void>> {
    return this.authenticatedRequest<void>('/auth/me/displayed-titles', {
      method: 'PUT',
      body: JSON.stringify({ title_ids: titleIds }),
    });
  }

  // 🔄 Refresh title leaderboards after data changes
  async refreshTitleLeaderboards(): Promise<ApiResponse<{ message: string; updated: number }>> {
    try {
      const response = await this.authenticatedRequest<{ message: string; updated: number }>('/titles/refresh', {
        method: 'POST'
      });

      if (!response.success) {
        console.error('❌ Failed to refresh title leaderboards:', response.error);
        return { success: false, error: response.error };
      }

      return { success: true };

    } catch (error) {
      console.error('❌ Error refreshing title leaderboards:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // 🔧 Admin Settings Management
  async getAdminSettings(): Promise<ApiResponse<AdminSettings>> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/admin-settings`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to fetch admin settings');
      }

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
  }): Promise<ApiResponse<AdminSettings>> {
    try {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to update admin settings');
      }

      return { success: true, data: data.data, message: data.message };
    } catch (error) {
      console.error('❌ Error updating admin settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getStreakMultipliers(): Promise<ApiResponse<Array<{ days: number; multiplier: number }>>> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/streak-multipliers`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to fetch streak multipliers');
      }

      return { success: true, data: data.data };
    } catch (error) {
      console.error('❌ Error fetching streak multipliers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateStreakMultipliers(multipliers: Array<{days: number, multiplier: number}>): Promise<ApiResponse<Array<{ days: number; multiplier: number }>>> {
    try {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to update streak multipliers');
      }

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
  }): Promise<ApiResponse<Run>> {
    try {
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
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to update run');
      }

      return { success: true, data: data.run, message: data.message };
    } catch (error) {
      console.error('❌ Error updating run:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteRun(runId: string): Promise<ApiResponse<void>> {
    try {
      const response = await fetch(`${API_BASE_URL}/runs/${runId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to delete run');
      }

      return { success: true, message: data.message };
    } catch (error) {
      console.error('❌ Error deleting run:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * GET /runs/group-history — gruppens rundor, nyast först (ADR 007 B9). Offset-sidor: `meta.has_more` säger om det finns fler
   * (sidstorlek default 100, max 200). Svaret behåller nyckeln `runs` + additivt `meta`.
   */
  async getGroupRunHistoryPage(limit: number, offset: number): Promise<ApiResponse<GroupRunHistoryResponse>> {
    return this.authenticatedRequest<GroupRunHistoryResponse>(`/runs/group-history?limit=${limit}&offset=${offset}`);
  }

  // ─── Groups ──────────────────────────────────────────────────────────────

  async getGroupInfo(): Promise<ApiResponse<{
    id: string; name: string; is_owner: boolean; invite_code?: string;
    members: { id: string; name: string; current_level: number; total_xp: number; profile_picture?: string; challenge_active?: boolean }[];
  }>> {
    try {
      const response = await fetch(`${API_BASE_URL}/groups/my`, {
        headers: { 'Authorization': `Bearer ${this.getToken()}` },
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to fetch group info');
      }
      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ─── Challenges ──────────────────────────────────────────────────────────

  async getMyChallenges(): Promise<ApiResponse<{
    tokens: ChallengeToken[];
    sent_challenge: Challenge | null;
    received_challenges: Challenge[];
    boosts: UserBoost[];
    history: Challenge[];
    group_active: Challenge[];
  }>> {
    try {
      const response = await fetch(`${API_BASE_URL}/challenges/my`, {
        headers: { 'Authorization': `Bearer ${this.getToken()}` },
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to fetch challenges');
      }
      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async sendChallenge(tokenId: string, opponentId: string): Promise<ApiResponse<{ challenge_id: string }>> {
    try {
      const response = await fetch(`${API_BASE_URL}/challenges/send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_id: tokenId, opponent_id: opponentId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to send challenge');
      }
      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async respondToChallenge(challengeId: string, action: 'accept' | 'decline'): Promise<ApiResponse<void>> {
    try {
      const response = await fetch(`${API_BASE_URL}/challenges/${challengeId}/respond`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${this.getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to respond to challenge');
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async withdrawChallenge(challengeId: string): Promise<ApiResponse<void>> {
    try {
      const response = await fetch(`${API_BASE_URL}/challenges/${challengeId}/withdraw`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${this.getToken()}` },
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to withdraw challenge');
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getChallengeProgress(challengeId: string): Promise<ApiResponse<{ progress: { user_id: string; value: number }[] }>> {
    try {
      const response = await fetch(`${API_BASE_URL}/challenges/${challengeId}/progress`, {
        headers: { 'Authorization': `Bearer ${this.getToken()}` },
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to fetch progress');
      }
      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getChallengeGroupStats(): Promise<ApiResponse<Array<{
    user_id: string; name: string; wins: number; draws: number; losses: number;
    total: number; points: number; challenge_active: boolean; has_pending_challenge: boolean; current_level: number; profile_picture: string | null;
  }>>> {
    try {
      const response = await fetch(`${API_BASE_URL}/challenges/group-stats`, {
        headers: { 'Authorization': `Bearer ${this.getToken()}` },
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { this.handleUnauthorized(); return { success: false, error: 'Session expired.' }; }
        throw new Error(data.error || 'Failed to fetch group stats');
      }
      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  /**
   * GET /events/history — avslutade events, nyast först, offset-sidor (ADR 007 B8). `data.meta` bär `total` och
   * `has_more` (sidstorlek default 30, max 50).
   */
  async getEventHistoryPage(limit: number, offset: number): Promise<ApiResponse<EventsHistoryResponse>> {
    return this.authenticatedRequest<EventsHistoryResponse>(`/events/history?limit=${limit}&offset=${offset}`);
  }

  /** GET /events — aktiva + schemalagda events med participantCount/memberCount för alla typer (ADR 007 B7). Enda events-metoden: Events-skärmen och skalets "Right now" delar query-nyckeln ['events'] och därmed formen. */
  async getEventList(): Promise<ApiResponse<EventsResponse>> {
    return this.authenticatedRequest<EventsResponse>('/events');
  }

  // ─── News (ADR 008) ───────────────────────────────────────────────────────

  /**
   * GET /news — händelseloggen, nyast först (keyset: `before` XOR `after`, aldrig båda; `type` = kommaseparerade ActivityType).
   * `meta` bär unread_count (alla typer), last_seen_id och has_more/next_before; `after`-lägets semantik står i ADR 008 addendum 4.
   */
  async getNews(query: NewsQuery = {}): Promise<ApiResponse<NewsResponse> & { meta?: NewsMeta }> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.after !== undefined) params.set('after', String(query.after));
    if (query.type) params.set('type', query.type);
    const qs = params.toString();
    const result = await this.newsRequest<NewsApiResponse>('GET', `/news${qs ? `?${qs}` : ''}`, undefined, 'Failed to fetch news');
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.body.data, meta: result.body.meta };
  }

  /** POST /news/seen — höjer vattenmärket monotont (utelämnat `upToId` = senaste raden i gruppen). */
  async markNewsSeen(upToId?: number): Promise<ApiResponse<NewsSeenResponse>> {
    const result = await this.newsRequest<NewsSeenApiResponse>('POST', '/news/seen', upToId === undefined ? {} : { up_to_id: upToId }, 'Failed to mark the news as read');
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.body.data };
  }

  private async newsRequest<T>(
    method: 'GET' | 'POST', path: string, body: unknown, failure: string,
  ): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
    try {
      const token = this.getToken();
      if (!token) return { ok: false, error: 'Not authenticated' };
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const parsed = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { ok: false, error: 'Session expired. Please log in again.' };
        }
        return { ok: false, error: parsed.error || failure };
      }
      return { ok: true, body: parsed as T };
    } catch (error) {
      console.error(`❌ ${failure}:`, error);
      return { ok: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // ─── Runs ─────────────────────────────────────────────────────────────────

  /** POST /runs. `isTreadmill` utelämnas → kolumnen förblir NULL (okänt); formuläret skickar alltid en bool. */
  async createRun(date: string, distance: number, source: string = 'manual', isTreadmill?: boolean): Promise<ApiResponse<Run>> {
    try {
      const response = await fetch(`${API_BASE_URL}/runs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date, distance, source, ...(isTreadmill !== undefined && { is_treadmill: isTreadmill }) }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        throw new Error(data.error || 'Failed to create run');
      }

      return { success: true, data: data.run, message: data.message };
    } catch (error) {
      console.error('❌ Error creating run:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
export const backendApi = new BackendApiService();

export default backendApi;
