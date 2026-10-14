// Strava client: the one token path and the one fetch path for polling, GET /status and the webhook worker (ADR 010 decision 7).
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../config/database.js';

const STRAVA_API = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

// Hooks for the rate-budget module (RUN-234). Deliberately empty: every Strava call already passes stravaFetch,
// so the budget can later gate the request and read the rate limit headers here without touching any caller.
async function beforeStravaRequest(_url: string): Promise<void> {}
function afterStravaResponse(_url: string, _response: Response): void {}

/** The only place that calls Strava over the network. */
export async function stravaFetch(url: string, init?: RequestInit): Promise<Response> {
  await beforeStravaRequest(url);
  const response = await fetch(url, init);
  afterStravaResponse(url, response);
  return response;
}

/**
 * Fetch the detailed Strava activity (includes splits_metric).
 * Returns null on any failure so callers can fall back to the summary object.
 */
export async function fetchDetailedActivity(activityId: string | number, accessToken: string): Promise<any> {
  try {
    const res = await stravaFetch(`${STRAVA_API}/activities/${activityId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      logger.warn(`⚠️ Could not fetch detailed activity ${activityId}: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn(`⚠️ Error fetching detailed activity ${activityId}:`, err);
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

async function refreshStravaToken(refreshToken: string, userId: string): Promise<{
  success: boolean;
  access_token?: string;
  error?: string;
}> {
  try {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return { success: false, error: 'Strava credentials not configured' };
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

    const tokenData = await response.json();

    if (!response.ok) {
      logger.error('❌ Token refresh failed:', tokenData);
      return { success: false, error: 'Failed to refresh token' };
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

    let { error } = await supabase.from('strava_tokens').update(newTokens).eq('user_id', userId);
    if (error) {
      logger.error('⚠️ Token save failed, retrying once:', error);
      ({ error } = await supabase.from('strava_tokens').update(newTokens).eq('user_id', userId));
    }

    if (error) {
      logger.error(`🚨 KRITISKT: kunde inte spara roterad Strava-token för user ${userId} — användaren måste koppla om Strava. Fel:`, error);
      return { success: false, error: 'Failed to save new tokens' };
    }

    logger.info('✅ Strava token refreshed successfully');
    return { success: true, access_token: tokenData.access_token };

  } catch (error) {
    logger.error('❌ Token refresh error:', error);
    return { success: false, error: 'Token refresh failed' };
  }
}

/** What the stored connection says, so callers such as GET /status need no second query. */
interface StoredTokenState {
  /** Epoch seconds as stored before any refresh. */
  expiresAt: number | null;
  connectionDate: string | null;
}

export type AccessTokenResult =
  | ({ ok: true; accessToken: string; refreshed: boolean } & StoredTokenState)
  | { ok: false; reason: 'not_connected' }
  | ({ ok: false; reason: 'refresh_failed' | 'no_refresh_token' } & StoredTokenState);

/**
 * A usable access token for the user: the stored one, or a renewed one when it has expired (the new tokens are saved, with one
 * retry and a KRITISKT alarm when saving keeps failing). Never throws for an unconnected user or a failed renewal; says why instead.
 */
export async function getValidAccessToken(userId: string): Promise<AccessTokenResult> {
  const supabase = getSupabaseClient();
  const { data: tokens, error } = await supabase
    .from('strava_tokens')
    .select('access_token, refresh_token, expires_at, connection_date')
    .eq('user_id', userId)
    .single();

  if (error || !tokens) return { ok: false, reason: 'not_connected' };

  const state: StoredTokenState = { expiresAt: tokens.expires_at ?? null, connectionDate: tokens.connection_date ?? null };
  const now = Math.floor(Date.now() / 1000);
  if (!(tokens.expires_at && tokens.expires_at < now)) {
    return { ok: true, accessToken: tokens.access_token, refreshed: false, ...state };
  }

  // Without a refresh token Strava could only refuse, so do not ask.
  if (!tokens.refresh_token) return { ok: false, reason: 'no_refresh_token', ...state };

  logger.info('🔄 Access token expired, refreshing...');
  const refreshResult = await refreshStravaToken(tokens.refresh_token, userId);
  if (!refreshResult.success) return { ok: false, reason: 'refresh_failed', ...state };
  return { ok: true, accessToken: refreshResult.access_token!, refreshed: true, ...state };
}
