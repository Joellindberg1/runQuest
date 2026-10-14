// Strava client: the one token path and the one fetch path for polling, GET /status and the webhook worker (ADR 010 decision 7).
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { getSupabaseClient } from '../config/database.js';

const STRAVA_API = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

export interface StravaRequestHooks {
  /** Runs before the request is sent; awaiting it lets a later rate budget hold the request back. */
  before(url: string): void | Promise<void>;
  /** Runs with every response, also error responses, so a later rate budget can read the rate limit headers. */
  after(url: string, response: Response): void;
}

// Hooks for the rate-budget module (RUN-234). Empty on purpose: every Strava call already passes stravaFetch,
// so the budget can later gate the request and read the rate limit headers here without touching any caller.
let hooks: StravaRequestHooks = { before: () => {}, after: () => {} };

/** Replaces the hooks (the ones not given keep their current value). Returns a function that puts the previous hooks back. */
export function setStravaRequestHooks(next: Partial<StravaRequestHooks>): () => void {
  const previous = hooks;
  hooks = { ...hooks, ...next };
  return () => {
    hooks = previous;
  };
}

/** The only place that calls Strava over the network. */
export async function stravaFetch(url: string, init?: RequestInit): Promise<Response> {
  await hooks.before(url);
  const response = await fetch(url, init);
  hooks.after(url, response);
  return response;
}

/**
 * The name of a caught error, nothing else. A SyntaxError from response.json() carries a piece of the body in its message, and the
 * body of a token answer is the one place a token can be (ADR 010 decision 8.6).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name.replace(/[^\w.:-]/g, '').slice(0, 40) || 'Error' : typeof error;
}

/**
 * Fetch the detailed Strava activity (includes splits_metric).
 * Returns null on any failure so callers can fall back to the summary object.
 * The log lines carry a status or an error name, never the activity id (ADR 010 decision 8.6).
 */
export async function fetchDetailedActivity(activityId: string | number, accessToken: string): Promise<any> {
  try {
    const res = await stravaFetch(`${STRAVA_API}/activities/${activityId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      logger.warn(`⚠️ Could not fetch a detailed activity: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn(`⚠️ Error fetching a detailed activity (${errorName(err)})`);
    return null;
  }
}

/** The raw response of the athlete's activity list from `after` (epoch seconds), 200 per page (Strava's maximum). */
export function fetchAthleteActivities(accessToken: string, after: number): Promise<Response> {
  return stravaFetch(`${STRAVA_API}/athlete/activities?after=${after}&per_page=200`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

/** The body of an answer as JSON, or null when it is not. Read for classification only; it is never logged. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Did Strava's token endpoint reject the REFRESH TOKEN (revoked, invalid or replaced)? Deliberately narrow, because a wrong "yes"
 * lets a forged deauthorize event delete a user's runs (ADR 010 decision 7.4.3): only status 400 or 401 with a body that names the
 * refresh token counts, and an error about our own client credentials never does.
 *
 * ASSUMED shapes, not yet seen from real Strava (to be checked in the release preview against real Strava, RUN-182):
 *   400 or 401 {"message":"Bad Request" | "Authorization Error","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}
 *   400 or 401 {"error":"invalid_grant"}                         (the OAuth 2 wording, in case Strava uses it)
 * The message alone ("Authorization Error" without such an entry) is NOT enough: Strava uses it for every 401, a wrong client secret
 * included, so a body that lacks the Application entry could still be our own fault. If the preview shows that a revoked token
 * answers with the message only, adding that case back is a decision of its own (Lead).
 */
function isRefreshTokenRejection(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 401) return false;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const { error, errors } = body as { error?: unknown; errors?: unknown };

  const details = Array.isArray(errors) ? errors.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
  const aboutOurApplication = details.some((entry) => entry.resource === 'Application' || entry.field === 'client_id' || entry.field === 'client_secret');
  if (aboutOurApplication) return false;

  const namesRefreshToken = details.some((entry) => entry.resource === 'RefreshToken' || entry.field === 'refresh_token');
  return namesRefreshToken || error === 'invalid_grant';
}

type RefreshOutcome =
  | { kind: 'refreshed'; accessToken: string }
  /** Strava's token endpoint rejected the refresh token. */
  | { kind: 'rejected' }
  /** Anything else: a network error, 5xx, 429, missing credentials, an unusable answer, a failed or superseded save. */
  | { kind: 'failed' };

function isTokenAnswer(data: unknown): data is { access_token: string; refresh_token: string; expires_at: number } {
  if (typeof data !== 'object' || data === null) return false;
  const { access_token, refresh_token, expires_at } = data as Record<string, unknown>;
  return typeof access_token === 'string' && access_token !== '' && typeof refresh_token === 'string' && refresh_token !== '' && typeof expires_at === 'number';
}

/** Whether the user's row holds exactly this refresh token. A read that fails is "no": the save then counts as not done. */
async function rowHoldsRefreshToken(userId: string, refreshToken: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().from('strava_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
  return !error && data?.refresh_token === refreshToken;
}

async function refreshStravaToken(refreshToken: string, userId: string): Promise<RefreshOutcome> {
  try {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return { kind: 'failed' };
    }

    const response = await stravaFetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const tokenData = await readJson(response);

    if (!response.ok) {
      if (isRefreshTokenRejection(response.status, tokenData)) {
        // Only while the row still holds the token we asked with. Another refresh that ran at the same time may have replaced it
        // (Strava then refuses the old one), a reconnect may have, a disconnect may have removed the row: none of that says Strava
        // withdrew the authorisation. A check that cannot be made counts the same way.
        if (!(await rowHoldsRefreshToken(userId, refreshToken))) {
          logger.warn(`⚠️ Strava refused a refresh token for user ${userId} (HTTP ${response.status}), but it is no longer the stored one`);
          return { kind: 'failed' };
        }
        logger.warn(`⚠️ Strava rejected the refresh token for user ${userId} (HTTP ${response.status})`);
        return { kind: 'rejected' };
      }
      logger.error(`❌ Token refresh failed for user ${userId} (HTTP ${response.status})`);
      return { kind: 'failed' };
    }

    if (!isTokenAnswer(tokenData)) {
      logger.error(`❌ Token refresh answer for user ${userId} has no usable tokens (HTTP ${response.status})`);
      return { kind: 'failed' };
    }

    // Update tokens in database. Strava har redan roterat refresh-tokenen i
    // och med svaret ovan — misslyckas skrivningen är den gamla tokenen död
    // och kopplingen förlorad. Därför: försök igen en gång och larma HÖGT.
    const supabase = getSupabaseClient();
    const newTokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at
    };

    // Conditional on the refresh token we used: the row is only ours to change while it still holds it. A reconnect (a new row) or a
    // disconnect that happened while this call was under way must not be overwritten, or brought back, by a late answer.
    const save = () => supabase
      .from('strava_tokens')
      .update(newTokens)
      .eq('user_id', userId)
      .eq('refresh_token', refreshToken)
      .select('user_id');

    let { data: saved, error } = await save();
    const firstAttemptFailed = Boolean(error);
    if (error) {
      logger.error(`⚠️ Token save failed for user ${userId}, retrying once (${errorCode(error)})`);
      ({ data: saved, error } = await save());
    }

    if (error) {
      logger.error(`🚨 KRITISKT: kunde inte spara roterad Strava-token för user ${userId} — användaren måste koppla om Strava. Fel: ${errorCode(error)}`);
      return { kind: 'failed' };
    }

    if (!saved || saved.length === 0) {
      // No row holds the old refresh token any more. After a failed first attempt this can be our own save, applied before its answer
      // was lost: then the row holds the new tokens and all is well.
      if (firstAttemptFailed && (await rowHoldsRefreshToken(userId, tokenData.refresh_token))) {
        logger.info('✅ Strava token refreshed successfully');
        return { kind: 'refreshed', accessToken: tokenData.access_token };
      }
      // Otherwise the connection was replaced or removed meanwhile. The new tokens belong to the old connection: neither used nor saved.
      logger.warn(`⚠️ Token refresh for user ${userId} was superseded by a newer connection; its answer is dropped`);
      return { kind: 'failed' };
    }

    logger.info('✅ Strava token refreshed successfully');
    return { kind: 'refreshed', accessToken: tokenData.access_token };

  } catch (error) {
    logger.error(`❌ Token refresh error for user ${userId} (${errorName(error)})`);
    return { kind: 'failed' };
  }
}

/** What the stored connection says, so callers such as GET /status need no second query. */
interface StoredTokenState {
  /** Epoch seconds as stored before any refresh. */
  expiresAt: number | null;
  connectionDate: string | null;
  /** null for connections made before the consent log (ADR 010 decision 12). */
  consentVersion: string | null;
}

/**
 * Why no token was had. Every caller must handle all of them (the compiler checks it where they are listed):
 *   - not_connected: there is no row. The only reason that means "no connection".
 *   - token_read_failed: the row could not be read (a database error). Says nothing about the connection; a retry may work.
 *   - no_refresh_token: the token has expired and the row holds no refresh token to renew with.
 *   - refresh_rejected: Strava's token endpoint rejected the refresh token (revoked or invalid). The only reason that proves Strava
 *     withdrew the authorisation; nothing else may be read as that.
 *   - refresh_failed: any other failure of the renewal (network, 5xx, 429, missing credentials, an unusable answer, a failed or
 *     superseded save). Says nothing about the authorisation; a retry may work.
 */
export type AccessTokenResult =
  | ({ ok: true; accessToken: string; refreshed: boolean } & StoredTokenState)
  | { ok: false; reason: 'not_connected' }
  | { ok: false; reason: 'token_read_failed' }
  | ({ ok: false; reason: 'refresh_failed' | 'refresh_rejected' | 'no_refresh_token' } & StoredTokenState);

export type AccessTokenFailureReason = Extract<AccessTokenResult, { ok: false }>['reason'];

/**
 * A usable access token for the user: the stored one, or a renewed one when it has expired (the new tokens are saved, with one
 * retry and a KRITISKT alarm when saving keeps failing). Never throws for an unconnected user or a failed renewal; says why instead.
 */
export async function getValidAccessToken(userId: string): Promise<AccessTokenResult> {
  return accessToken(userId, false);
}

/**
 * A freshly renewed token, even when the stored one has not expired: the answer to a 401 from Strava (ADR 010 7.1, renew once).
 * Same result and same saving as getValidAccessToken; it never reuses the stored access token.
 */
export async function refreshAccessToken(userId: string): Promise<AccessTokenResult> {
  return accessToken(userId, true);
}

async function accessToken(userId: string, forceRefresh: boolean): Promise<AccessTokenResult> {
  let tokens: Record<string, any> | null;
  try {
    const supabase = getSupabaseClient();
    // maybeSingle: a missing row is data null WITHOUT an error, so a read that failed can be told apart from "not connected".
    const { data, error } = await supabase
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at, connection_date, consent_version')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      logger.error(`❌ Could not read the Strava token row for user ${userId} (${errorCode(error)})`);
      return { ok: false, reason: 'token_read_failed' };
    }
    tokens = data;
  } catch (error) {
    logger.error(`❌ Could not read the Strava token row for user ${userId} (${errorCode(error)})`);
    return { ok: false, reason: 'token_read_failed' };
  }

  if (!tokens) return { ok: false, reason: 'not_connected' };

  const state: StoredTokenState = { expiresAt: tokens.expires_at ?? null, connectionDate: tokens.connection_date ?? null, consentVersion: tokens.consent_version ?? null };
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && !(tokens.expires_at && tokens.expires_at < now)) {
    return { ok: true, accessToken: tokens.access_token, refreshed: false, ...state };
  }

  // Without a refresh token Strava could only refuse, so do not ask.
  if (!tokens.refresh_token) return { ok: false, reason: 'no_refresh_token', ...state };

  logger.info(forceRefresh ? '🔄 Strava rejected the access token, refreshing...' : '🔄 Access token expired, refreshing...');
  const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
  if (refreshResult.kind === 'rejected') return { ok: false, reason: 'refresh_rejected', ...state };
  if (refreshResult.kind === 'failed') return { ok: false, reason: 'refresh_failed', ...state };
  return { ok: true, accessToken: refreshResult.accessToken, refreshed: true, ...state };
}
