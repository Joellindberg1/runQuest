// API-kontrakt för Strava-kopplingen (nivå 1): GET /api/strava/status och POST /api/strava/callback.
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
}
