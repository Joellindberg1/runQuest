// 🔗 Backend API Service - Production Ready
import type {
  // gemensamma svarsformer
  ApiError, ApiErrorCode, ApiSuccess,
  // auth, användare och adminens inställningar
  AdminSettingsResponse, AdminUsersResponse, ChangePasswordRequest, CreateUserRequest, CreateUserResponse,
  LoginRequest, LoginResponse, LoginUser, ResetUserPasswordRequest, StreakMultipliersResponse, UpdateAdminSettingsRequest,
  UpdateAdminSettingsResponse, UpdateDisplayedTitlesRequest, UpdateStreakMultipliersRequest, UpdateStreakMultipliersResponse,
  UploadProfilePictureResponse, UsersWithRunsResponse,
  // rundor
  CreateRunRequest, CreateRunResponse, GroupRunHistoryResponse, UpdateRunRequest, UpdateRunResponse,
  // utmaningar
  ChallengeGroupHistoryResponse, ChallengeGroupStatsResponse, ChallengeProgressResponse, ChallengeResponseAction, HeadToHeadResponse, MyChallengesResponse,
  RespondChallengeRequest, SendChallengeRequest, SendChallengeResponse,
  // grupper
  JoinGroupRequest, JoinGroupResponse, MyGroupResponse,
  // topplistor, konfiguration och landning
  PublicStatsApiResponse, PublicStatsData, RankDeltaResponse, WeekLeaderboardResponse, XpConfigResponse,
  // events, nyheter och inställningar
  EventsHistoryResponse, EventsResponse, NewsMeta, NewsQuery, NewsReadRequest, NewsReadResponse, NewsResponse,
  NewsSeenRequest, NewsSeenResponse, OffsetPageMeta, SettingsMeta, SettingsResponse, UpdateSettingsRequest,
  // väntelista
  AdminWaitlistData, WaitlistSignupRequest,
  // Strava
  StravaBackfillExtendedResponse, StravaCallbackRequest, StravaConfigResponse, StravaStatus, StravaSyncPausedRequest, StravaSyncPausedResponse, StravaSyncResponse,
  // titlar
  GroupEligibilityEntry, TitleLeaderboardEntry, TitleLeaderboardMeta, UserTitleEntry,
} from '@runquest/shared';
import { isApiErrorCode } from '@runquest/shared';
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

/** Den enda texten för en utgången session, oavsett vilket anrop som upptäckte den. */
const SESSION_EXPIRED = 'Session expired. Please log in again.';
const NOT_AUTHENTICATED = 'Not authenticated';
/** Texten som uppladdningen och de generiska anropen (authenticatedRequest) har gett utan token; badges-testerna läser den. */
const NO_AUTHENTICATION_TOKEN = 'No authentication token';
const UNEXPECTED_RESPONSE = 'Unexpected response from the server';
const NETWORK_ERROR = 'Network error';

/** Utfallet av login() hos klienten: token och användare (serverns `data`, eller den gamla toppnivån) eller ett fel. Aldrig serverns kropp rått. */
export type LoginResult = { success: true; token: string; user: LoginUser } | { success: false; error: string };

/**
 * Felsvaret hos klienten: shared:s `ApiError` med `success: false`. `code` är serverns maskinkod ur katalogen (ADR 007 Addendum 2026-10-20) och saknas för ett lokalt fel
 * ("Not authenticated"), för ett fel från en backend före steg 1 och för en kod klienten inte känner (en nyare server): då gäller statusens klass.
 * `written` följer med när POST/PUT/DELETE /runs skrev ändringen men XP-omräkningen föll (500, koden `recalc_failed_after_write`, med eller utan fältet): cachen är
 * inaktuell och ett nytt försök kan dubblera. De frånvarande fälten är typade så att anroparen kan läsa `data` och `meta` utan att först avgöra utfallet.
 */
export type ApiFailureResult = Omit<ApiError, 'code' | 'data'> & { code?: ApiErrorCode; data?: undefined; meta?: undefined; message?: undefined };

/** Det klienten lämnar till anroparen: shared:s `ApiSuccess` (med `meta` när metoden bär det) plus serverns text om den behövs, eller ett fel. */
export type ApiResult<T = unknown, M = undefined> =
  | (ApiSuccess<T, M> & { message?: string; error?: undefined; written?: undefined })
  | ApiFailureResult;

/** En sida av gruppens rundor: `runs` och `meta` (paginering). Sidans form är densamma före och efter steg 1 av kuvertbytet. */
export type GroupRunHistoryPage = GroupRunHistoryResponse['data'] & { meta: OffsetPageMeta };
/** En sida av avslutade events: `events` och `meta` (paginering). */
export type EventsHistoryPage = EventsHistoryResponse['data'] & { meta: OffsetPageMeta };

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type JsonObject = Record<string, unknown>;

/**
 * Det en metod plockar ur ett lyckat svar. Alla former svaren har i dag bor i läsarna nedan, ingen annanstans. Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20 punkt 7-8,
 * RUN-354): `data` läses först och den gamla nyckeln (`run`, `runs`, `events`, `seen`, hela kroppen) är reserv. Reservläsningen tas bort i steg 2 (RUN-364), då backend
 * inte längre skickar de gamla nycklarna: sök på "Steg 1" och "reserv" i den här filen.
 */
type Reader<T, M> = (body: JsonObject) => { data: T; meta?: M; message?: string };

const isJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Har svaret `data`? (`data: null` räknas: en åtgärd utan nyttolast.) */
const hasData = (body: JsonObject): boolean => body.data !== undefined;

/** `{ success, data }`: nyttolasten ligger i `data`. */
const readData = <T>(body: JsonObject) => ({ data: body.data as T });
/** `{ success, data, meta }`: som `readData`, och `meta` (paginering, olästa, diagnostik) når anroparen. */
const readDataAndMeta = <T, M>(body: JsonObject) => ({ data: body.data as T, meta: body.meta as M });
/** Hela kroppen är nyttolasten: för anrop som äger sin egen uppackning (`authenticatedRequest`). */
const readBody = <T>(body: JsonObject) => ({ data: body as T });
/**
 * Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20 punkt 7-8): `data` först; saknas den (en backend från före steg 1) är hela den gamla kroppen nyttolasten.
 * För svar som var nakna eller hade nyttolasten på toppnivå (`{ events }`, `{ connected, … }`, `{ token, user }`, `{ client_id }`).
 */
const readEnveloped = <T>(body: JsonObject) => ({ data: (hasData(body) ? body.data : body) as T });
/** Som `readEnveloped`, och serverns text följer med (`join`, `sync`). */
const readEnvelopedAndMessage = <T>(body: JsonObject) => ({ ...readEnveloped<T>(body), message: typeof body.message === 'string' ? body.message : undefined });
/**
 * En sida med `meta`: nyttolasten (`data` först, annars den gamla kroppen) och `meta`, som ligger på toppnivå i båda formerna. Anroparna läser `data.meta` som förut.
 */
const readPage = <T>(body: JsonObject) => {
  const payload = hasData(body) && isJsonObject(body.data) ? body.data : body;
  return { data: { ...payload, meta: body.meta } as T };
};
/** POST/PUT /runs: rundan ligger i `data.run` (steg 1), annars i den gamla toppnivånyckeln `run`; serverns text i `message`. */
const readRun = <T>(body: JsonObject) => ({
  data: (isJsonObject(body.data) && 'run' in body.data ? body.data.run : body.run) as T,
  message: body.message as string | undefined,
});
/** `{ success, data, message }`: som `readData`, och serverns text följer med. */
const readDataAndMessage = <T>(body: JsonObject) => ({ data: body.data as T, message: body.message as string | undefined });
/** Svar där bara utfallet räknas. */
const readNothing = (): { data: void } => ({ data: undefined });
const readMessage = (body: JsonObject): { data: void; message: string | undefined } => ({ data: undefined, message: body.message as string | undefined });

interface RequestOptions<T, M> {
  /** Texten när servern inte ger någon (och loggraden för felet). */
  failure?: string;
  /** Hur ett lyckat svar packas upp. Standard: `readData`. */
  read?: Reader<T, M>;
  /** Anrop utan inloggning: ingen Authorization-header, och en 401 är inte en utgången session (fel lösenord, publik endpoint). */
  auth?: boolean;
  /** Extra headers, efter Authorization och Content-Type. */
  headers?: Record<string, string>;
  /** `null` = inget Content-Type (några anrop skickar inget i dag). Standard: application/json; en uppladdning skickar filens typ. */
  contentType?: string | null;
  /** Ett 404 som ska läsas som "inget att visa" i stället för ett fel (se getUserTitles). */
  notFoundData?: T;
  /** Felet utan token, då inget anrop görs. Standard: "Not authenticated". */
  noTokenError?: string;
}

/** Svaret på ett anrop: HTTP-utfallet och kroppen som objekt, eller `undefined` när kroppen inte var JSON (en HTML-felsida från en proxy, ett tomt svar). */
interface Reply {
  status: number;
  ok: boolean;
  body: JsonObject | undefined;
}

async function readJsonObject(response: Response): Promise<JsonObject | undefined> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonObject) : undefined;
  } catch {
    return undefined;
  }
}

/** Serverns text ur ett felsvar, om det har någon. */
function errorTextOf(body: JsonObject | undefined): string | undefined {
  return typeof body?.error === 'string' && body.error ? body.error : undefined;
}

/** Serverns kod ur ett felsvar, om den är en kod klienten känner. En okänd kod (en nyare server) och ingen kod (en äldre) är samma sak: statusens klass avgör. */
function errorCodeOf(body: JsonObject | undefined): ApiErrorCode | undefined {
  return isApiErrorCode(body?.code) ? body.code : undefined;
}

function failed(error: string, extra: { code?: ApiErrorCode; written?: true } = {}): ApiFailureResult {
  return { success: false, error, ...(extra.code !== undefined && { code: extra.code }), ...(extra.written && { written: true as const }) };
}

/**
 * Ett 401 med token avslutar sessionen bara när koden säger det (`unauthorized`, `token_invalid`) eller när det inte finns någon känd kod (en backend före steg 1 och en kod
 * klienten inte känner: statusens klass, 401). `invalid_credentials` och `current_password_incorrect` är ett svar på ett lösenord, inte en utgången session.
 */
// Vitlista, inte spärrlista: bara de två koderna, eller ingen känd kod, avslutar sessionen. En känd kod av annat slag på ett 401 (till exempel `forbidden`, som servern inte skickar med 401
// men som katalogen har) är ett svar på något annat än token och lämnar sessionen. En okänd kod filtreras bort av isApiErrorCode och är därför "ingen kod": statusens klass, alltså utloggning.
function endsSession(code: ApiErrorCode | undefined): boolean {
  return code === undefined || code === 'unauthorized' || code === 'token_invalid';
}

/**
 * Svar som inte gick igenom loggas efter vad de betyder. 4xx är väntat (fel lösenord, saknad post, dubblett, spärr) och är inget fel i appen,
 * så de är en varning och blir ingen felhändelse. 5xx är oväntat och rapporteras. Nätverksfel loggas som fel i `request`.
 */
function logHttpFailure(message: string, status: number, code: ApiErrorCode | undefined): void {
  // Bara texten på anropet, statusen och koden: aldrig kroppen och aldrig serverns text (ADR 007 Addendum 2026-10-20 punkt 7).
  const line = `${message} (HTTP ${status}${code ? `, ${code}` : ''})`;
  if (status >= HTTP_SERVER_ERROR) logger.error(line);
  else logger.warn(line);
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

  /** Det enda anropet mot servern: bas-URL, metod, headers, body och en tålig läsning av svaret. Kastar bara vid nätverksfel. */
  private async send(method: HttpMethod, path: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Reply> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: init.headers ?? {},
      ...(init.body !== undefined && { body: init.body }),
    });
    return { status: response.status, ok: response.ok, body: await readJsonObject(response) };
  }

  /**
   * Alla anrop med eller utan inloggning går hit: token, headers, JSON-body, sessionsutgång (401), uppackning och fel i en och samma form.
   * Kastar aldrig. Ett svar som inte är JSON ger ett fel med metodens reservtext, aldrig ett parsefel.
   */
  private async request<T, M = undefined>(method: HttpMethod, path: string, body?: unknown, options: RequestOptions<T, M> = {}): Promise<ApiResult<T, M>> {
    const { failure = 'Request failed', read = readData as Reader<T, M>, auth = true, headers: extraHeaders, contentType, notFoundData, noTokenError = NOT_AUTHENTICATED } = options;
    try {
      const token = auth ? this.getToken() : null;
      if (auth && !token) return failed(noTokenError);

      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (contentType !== null) headers['Content-Type'] = contentType ?? 'application/json';
      Object.assign(headers, extraHeaders);

      const reply = await this.send(method, path, {
        headers,
        ...(body !== undefined && { body: body instanceof Blob ? body : JSON.stringify(body) }),
      });

      const code = errorCodeOf(reply.body);

      // Ett 401 med token avslutar sessionen bara när koden säger det eller saknas (se endsSession): ett fel nuvarande lösenord loggar inte ut.
      if (token && reply.status === 401 && endsSession(code)) {
        this.handleUnauthorized();
        return failed(SESSION_EXPIRED, { code });
      }

      // Ett fel är ett utanför 2xx, eller ett 2xx som själv säger success: false (207 partial_failure är kuvertets enda sådant svar).
      if (!reply.ok || reply.body?.success === false) {
        if (reply.status === HTTP_NOT_FOUND && notFoundData !== undefined) return { success: true, data: notFoundData };
        const error = errorTextOf(reply.body);
        // Addendum punkt 6: koden recalc_failed_after_write (eller fältet written, kvar under dubbelsvarsfönstret) betyder "skrivet, försök inte igen".
        if (code === 'recalc_failed_after_write' || reply.body?.written === true) {
          logHttpFailure(failure, reply.status, code);
          return failed(error ?? failure, { code, written: true });
        }
        logHttpFailure(failure, reply.status, code);
        return failed(error ?? failure, { code });
      }

      if (!reply.body) {
        logger.warn(`${failure}: the server did not answer with JSON`);
        return failed(UNEXPECTED_RESPONSE);
      }
      return { success: true, ...read(reply.body) };
    } catch (error) {
      logger.error(`${failure}:`, error);
      return failed(error instanceof Error ? error.message : NETWORK_ERROR);
    }
  }

  // 🔐 Authentication methods
  async login(name: string, password: string): Promise<LoginResult> {
    const body: LoginRequest = { name, password };
    const result = await this.request<LoginResponse['data']>('POST', '/auth/login', body, { auth: false, failure: 'Login failed', read: readEnveloped });
    if (!result.success) return { success: false, error: result.error };

    const login = result.data;
    // Store JWT token in localStorage
    if (login.token) {
      localStorage.setItem(SESSION_TOKEN_KEY, login.token);
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(login.user));
    }
    return { success: true, token: login.token, user: login.user };
  }

  // 🔐 Change password
  async changePassword(currentPassword: string, newPassword: string): Promise<ApiResult<void>> {
    const body: ChangePasswordRequest = { currentPassword, newPassword };
    return this.request<void>('POST', '/auth/change-password', body, { failure: 'Password change failed', read: readMessage });
  }

  // 👥 Admin: Get all users
  async getAllUsers(): Promise<ApiResult<AdminUsersResponse['data']>> {
    return this.request<AdminUsersResponse['data']>('GET', '/auth/users', undefined, { failure: 'Failed to fetch users' });
  }

  // 👥 Get all users with their runs (for leaderboard)
  async getUsersWithRuns(): Promise<ApiResult<UsersWithRunsResponse['data']>> {
    return this.request<UsersWithRunsResponse['data']>('GET', '/auth/users-with-runs', undefined, { failure: 'Failed to fetch users with runs' });
  }

  // Nya endpoints (ADR 007) svarar { success, data, meta? } / { error }; typerna ligger i @runquest/shared.

  /** GET /leaderboard/week — veckans rader, dagstaplar, totaler och mover (ADR 007 B1). */
  async getWeekLeaderboard(weekStart?: string): Promise<ApiResult<WeekLeaderboardResponse>> {
    const query = weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : '';
    return this.request<WeekLeaderboardResponse>('GET', `/leaderboard/week${query}`, undefined, { failure: 'Failed to fetch week leaderboard' });
  }

  /** GET /leaderboard/rank-delta — rank mot veckostart (ADR 007 B2). */
  async getRankDelta(): Promise<ApiResult<RankDeltaResponse>> {
    return this.request<RankDeltaResponse>('GET', '/leaderboard/rank-delta', undefined, { failure: 'Failed to fetch rank changes' });
  }

  /**
   * GET /public/stats — landningens tre tal (ingen inloggning, inget Authorization-huvud). Ett svar som inte är tre ändliga
   * tal ≥ 0 räknas som fel; felet bär HTTP-statusen ("HTTP 404") så att hooken kan låta bli att försöka igen vid 4xx.
   */
  async getPublicStats(): Promise<ApiResult<PublicStatsData>> {
    try {
      const reply = await this.send('GET', '/public/stats');
      if (!reply.ok) return failed(`HTTP ${reply.status}`);
      const data = (reply.body as Partial<PublicStatsApiResponse> | undefined)?.data;
      const valid = [data?.runners, data?.challenges, data?.km].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
      return valid && data ? { success: true, data } : failed('Invalid public stats response');
    } catch {
      return failed(NETWORK_ERROR);
    }
  }

  /** GET /admin/waitlist — väntelistans anmälningar, nyast först, och det exakta antalet (bara admin). */
  async getAdminWaitlist(): Promise<ApiResult<AdminWaitlistData>> {
    return this.request<AdminWaitlistData>('GET', '/admin/waitlist', undefined, { failure: 'Failed to load the waitlist' });
  }

  /**
   * POST /waitlist — publik endpoint, därför ingen Authorization-header. Resultatet bär HTTP-statusen (200 också för dubblett och
   * botfällor, 400, 413, 429, 500) så att formuläret kan skilja på fel; ett nätverksfel blir null. Adressen loggas aldrig.
   */
  async joinWaitlist(body: WaitlistSignupRequest): Promise<{ status: number } | null> {
    try {
      const reply = await this.send('POST', '/waitlist', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: reply.status };
    } catch {
      logger.warn('Waitlist request failed (network error)');
      return null;
    }
  }

  /** GET /config/xp — effektiva XP-inställningar + multiplikatortrappan, läsbar för alla inloggade (ADR 007 B4). */
  async getXpConfig(): Promise<ApiResult<XpConfigResponse>> {
    return this.request<XpConfigResponse>('GET', '/config/xp', undefined, { failure: 'Failed to fetch XP config' });
  }

  /** GET /challenges/head-to-head/:userId — anroparens uppgörelser mot en annan medlem (ADR 007 B6). */
  async getHeadToHead(userId: string, limit?: number): Promise<ApiResult<HeadToHeadResponse>> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request<HeadToHeadResponse>('GET', `/challenges/head-to-head/${encodeURIComponent(userId)}${query}`, undefined, { failure: 'Failed to fetch head to head' });
  }

  /**
   * GET /challenges/group-history — gruppens avslutade utmaningar, nyast först (ADR 007 B5). Offset-sidor:
   * `meta.has_more` säger om det finns fler (sidstorlek default 20, max 50).
   */
  async getChallengeGroupHistory(limit: number, offset: number): Promise<ApiResult<ChallengeGroupHistoryResponse, OffsetPageMeta>> {
    return this.request<ChallengeGroupHistoryResponse, OffsetPageMeta>('GET', `/challenges/group-history?limit=${limit}&offset=${offset}`, undefined, {
      failure: 'Failed to fetch challenge history', read: readDataAndMeta,
    });
  }

  // 👤 Admin: Create new user
  async createUser(name: string, email: string, password: string): Promise<ApiResult<CreateUserResponse['data']>> {
    const body: CreateUserRequest = { name, email, password };
    return this.request<CreateUserResponse['data']>('POST', '/auth/users', body, { failure: 'Failed to create user' });
  }

  // 🔐 Admin: Reset user password
  async resetUserPassword(userId: string, newPassword: string): Promise<ApiResult<void>> {
    const body: ResetUserPasswordRequest = { newPassword };
    return this.request<void>('PUT', `/auth/users/${userId}/password`, body, { failure: 'Failed to reset password', read: readMessage });
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

  /**
   * Anrop för features som äger sina egna endpoints (badges, onboarding, nivåtabellen) men delar token, bas-URL och sessionsutgång med resten.
   * `data` är HELA svarskroppen; anroparen packar upp den själv. `body` serialiseras som JSON.
   */
  async authenticatedRequest<T = unknown>(
    endpoint: string,
    options: { method?: HttpMethod; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResult<T>> {
    // Texten med vägen: Sentry-loggen visar då vilket anrop som föll (en metod med eget anrop har en egen text).
    return this.request<T>(options.method ?? 'GET', endpoint, options.body, { failure: `Request failed: ${endpoint}`, read: readBody, headers: options.headers, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  // 🔗 Strava Integration Methods
  async getStravaConfig(): Promise<ApiResult<StravaConfigResponse['data']>> {
    return this.request<StravaConfigResponse['data']>('GET', '/strava/config', undefined, { auth: false, contentType: null, failure: 'Failed to get Strava config', read: readEnveloped });
  }

  async getStravaStatus(): Promise<ApiResult<StravaStatus>> {
    return this.request<StravaStatus>('GET', '/strava/status', undefined, { failure: 'Failed to fetch Strava status', read: readEnveloped, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  /** `consentVersion` är versionen användaren godkände före OAuth-omdirigeringen; saknas den utelämnas nyckeln och servern svarar 400 "Consent required". */
  async connectStrava(code: string, consentVersion?: StravaCallbackRequest['consent_version']): Promise<ApiResult<void>> {
    const body: Pick<StravaCallbackRequest, 'code'> & Partial<StravaCallbackRequest> = { code, consent_version: consentVersion };
    return this.request<void>('POST', '/strava/callback', body, { failure: 'Failed to connect Strava', read: readMessage, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  async syncStrava(): Promise<ApiResult<StravaSyncResponse['data']>> {
    return this.request<StravaSyncResponse['data']>('POST', '/strava/sync', undefined, { failure: 'Failed to sync Strava', read: readEnveloped, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  /** PUT /strava/sync-paused: pausar eller slår på synken. Svaret är läget efter anropet (ADR 007-formen packas upp här). */
  async setStravaSyncPaused(paused: boolean): Promise<ApiResult<StravaSyncPausedResponse['data']>> {
    const body: StravaSyncPausedRequest = { paused };
    return this.request<StravaSyncPausedResponse['data']>('PUT', '/strava/sync-paused', body);
  }

  /**
   * DELETE /strava/disconnect. Kontraktet är `{ success, message, data: null }` och ändras inte av bortkopplingen i backend (ADR 010 beslut 7.4): den
   * ber Strava återkalla åtkomsten och raderar Stravarundorna. Klienten utgår aldrig från att rundorna är borta förrän den läst om dem.
   */
  async disconnectStrava(): Promise<ApiResult<void>> {
    return this.request<void>('DELETE', '/strava/disconnect', undefined, { failure: 'Failed to disconnect Strava', read: readMessage, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  async backfillStravaExtendedData(): Promise<ApiResult<StravaBackfillExtendedResponse['data']>> {
    return this.request<StravaBackfillExtendedResponse['data']>('POST', '/strava/backfill-extended', undefined, { failure: 'Failed to run the Strava backfill', read: readEnveloped, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  // 👤 User Methods
  async uploadProfilePicture(file: File): Promise<ApiResult<UploadProfilePictureResponse['data']>> {
    return this.request<UploadProfilePictureResponse['data']>('POST', '/users/profile-picture', file, {
      contentType: file.type, failure: 'Failed to upload profile picture', noTokenError: NO_AUTHENTICATION_TOKEN,
    });
  }

  // 🏆 Title System Methods
  /** GET /titles/leaderboard — katalogen med anroparens grupps innehavare; tom lista utan grupp (contracts/titles). `meta` bär antal och cachestatus. */
  async getTitleLeaderboard(): Promise<ApiResult<TitleLeaderboardEntry[], TitleLeaderboardMeta>> {
    return this.request<TitleLeaderboardEntry[], TitleLeaderboardMeta>('GET', '/titles/leaderboard', undefined, {
      failure: 'Failed to fetch title leaderboard', read: readDataAndMeta,
    });
  }

  /**
   * GET /titles/user/:id. En användare utanför anroparens grupp ger 404 ("User not found"); det läses som en tom lista så att ingen vy
   * (Runner card) visar ett fel som avslöjar att personen finns i en annan grupp, och så att react-query inte försöker igen.
   */
  async getUserTitles(userId: string): Promise<ApiResult<UserTitleEntry[]>> {
    return this.request<UserTitleEntry[]>('GET', `/titles/user/${encodeURIComponent(userId)}`, undefined, { failure: 'Failed to fetch user titles', notFoundData: [] });
  }

  /** GET /titles/group-eligibility — gruppens värden per måttnyckel (camelCase-fält, contracts/titles). */
  async getTitleGroupEligibility(): Promise<ApiResult<GroupEligibilityEntry[]>> {
    return this.request<GroupEligibilityEntry[]>('GET', '/titles/group-eligibility', undefined, { failure: 'Failed to fetch title progress' });
  }

  async updateDisplayedTitles(titleIds: string[]): Promise<ApiResult<void>> {
    const body: UpdateDisplayedTitlesRequest = { title_ids: titleIds };
    return this.request<void>('PUT', '/auth/me/displayed-titles', body, { failure: 'Failed to update the displayed titles', read: readNothing, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  // 🔄 Refresh title leaderboards after data changes. Servern svarar { success, message, timestamp } (ingen räknare); klienten använder bara utfallet.
  async refreshTitleLeaderboards(): Promise<ApiResult<void>> {
    return this.request<void>('POST', '/titles/refresh', undefined, { read: readNothing });
  }

  // 🔧 Admin Settings Management
  async getAdminSettings(): Promise<ApiResult<AdminSettingsResponse['data']>> {
    return this.request<AdminSettingsResponse['data']>('GET', '/auth/admin-settings', undefined, { failure: 'Failed to fetch admin settings' });
  }

  async updateAdminSettings(settings: UpdateAdminSettingsRequest): Promise<ApiResult<UpdateAdminSettingsResponse['data']>> {
    return this.request<UpdateAdminSettingsResponse['data']>('PUT', '/auth/admin-settings', settings, { failure: 'Failed to update admin settings', read: readDataAndMessage });
  }

  async getStreakMultipliers(): Promise<ApiResult<StreakMultipliersResponse['data']>> {
    return this.request<StreakMultipliersResponse['data']>('GET', '/auth/streak-multipliers', undefined, { failure: 'Failed to fetch streak multipliers' });
  }

  async updateStreakMultipliers(multipliers: UpdateStreakMultipliersRequest['multipliers']): Promise<ApiResult<UpdateStreakMultipliersResponse['data']>> {
    const body: UpdateStreakMultipliersRequest = { multipliers };
    return this.request<UpdateStreakMultipliersResponse['data']>('PUT', '/auth/streak-multipliers', body, { failure: 'Failed to update streak multipliers', read: readDataAndMessage });
  }

  async updateRun(runId: string, updates: UpdateRunRequest): Promise<ApiResult<UpdateRunResponse['run']>> {
    return this.request<UpdateRunResponse['run']>('PUT', `/runs/${runId}`, updates, { failure: 'Failed to update run', read: readRun });
  }

  async deleteRun(runId: string): Promise<ApiResult<void>> {
    return this.request<void>('DELETE', `/runs/${runId}`, undefined, { failure: 'Failed to delete run', read: readMessage });
  }

  /**
   * GET /runs/group-history — gruppens rundor, nyast först (ADR 007 B9). Offset-sidor: `meta.has_more` säger om det finns fler
   * (sidstorlek default 100, max 200). Svaret behåller nyckeln `runs` + additivt `meta`.
   */
  async getGroupRunHistoryPage(limit: number, offset: number): Promise<ApiResult<GroupRunHistoryPage>> {
    return this.request<GroupRunHistoryPage>('GET', `/runs/group-history?limit=${limit}&offset=${offset}`, undefined, {
      failure: 'Failed to fetch the group run history', read: readPage, noTokenError: NO_AUTHENTICATION_TOKEN,
    });
  }

  // ─── Groups ──────────────────────────────────────────────────────────────

  /** GET /groups/my — anroparens grupp med medlemmar, roll (my_role) och antal. 404 när användaren inte är med i någon grupp. */
  async getGroupInfo(): Promise<ApiResult<MyGroupResponse['data']>> {
    return this.request<MyGroupResponse['data']>('GET', '/groups/my', undefined, { contentType: null, failure: 'Failed to fetch group info' });
  }

  /**
   * POST /groups/join — går med i en grupp med inbjudningskod (ADR 012). 409 när användaren redan har ett aktivt medlemskap (man flyttas inte tyst),
   * 404 `invalid_invite_code` för en kod som inte finns. Svaret är gruppen (`data.group`, eller den gamla toppnivån) och serverns text.
   */
  async joinGroup(inviteCode: JoinGroupRequest['invite_code']): Promise<ApiResult<JoinGroupResponse['data']>> {
    const body: JoinGroupRequest = { invite_code: inviteCode };
    return this.request<JoinGroupResponse['data']>('POST', '/groups/join', body, { failure: 'Failed to join the group', read: readEnvelopedAndMessage, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  // ─── Challenges ──────────────────────────────────────────────────────────

  async getMyChallenges(): Promise<ApiResult<MyChallengesResponse['data']>> {
    return this.request<MyChallengesResponse['data']>('GET', '/challenges/my', undefined, { contentType: null, failure: 'Failed to fetch challenges' });
  }

  async sendChallenge(tokenId: string, opponentId: string): Promise<ApiResult<SendChallengeResponse['data']>> {
    const body: SendChallengeRequest = { token_id: tokenId, opponent_id: opponentId };
    return this.request<SendChallengeResponse['data']>('POST', '/challenges/send', body, { failure: 'Failed to send challenge' });
  }

  async respondToChallenge(challengeId: string, action: ChallengeResponseAction): Promise<ApiResult<void>> {
    const body: RespondChallengeRequest = { action };
    return this.request<void>('PUT', `/challenges/${challengeId}/respond`, body, { failure: 'Failed to respond to challenge', read: readNothing });
  }

  async withdrawChallenge(challengeId: string): Promise<ApiResult<void>> {
    return this.request<void>('PUT', `/challenges/${challengeId}/withdraw`, undefined, { contentType: null, failure: 'Failed to withdraw challenge', read: readNothing });
  }

  async getChallengeProgress(challengeId: string): Promise<ApiResult<ChallengeProgressResponse['data']>> {
    return this.request<ChallengeProgressResponse['data']>('GET', `/challenges/${challengeId}/progress`, undefined, { contentType: null, failure: 'Failed to fetch progress' });
  }

  async getChallengeGroupStats(): Promise<ApiResult<ChallengeGroupStatsResponse['data']>> {
    return this.request<ChallengeGroupStatsResponse['data']>('GET', '/challenges/group-stats', undefined, { contentType: null, failure: 'Failed to fetch group stats' });
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  /**
   * GET /events/history — avslutade events, nyast först, offset-sidor (ADR 007 B8). `data.meta` bär `total` och
   * `has_more` (sidstorlek default 30, max 50).
   */
  async getEventHistoryPage(limit: number, offset: number): Promise<ApiResult<EventsHistoryPage>> {
    return this.request<EventsHistoryPage>('GET', `/events/history?limit=${limit}&offset=${offset}`, undefined, {
      failure: 'Failed to fetch the event history', read: readPage, noTokenError: NO_AUTHENTICATION_TOKEN,
    });
  }

  /** GET /events — aktiva + schemalagda events med participantCount/memberCount för alla typer (ADR 007 B7). Enda events-metoden: Events-skärmen och skalets "Right now" delar query-nyckeln ['events'] och därmed formen. */
  async getEventList(): Promise<ApiResult<EventsResponse['data']>> {
    return this.request<EventsResponse['data']>('GET', '/events', undefined, { failure: 'Failed to fetch events', read: readEnveloped, noTokenError: NO_AUTHENTICATION_TOKEN });
  }

  // ─── News (ADR 008) ───────────────────────────────────────────────────────

  /**
   * GET /news — händelseloggen, nyast först (keyset: `before` XOR `after`, aldrig båda; `type` = kommaseparerade ActivityType).
   * `meta` bär unread_count (alla typer), last_seen_id och has_more/next_before; `after`-lägets semantik står i ADR 008 addendum 4.
   * `involves: 'me'` (ADR 011 beslut 9, servern sedan RUN-188) begränsar till rader där betraktaren är aktör/target (eller deltar i ett event). Exakt `me`
   * skickas (allt annat ger 400); `meta.unread_count` följer inte filtret, och `has_more`/`next_before` gäller det filtrerade flödet.
   */
  async getNews(query: NewsQuery = {}): Promise<ApiResult<NewsResponse, NewsMeta>> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.after !== undefined) params.set('after', String(query.after));
    if (query.type) params.set('type', query.type);
    if (query.involves) params.set('involves', query.involves);
    const qs = params.toString();
    return this.request<NewsResponse, NewsMeta>('GET', `/news${qs ? `?${qs}` : ''}`, undefined, { failure: 'Failed to fetch news', read: readDataAndMeta });
  }

  /** POST /news/seen — höjer vattenmärket monotont (utelämnat `upToId` = senaste raden i gruppen). */
  async markNewsSeen(upToId?: number): Promise<ApiResult<NewsSeenResponse>> {
    const body: NewsSeenRequest = upToId === undefined ? {} : { up_to_id: upToId };
    return this.request<NewsSeenResponse>('POST', '/news/seen', body, { failure: 'Failed to mark the news as read' });
  }

  /** POST /news/read — kvittera enskilda rader (1–50 unika id:n). Svaret är olästa efter kvitteringen (mättad vid 500). */
  async markNewsRead(ids: number[]): Promise<ApiResult<NewsReadResponse>> {
    const body: NewsReadRequest = { ids };
    return this.request<NewsReadResponse>('POST', '/news/read', body, { failure: 'Failed to mark the rows as read' });
  }

  // ─── Användarinställningar (ADR 011 beslut 2) ─────────────────────────────

  /** GET /settings — alla nycklar i användarens scope, upplösta (saknad nyckel = default), och `meta.customised`. */
  async getSettings(): Promise<ApiResult<SettingsResponse, SettingsMeta>> {
    return this.request<SettingsResponse, SettingsMeta>('GET', '/settings', undefined, { failure: 'Failed to fetch settings', read: readDataAndMeta });
  }

  /**
   * PUT /settings — patch av enskilda nycklar (`null` = återställ till default). Servern svarar med HELA tillståndet, så svaret kan skrivas rakt in
   * i cachen. Ett 500 kan betyda att skrivningen lyckades men återläsningen föll: anroparen litar därför inte på ett fel som sanning om lagringen.
   */
  async putSettings(values: UpdateSettingsRequest['values']): Promise<ApiResult<SettingsResponse, SettingsMeta>> {
    const body: UpdateSettingsRequest = { values };
    return this.request<SettingsResponse, SettingsMeta>('PUT', '/settings', body, { failure: 'Failed to save settings', read: readDataAndMeta });
  }

  // ─── Runs ─────────────────────────────────────────────────────────────────

  /**
   * POST /runs. `isTreadmill` utelämnas → kolumnen förblir NULL (okänt); formuläret skickar alltid en bool.
   * `idempotencyKey` (uuid v4, en per inskick) skickas som headern Idempotency-Key: servern skapar då aldrig en andra
   * runda för samma nyckel, så ett omförsök efter ett svar som aldrig kom fram blir ingen dubblett.
   */
  async createRun(date: string, distance: number, isTreadmill?: boolean, idempotencyKey?: string): Promise<ApiResult<CreateRunResponse['run']>> {
    const body: CreateRunRequest = { date, distance, ...(isTreadmill !== undefined && { is_treadmill: isTreadmill }) };
    return this.request<CreateRunResponse['run']>('POST', '/runs', body, {
      failure: 'Failed to create run', read: readRun, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }
}

// Export singleton instance
export const backendApi = new BackendApiService();
