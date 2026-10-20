// 🔗 Backend API Service - Production Ready
import type { Challenge, ChallengeToken, UserBoost } from '@runquest/types';
import type {
  AdminSettingsResponse, AdminUsersResponse, ApiError, ChangePasswordRequest, ChangePasswordResponse, CreateRunRequest, CreateRunResponse,
  CreateUserRequest, CreateUserResponse, UpdateRunRequest, UpdateRunResponse,
  LoginRequest, LoginResponse, LoginUser, ResetUserPasswordRequest, ResetUserPasswordResponse, StreakMultipliersResponse,
  TitlesRefreshResponse, UpdateAdminSettingsRequest, UpdateAdminSettingsResponse, UpdateDisplayedTitlesRequest, UpdateDisplayedTitlesResponse,
  UpdateStreakMultipliersRequest, UpdateStreakMultipliersResponse, UploadProfilePictureResponse, UsersWithRunsResponse,
  WeekLeaderboardResponse, RankDeltaResponse, XpConfigResponse, HeadToHeadResponse,
  PublicStatsData, PublicStatsApiResponse,
  ChallengeGroupHistoryResponse, OffsetPageMeta, EventsResponse, EventsHistoryResponse, GroupRunHistoryResponse,
  NewsApiResponse, NewsMeta, NewsQuery, NewsReadApiResponse, NewsReadRequest, NewsReadResponse, NewsResponse, NewsSeenApiResponse, NewsSeenResponse,
  SettingsApiResponse, SettingsMeta, SettingsResponse, UpdateSettingsRequest,
  AdminWaitlistData,
  WaitlistSignupRequest,
  StravaCallbackRequest, StravaStatusResponse, StravaSyncPausedRequest, StravaSyncPausedResponse,
  GroupEligibilityEntry, TitleLeaderboardEntry, UserTitleEntry,
} from '@runquest/shared';
import { logger } from '@/shared/utils/logger';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from './sessionStorageKeys';

/** Sessionsnyckeln ur localStorage; blockerad lagring (webbläsarinställning, vissa privata lägen) kastar vid åtkomst och räknas som utloggad. */
function readStoredSession(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

/** Utfallet av login() hos klienten: serverns svar (LoginResponse) eller ett fel. Aldrig serverns `{ error }` rått. */
export type LoginResult = LoginResponse | { success: false; error: string };

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  /** POST/PUT/DELETE /runs: servern skrev ändringen men XP-omräkningen föll (500). Cachen är inaktuell och ett nytt försök kan dubblera. */
  written?: true;
}

/** Felsvaret när servern skrev raden men omräkningen föll — `written` följer med så att hookarna kan hålla cachen i takt. */
function writtenFailure(error: unknown): ApiResponse<never> {
  return { success: false, error: typeof error === 'string' ? error : undefined, written: true };
}

/**
 * Svar som inte gick igenom loggas efter vad de betyder. 4xx är väntat (fel lösenord, saknad post, dubblett, spärr) och är inget fel i appen,
 * så de är en varning och blir ingen felhändelse. 5xx är oväntat och rapporteras. Nätverksfel loggas som fel i respektive catch.
 */
function logHttpFailure(message: string, status: number, detail: unknown): void {
  if (status >= HTTP_SERVER_ERROR) logger.error(message, detail);
  else logger.warn(message, detail);
}

class BackendApiService {
  private baseUrl: string;
  onUnauthorized?: () => void;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private handleUnauthorized(): void {
    logger.warn('Session expired - clearing authentication');
    this.logout();
    this.onUnauthorized?.();
  }

  // 🔐 Authentication methods
  async login(name: string, password: string): Promise<LoginResult> {
    try {
      const request: LoginRequest = { name, password };
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        const failure: ApiError = data;
        logHttpFailure('Backend login failed:', response.status, failure.error);
        return { success: false, error: failure.error || 'Login failed' };
      }

      const login: LoginResponse = data;

      // Store JWT token in localStorage
      if (login.token) {
        localStorage.setItem(SESSION_TOKEN_KEY, login.token);
        localStorage.setItem(SESSION_USER_KEY, JSON.stringify(login.user));
      }

      return {
        success: true,
        token: login.token,
        user: login.user
      };

    } catch (error) {
      logger.error('Backend login error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  // 🔐 Change password
  async changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse<ChangePasswordResponse>> {
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
        body: JSON.stringify({ currentPassword, newPassword } satisfies ChangePasswordRequest),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        logHttpFailure('Password change failed:', response.status, data.error);
        return { success: false, error: data.error || 'Password change failed' };
      }

      return { success: true, data };

    } catch (error) {
      logger.error('Password change error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  // 👥 Admin: Get all users
  async getAllUsers(): Promise<ApiResponse<AdminUsersResponse['data']>> {
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
        logHttpFailure('Failed to fetch users:', response.status, data.error);
        return { success: false, error: data.error || 'Failed to fetch users' };
      }

      return { success: true, data: data.data };

    } catch (error) {
      logger.error('Error fetching users:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  // 👥 Get all users with their runs (for leaderboard)
  async getUsersWithRuns(): Promise<ApiResponse<UsersWithRunsResponse['data']>> {
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
      logger.error('Error fetching users with runs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  // Nya endpoints (ADR 007) svarar { success, data, meta? } / { error }; typerna ligger i @runquest/shared.
  // `notFoundData`: svaret på ett 404 som ska läsas som "inget att visa" i stället för ett fel (se getUserTitles).
  private async getEnvelope<T>(path: string, failure: string, notFoundData?: T): Promise<ApiResponse<T>> {
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
        if (response.status === HTTP_NOT_FOUND && notFoundData !== undefined) return { success: true, data: notFoundData };
        logHttpFailure(failure, response.status, body.error);
        return { success: false, error: body.error || failure };
      }
      return { success: true, data: body.data };
    } catch (error) {
      logger.error(`${failure}:`, error);
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

  /**
   * GET /public/stats — landningens tre tal (ingen inloggning, inget Authorization-huvud). Ett svar som inte är tre ändliga
   * tal ≥ 0 räknas som fel; felet bär HTTP-statusen ("HTTP 404") så att hooken kan låta bli att försöka igen vid 4xx.
   */
  async getPublicStats(): Promise<ApiResponse<PublicStatsData>> {
    try {
      const response = await fetch(`${this.baseUrl}/public/stats`);
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
      const body = (await response.json()) as Partial<PublicStatsApiResponse> | null;
      const data = body?.data;
      const valid = [data?.runners, data?.challenges, data?.km].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
      return valid && data ? { success: true, data } : { success: false, error: 'Invalid public stats response' };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }

  /** GET /admin/waitlist — väntelistans anmälningar, nyast först, och det exakta antalet (bara admin). */
  async getAdminWaitlist(): Promise<ApiResponse<AdminWaitlistData>> {
    return this.getEnvelope<AdminWaitlistData>('/admin/waitlist', 'Failed to load the waitlist');
  }

  /**
   * POST /waitlist — publik endpoint, därför ingen Authorization-header. Resultatet bär HTTP-statusen (200 också för dubblett och
   * botfällor, 400, 413, 429, 500) så att formuläret kan skilja på fel; ett nätverksfel blir null. Adressen loggas aldrig.
   */
  async joinWaitlist(body: WaitlistSignupRequest): Promise<{ status: number } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status };
    } catch {
      logger.warn('Waitlist request failed (network error)');
      return null;
    }
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
      logger.error('Failed to fetch challenge history:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // 👤 Admin: Create new user
  async createUser(name: string, email: string, password: string): Promise<ApiResponse<CreateUserResponse['data']>> {
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
        body: JSON.stringify({ name, email, password } satisfies CreateUserRequest),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        logHttpFailure('Failed to create user:', response.status, data.error);
        return { success: false, error: data.error || 'Failed to create user' };
      }

      return { success: true, data: data.data };

    } catch (error) {
      logger.error('Error creating user:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  // 🔐 Admin: Reset user password
  async resetUserPassword(userId: string, newPassword: string): Promise<ApiResponse<ResetUserPasswordResponse>> {
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
        body: JSON.stringify({ newPassword } satisfies ResetUserPasswordRequest),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        logHttpFailure('Failed to reset password:', response.status, data.error);
        return { success: false, error: data.error || 'Failed to reset password' };
      }

      return { success: true, data };

    } catch (error) {
      logger.error('Error resetting password:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  // 🚪 Logout
  logout(): void {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
  }

  // 🔍 Check if user is authenticated
  isAuthenticated(): boolean {
    const token = readStoredSession(SESSION_TOKEN_KEY);
    const user = readStoredSession(SESSION_USER_KEY);
    return !!(token && user);
  }

  // 👤 Get current user from localStorage
  getCurrentUser(): LoginUser | null {
    const userStr = readStoredSession(SESSION_USER_KEY);
    if (!userStr) return null;

    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }

  // 🔑 Get auth token
  getToken(): string | null {
    return readStoredSession(SESSION_TOKEN_KEY);
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

      if (!response.ok) logHttpFailure(`Request failed: ${endpoint}`, response.status, data.error);

      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || 'Request failed'
      };

    } catch (error) {
      logger.error('Authenticated request error:', error);
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

  async getStravaStatus(): Promise<ApiResponse<StravaStatusResponse>> {
    return this.authenticatedRequest('/strava/status');
  }

  /** `consentVersion` är versionen användaren godkände före OAuth-omdirigeringen; saknas den utelämnas nyckeln och servern svarar 400 "Consent required". */
  async connectStrava(code: string, consentVersion?: StravaCallbackRequest['consent_version']): Promise<ApiResponse> {
    const body: Pick<StravaCallbackRequest, 'code'> & Partial<StravaCallbackRequest> = { code, consent_version: consentVersion };
    return this.authenticatedRequest('/strava/callback', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async syncStrava(): Promise<ApiResponse<{ newRuns: number; totalActivities: number; message: string }>> {
    return this.authenticatedRequest('/strava/sync', {
      method: 'POST',
    });
  }

  /** PUT /strava/sync-paused: pausar eller slår på synken. Svaret är läget efter anropet (ADR 007-formen packas upp här). */
  async setStravaSyncPaused(paused: boolean): Promise<ApiResponse<StravaSyncPausedResponse['data']>> {
    const body: StravaSyncPausedRequest = { paused };
    const result = await this.authenticatedRequest<StravaSyncPausedResponse>('/strava/sync-paused', { method: 'PUT', body: JSON.stringify(body) });
    if (!result.success || !result.data) return { success: false, error: result.error || 'Request failed' };
    return { success: true, data: result.data.data };
  }

  /**
   * DELETE /strava/disconnect. Kontraktet är `{ success, message }` och ändras inte av bortkopplingen i backend (ADR 010 beslut 7.4): den
   * ber Strava återkalla åtkomsten och raderar Stravarundorna. Klienten utgår aldrig från att rundorna är borta förrän den läst om dem.
   */
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

  // 👤 User Methods
  async uploadProfilePicture(file: File): Promise<ApiResponse<UploadProfilePictureResponse['data']>> {
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
      logger.error('Upload profile picture error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // 🏆 Title System Methods
  /** GET /titles/leaderboard — katalogen med anroparens grupps innehavare; tom lista utan grupp (contracts/titles). */
  async getTitleLeaderboard(): Promise<ApiResponse<TitleLeaderboardEntry[]>> {
    return this.getEnvelope<TitleLeaderboardEntry[]>('/titles/leaderboard', 'Failed to fetch title leaderboard');
  }

  /**
   * GET /titles/user/:id. En användare utanför anroparens grupp ger 404 ("User not found"); det läses som en tom lista så att ingen vy
   * (Runner card) visar ett fel som avslöjar att personen finns i en annan grupp, och så att react-query inte försöker igen.
   */
  async getUserTitles(userId: string): Promise<ApiResponse<UserTitleEntry[]>> {
    return this.getEnvelope<UserTitleEntry[]>(`/titles/user/${encodeURIComponent(userId)}`, 'Failed to fetch user titles', []);
  }

  /** GET /titles/group-eligibility — gruppens värden per måttnyckel (camelCase-fält, contracts/titles). */
  async getTitleGroupEligibility(): Promise<ApiResponse<GroupEligibilityEntry[]>> {
    return this.getEnvelope<GroupEligibilityEntry[]>('/titles/group-eligibility', 'Failed to fetch title progress');
  }

  async updateDisplayedTitles(titleIds: string[]): Promise<ApiResponse<UpdateDisplayedTitlesResponse>> {
    const body: UpdateDisplayedTitlesRequest = { title_ids: titleIds };
    return this.authenticatedRequest<UpdateDisplayedTitlesResponse>('/auth/me/displayed-titles', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // 🔄 Refresh title leaderboards after data changes. Servern svarar { success, message, timestamp } (ingen räknare); klienten använder bara utfallet.
  async refreshTitleLeaderboards(): Promise<ApiResponse<TitlesRefreshResponse>> {
    try {
      const response = await this.authenticatedRequest<TitlesRefreshResponse>('/titles/refresh', {
        method: 'POST'
      });

      if (!response.success) {
        logger.warn('Failed to refresh title leaderboards:', response.error); // 5xx och nätverksfel rapporteras redan av authenticatedRequest
        return { success: false, error: response.error };
      }

      return { success: true };

    } catch (error) {
      logger.error('Error refreshing title leaderboards:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // 🔧 Admin Settings Management
  async getAdminSettings(): Promise<ApiResponse<AdminSettingsResponse['data']>> {
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
      logger.error('Error fetching admin settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateAdminSettings(settings: UpdateAdminSettingsRequest): Promise<ApiResponse<UpdateAdminSettingsResponse['data']>> {
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
      logger.error('Error updating admin settings:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getStreakMultipliers(): Promise<ApiResponse<StreakMultipliersResponse['data']>> {
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
      logger.error('Error fetching streak multipliers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateStreakMultipliers(multipliers: UpdateStreakMultipliersRequest['multipliers']): Promise<ApiResponse<UpdateStreakMultipliersResponse['data']>> {
    try {
      const body: UpdateStreakMultipliersRequest = { multipliers };
      const response = await fetch(`${API_BASE_URL}/auth/streak-multipliers`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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
      logger.error('Error updating streak multipliers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async updateRun(runId: string, updates: UpdateRunRequest): Promise<ApiResponse<UpdateRunResponse['run']>> {
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
        if (data.written === true) return writtenFailure(data.error);
        throw new Error(data.error || 'Failed to update run');
      }

      return { success: true, data: data.run, message: data.message };
    } catch (error) {
      logger.error('Error updating run:', error);
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
        if (data.written === true) return writtenFailure(data.error);
        throw new Error(data.error || 'Failed to delete run');
      }

      return { success: true, message: data.message };
    } catch (error) {
      logger.error('Error deleting run:', error);
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
   * `involves: 'me'` (ADR 011 beslut 9, servern sedan RUN-188) begränsar till rader där betraktaren är aktör/target (eller deltar i ett event). Exakt `me`
   * skickas (allt annat ger 400); `meta.unread_count` följer inte filtret, och `has_more`/`next_before` gäller det filtrerade flödet.
   */
  async getNews(query: NewsQuery = {}): Promise<ApiResponse<NewsResponse> & { meta?: NewsMeta }> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.after !== undefined) params.set('after', String(query.after));
    if (query.type) params.set('type', query.type);
    if (query.involves) params.set('involves', query.involves);
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

  /** POST /news/read — kvittera enskilda rader (1–50 unika id:n). Svaret är olästa efter kvitteringen (mättad vid 500). */
  async markNewsRead(ids: number[]): Promise<ApiResponse<NewsReadResponse>> {
    const body: NewsReadRequest = { ids };
    const result = await this.newsRequest<NewsReadApiResponse>('POST', '/news/read', body, 'Failed to mark the rows as read');
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.body.data };
  }

  // ─── Användarinställningar (ADR 011 beslut 2) ─────────────────────────────

  /** GET /settings — alla nycklar i användarens scope, upplösta (saknad nyckel = default), och `meta.customised`. */
  async getSettings(): Promise<ApiResponse<SettingsResponse> & { meta?: SettingsMeta }> {
    const result = await this.newsRequest<SettingsApiResponse>('GET', '/settings', undefined, 'Failed to fetch settings');
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.body.data, meta: result.body.meta };
  }

  /**
   * PUT /settings — patch av enskilda nycklar (`null` = återställ till default). Servern svarar med HELA tillståndet, så svaret kan skrivas rakt in
   * i cachen. Ett 500 kan betyda att skrivningen lyckades men återläsningen föll: anroparen litar därför inte på ett fel som sanning om lagringen.
   */
  async putSettings(values: UpdateSettingsRequest['values']): Promise<ApiResponse<SettingsResponse> & { meta?: SettingsMeta }> {
    const body: UpdateSettingsRequest = { values };
    const result = await this.newsRequest<SettingsApiResponse>('PUT', '/settings', body, 'Failed to save settings');
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.body.data, meta: result.body.meta };
  }

  // Delad hjälpare för de personliga anropen (nyheter och inställningar): token, 401-hantering och ApiResponse-formen.
  private async newsRequest<T>(
    method: 'GET' | 'POST' | 'PUT', path: string, body: unknown, failure: string,
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
        logHttpFailure(failure, response.status, parsed.error);
        return { ok: false, error: parsed.error || failure };
      }
      return { ok: true, body: parsed as T };
    } catch (error) {
      logger.error(`${failure}:`, error);
      return { ok: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // ─── Runs ─────────────────────────────────────────────────────────────────

  /**
   * POST /runs. `isTreadmill` utelämnas → kolumnen förblir NULL (okänt); formuläret skickar alltid en bool.
   * `idempotencyKey` (uuid v4, en per inskick) skickas som headern Idempotency-Key: servern skapar då aldrig en andra
   * runda för samma nyckel, så ett omförsök efter ett svar som aldrig kom fram blir ingen dubblett.
   */
  async createRun(date: string, distance: number, isTreadmill?: boolean, idempotencyKey?: string): Promise<ApiResponse<CreateRunResponse['run']>> {
    try {
      const body: CreateRunRequest = { date, distance, ...(isTreadmill !== undefined && { is_treadmill: isTreadmill }) };
      const response = await fetch(`${API_BASE_URL}/runs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.handleUnauthorized();
          return { success: false, error: 'Session expired. Please log in again.' };
        }
        if (data.written === true) return writtenFailure(data.error);
        throw new Error(data.error || 'Failed to create run');
      }

      return { success: true, data: data.run, message: data.message };
    } catch (error) {
      logger.error('Error creating run:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
export const backendApi = new BackendApiService();
