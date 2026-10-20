// Felkoder för API-svar (ADR 007 Addendum 2026-10-20, punkt 3). Backend och frontend importerar samma lista.
//
// En kod beskriver UTFALLET för anroparen, aldrig orsaken: databaskoder (PGRST116), nätverkskoder (ECONNRESET), Stravas statusar (strava_401) och
// interna etiketter (seam_timeout) bor i loggar och Sentry och skickas aldrig till klienten. Katalogen är bara additiv: en kod byter aldrig
// betydelse och återanvänds aldrig, och en ny kod är en granskad diff i testet som fäster listan (`apiErrorCodes.test.ts`), i samma ändring som dess första användning.
//
// Format: snake_case, `[a-z][a-z0-9_]*`, högst 40 tecken, engelska ord.
// En specifik kod finns bara när klienten grenar på den, när en fritextjämförelse fanns i dag eller när supporten vill räkna den (punkt 3).
// Övriga fel använder standardkoden för sin status (`defaultErrorCode` i backendens utils/respond.ts).

export const API_ERROR_CODES = [
  // 400
  'invalid_request',
  'invalid_json',
  'consent_required',
  'strava_not_connected',
  'strava_authorization_failed',
  'strava_sync_failed',
  // 401
  'unauthorized',
  'token_invalid',
  'invalid_credentials',
  'current_password_incorrect',
  // 403
  'forbidden',
  'admin_required',
  'group_required',
  // 404
  'not_found',
  'route_not_found',
  'invalid_invite_code',
  // 409
  'conflict',
  'sync_paused',
  'strava_read_only',
  'run_qualified_event',
  'already_in_group',
  'strava_account_in_use',
  'user_exists',
  // 413, 415, 429
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  // 500, 503
  'internal_error',
  'recalc_failed_after_write',
  'service_unavailable',
  'strava_unavailable',
  // 207
  'partial_failure',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Är texten en kod i katalogen? Klienten använder den för att behandla en okänd kod (en nyare server) som statusens klass i stället för ett fel i sig. */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}
