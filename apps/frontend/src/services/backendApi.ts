// 🔗 Backend API Service - Production Ready
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
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

  async getStravaStatus(): Promise<ApiResponse<{ connected: boolean; expired: boolean; expires_at?: number; auto_refreshed?: boolean; refresh_failed?: boolean }>> {
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
}

// Export singleton instance
export const backendApi = new BackendApiService();

export default backendApi;