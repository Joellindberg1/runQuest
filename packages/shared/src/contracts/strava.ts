// API-kontrakt för Strava-kopplingen (nivå 1): GET /api/strava/config, GET /api/strava/status, POST /api/strava/callback, PUT /api/strava/sync-paused,
// DELETE /api/strava/disconnect, POST /api/strava/sync, de två adminrutterna (backfill-extended och sync-all) och GET /api/strava/webhook/health.
// Stravas eget protokoll (GET och POST /api/strava/webhook) bestäms av Strava och har ingen kontraktstyp här.
// Endast typer och konstanter. Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20): `success` och `data` ligger bredvid de gamla nycklarna (dubbelsvar, DualEnvelope)
// tills steg 2 (RUN-364) tar bort dem.
import { DATA_POLICY_VERSION } from '../legal/dataPolicy.js';
import type { ApiSuccess, DualEnvelope } from './common.js';

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

/** Svar från POST /api/strava/callback: `{ success, message, data: null }`. Ingen profildata från Strava skickas vidare till klienten. Saknat samtycke är 400 `consent_required`. */
export type StravaCallbackResponse = DualEnvelope<{ message: string }, null>;

/**
 * Svar från GET /api/strava/status. Fälten utöver connected/expired finns bara när kopplingen finns.
 * consent_version är null för kopplingar som gjordes före samtyckesloggen (ADR 010 beslut 12, D4).
 * sync_paused/paused_at ("Pausa synk", ADR 010 beslut 7.5) finns i varje svar med connected: true; paused_at är ISO-tid
 * när pausen började och null när synken är på. PostgREST ger tiden som `…+00:00`, inte `…Z`: tolka den med `new Date(...)`
 * och jämför aldrig strängar.
 */
export interface StravaStatus {
  connected: boolean;
  expired: boolean;
  expires_at?: number;
  auto_refreshed?: boolean;
  refresh_failed?: boolean;
  connection_date?: string;
  /** När användarens senaste Strava-runda kom in (runs.created_at, webhook eller polling), per användare. null = ingen än eller läsfel. */
  last_import_at?: string | null;
  consent_version?: string | null;
  sync_paused?: boolean;
  paused_at?: string | null;
}

/** Svar från GET /api/strava/status: statusfälten på toppnivå (gammal klient) och i `data` (ny klient). */
export type StravaStatusResponse = DualEnvelope<StravaStatus>;

/** Svar från GET /api/strava/config (publik, ingen JWT): Strava-appens client_id, som klienten behöver för att öppna auktoriseringsfönstret. */
export type StravaConfigResponse = DualEnvelope<{ client_id: string }>;

/** Svar från DELETE /api/strava/disconnect (ADR 010 beslut 7.4): kopplingen är återkallad och Stravarundorna raderade. Idempotent. */
export type StravaDisconnectResponse = DualEnvelope<{ message: string }, null>;

/** Svar från POST /api/strava/sync: antalet nya rundor och aktiviteter som hämtades. 409 om synken är pausad, 503 om tokennyckeln inte går att använda. */
export type StravaSyncResponse = DualEnvelope<{ message: string; newRuns: number; totalActivities: number }, { newRuns: number; totalActivities: number }>;

/** En rad per användare i summeringen av POST /api/strava/backfill-extended; `error` är satt när användarens backfill föll. */
export interface StravaBackfillUserResult {
  user: string;
  updated: number;
  error?: string;
}

/** Svar från POST /api/strava/backfill-extended (admin) när det fanns kopplade användare. */
export type StravaBackfillDoneResponse = DualEnvelope<{ totalUpdated: number; summary: StravaBackfillUserResult[] }>;

/** Svar från POST /api/strava/backfill-extended (admin) när ingen användare är kopplad (eller kopplingarna inte gick att läsa): inget gjordes. */
export type StravaBackfillNoUsersResponse = DualEnvelope<{ message: string; updated: 0 }, { updated: 0 }>;

export type StravaBackfillExtendedResponse = StravaBackfillDoneResponse | StravaBackfillNoUsersResponse;

/** Resultatet för en användare i en synk av alla (GET /api/strava/sync-all). */
export interface StravaSyncAllUserResult {
  userId: string;
  userName: string;
  newRuns?: number;
  totalActivities?: number;
  error?: string;
}

/**
 * Det synkjobbet själv returnerar (och schedulern läser). `unavailable` är satt när tokennyckeln saknas eller nekas (ADR 013): hela körningen hoppades över och
 * ingen användare provades. Routen svarar då 503 `strava_unavailable` i stället. Inte ett HTTP-svar: se `StravaSyncAllResponse`.
 */
export interface StravaSyncAllResult {
  success: boolean;
  message: string;
  syncedUsers: number;
  totalUsers: number;
  totalNewRuns: number;
  results: StravaSyncAllUserResult[];
  unavailable?: true;
}

/** Svar från GET /api/strava/sync-all (admin): räknarna på toppnivå (gammal klient) och i `data` (ny klient), vid en körning som gjordes. */
export type StravaSyncAllResponse = DualEnvelope<
  Pick<StravaSyncAllResult, 'message' | 'syncedUsers' | 'totalUsers' | 'totalNewRuns' | 'results'>,
  Pick<StravaSyncAllResult, 'syncedUsers' | 'totalUsers' | 'totalNewRuns' | 'results'>
>;

/** Varför tokennyckeln inte går att använda (ADR 013). */
export type StravaTokenKeyProblem = 'key_missing' | 'key_invalid' | 'kid_not_allowed';

/** Tokennyckelns skick och tokenraderna efter form: blocket `token_encryption` i webhookens hälsa (ADR 013 beslut 9). Bara antal och nyckel-id, aldrig värden. */
export interface StravaTokenEncryptionHealth {
  /** Nyckelkonfigurationen går att använda och godtas i den här miljön (checkSealingReady är ok). */
  configured: boolean;
  /** Varför inte, när den inte går att använda. */
  config_error: StravaTokenKeyProblem | null;
  /** Nyckel-id som skrivningar använder. Null när ingen nyckel gick att tolka. */
  active_kid: string | null;
  /** Nyckel-id som bara öppnar (TOKEN_ENCRYPTION_KEYS_RETIRED). */
  retired_kids: string[];
  /** Rader där varje lagrad tokenkolumn är ett välformat enc:v1-värde. */
  encrypted_rows: number;
  /** Rader med en gammal klartextkolumn och ingen oigenkänd (tills backfillen körts). Invarianten efteråt är 0. */
  plaintext_rows: number;
  /** Rader med en kolumn som varken är krypterad eller klartext: ett trasigt enc:-värde eller ett värde utan känd form. */
  unrecognised_rows: number;
  /** Av de krypterade raderna, de med en kolumn på ett annat nyckel-id än det aktiva. Null utan nyckel. */
  rows_on_other_kid: number | null;
  /** Tokenläsningar som slutade i token_unreadable sedan processen startade. */
  unreadable_since_start: number;
}

/** Webhookkön i siffror (ADR 010 beslut 11) plus tokenkrypteringen. Räknare och två tidpunkter, inget annat: aldrig ägare, objekt, användare eller token. */
export interface StravaWebhookHealth {
  subscription_configured: boolean;
  pending: number;
  processing: number;
  dead: number;
  /** Hela sekunder sedan den äldsta väntande händelsen togs emot, eller null när inget väntar. */
  oldest_pending_age_seconds: number | null;
  /** Senaste processed_at (en händelse som slutade död räknas också), som ISO-sträng, eller null. */
  last_processed_at: string | null;
  /** Kopplingar utan strava_athlete_id: webhookhändelser för dem kan inte knytas till någon. */
  unmapped_tokens: number;
  paused_users: number;
  token_encryption: StravaTokenEncryptionHealth;
}

/** Svar från GET /api/strava/webhook/health (admin). */
export type StravaWebhookHealthResponse = ApiSuccess<StravaWebhookHealth>;

/** Brödtext till PUT /api/strava/sync-paused: exakt det här, inga andra nycklar. */
export interface StravaSyncPausedRequest {
  paused: boolean;
}

/** Svar från PUT /api/strava/sync-paused (ADR 007): läget efter anropet. */
export type StravaSyncPausedResponse = ApiSuccess<{
  sync_paused: boolean;
  paused_at: string | null;
}>;
