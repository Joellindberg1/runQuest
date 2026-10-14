// API-kontrakt för Strava-kopplingen (nivå 1): GET /api/strava/status, POST /api/strava/callback och PUT /api/strava/sync-paused.
// Endast typer och konstanter.
import { DATA_POLICY_VERSION } from '../legal/dataPolicy.js';

/**
 * Vilken samtyckestext användaren godkände när Strava anslöts; sparas i strava_tokens.consent_version.
 * Alltid DATA_POLICY_VERSION (legal/dataPolicy.ts). Callbacken kräver att klienten skickar exakt det här värdet (ADR 010 beslut 12).
 */
export const STRAVA_CONSENT_VERSION = DATA_POLICY_VERSION;

/** Brödtext till POST /api/strava/callback. consented_at finns medvetet inte här: servern sätter den. */
export interface StravaCallbackRequest {
  code: string;
  consent_version: string;
}

/** Svar från POST /api/strava/callback. Ingen profildata från Strava skickas vidare till klienten. */
export interface StravaCallbackResponse {
  success: true;
  message: string;
}

/**
 * Svar från GET /api/strava/status. Fälten utöver connected/expired finns bara när kopplingen finns.
 * consent_version är null för kopplingar som gjordes före samtyckesloggen (ADR 010 beslut 12, D4).
 * sync_paused/paused_at ("Pausa synk", ADR 010 beslut 7.5) finns i varje svar med connected: true; paused_at är ISO-tid
 * när pausen började och null när synken är på.
 */
export interface StravaStatusResponse {
  connected: boolean;
  expired: boolean;
  expires_at?: number;
  auto_refreshed?: boolean;
  refresh_failed?: boolean;
  connection_date?: string;
  last_sync?: string | null;
  consent_version?: string | null;
  sync_paused?: boolean;
  paused_at?: string | null;
}

/** Brödtext till PUT /api/strava/sync-paused: exakt det här, inga andra nycklar. */
export interface StravaSyncPausedRequest {
  paused: boolean;
}

/** Svar från PUT /api/strava/sync-paused (ADR 007): läget efter anropet. */
export interface StravaSyncPausedResponse {
  success: true;
  data: {
    sync_paused: boolean;
    paused_at: string | null;
  };
}
