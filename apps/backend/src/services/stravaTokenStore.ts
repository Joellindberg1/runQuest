/**
 * The Strava token store (ADR 013 decisions 2, 4, 5, 6 and 9): the one place that encrypts and decrypts Strava tokens, and the one place
 * that reads or writes the token columns of `strava_tokens` (access_token, refresh_token). Everything else asks this module.
 *
 * A stored value is `enc:v1:...` (utils/secretBox.ts, bound to the table, column and user) or, until the backfill has run, legacy
 * plaintext of one strict shape. Writing is always encrypted; there is no path and no switch that writes plaintext.
 *
 * A token that cannot be read is NEVER evidence that Strava withdrew the authorisation. `openStravaToken` says why in a code (the
 * `SecretBoxError` codes plus `legacy_shape`) and the callers turn it into `token_unreadable`, which nobody may read as "revoked": a
 * wrong reading lets a forged deauthorize event delete a user's runs (ADR 010 7.4.3, ADR 013 decision 9). The codes are for logs only;
 * nothing here puts a token, a stored value or key material into an error or a log line.
 */
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { buildSecretAad, open, parseKeyRing, seal, SecretBoxError, type KeyRing, type SecretAad, type SecretBoxErrorCode } from '../utils/secretBox.js';

const TABLE = 'strava_tokens';

export type StravaTokenColumn = 'access_token' | 'refresh_token';

/** Why a stored token could not be read: the secretBox codes, plus `legacy_shape` for a value that is neither `enc:` nor a plausible plaintext token. */
export type TokenUnreadableCode = SecretBoxErrorCode | 'legacy_shape';

const aadFor = (userId: string, column: StravaTokenColumn): SecretAad => buildSecretAad({ table: TABLE, column, userId });

/** The error code of a failure from secretBox. Anything else is a bug and is thrown on, not hidden behind a code. */
function codeOf(error: unknown): SecretBoxErrorCode {
  if (error instanceof SecretBoxError) return error.code;
  throw error;
}

export type SealingReadiness = { ok: true; ring: KeyRing } | { ok: false; code: TokenUnreadableCode };

/**
 * Is the key configuration usable? Called before anything is read and, above all, before Strava's token endpoint is called: Strava
 * rotates the refresh token when it answers, so a refresh made without being able to save the answer would lose the connection
 * (ADR 013 decision 5.5). The ring it returns is the one to use for the whole operation. Never throws for a key problem.
 */
export function checkSealingReady(): SealingReadiness {
  try {
    return { ok: true, ring: parseKeyRing() };
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
}

/** Encrypts a token for its row and column. Throws a `SecretBoxError` (key or input problem). */
export function sealStravaToken(userId: string, column: StravaTokenColumn, plain: string, ring: KeyRing): string {
  return seal(plain, aadFor(userId, column), ring);
}

export interface SealedTokenPair {
  access_token: string;
  refresh_token: string;
}

/** Both tokens of a connection, encrypted once. Reuse the result for a retry: a second sealing is a different string. */
export function sealStravaTokenPair(userId: string, tokens: { accessToken: string; refreshToken: string }, ring: KeyRing): SealedTokenPair {
  return {
    access_token: sealStravaToken(userId, 'access_token', tokens.accessToken, ring),
    refresh_token: sealStravaToken(userId, 'refresh_token', tokens.refreshToken, ring),
  };
}

// The legacy shape of ADR 013 decision 6. Strava's tokens are 40 hexadecimal characters; this is wider but has no `:`, so nothing that
// looks like a broken ciphertext passes for a token.
const LEGACY_PLAINTEXT = /^[A-Za-z0-9_-]{20,128}$/;

// One warning per process and user (the user ids of a handful of connections), never the value.
const warnedAboutLegacy = new Set<string>();

/** For tests: the warning is once per process, so a test that counts warnings starts from here. */
export function resetLegacyTokenWarnings(): void {
  warnedAboutLegacy.clear();
}

export type OpenedToken = { ok: true; token: string; legacy: boolean } | { ok: false; code: TokenUnreadableCode };

/**
 * The plaintext behind a stored value. Never throws.
 *   - `enc:...`: decrypted; a failure is the secretBox code (`bad_format`, `unknown_key_id`, `auth_failed`, ...). It is never read as plaintext.
 *   - the strict legacy shape: used as it is (and warned about once per user), until the backfill and S7 remove this branch.
 *   - anything else: `legacy_shape`. It is not sent to Strava as if it were a token.
 */
export function openStravaToken(userId: string, column: StravaTokenColumn, stored: unknown, ring: KeyRing): OpenedToken {
  if (typeof stored === 'string' && stored.startsWith('enc:')) {
    try {
      return { ok: true, token: open(stored, aadFor(userId, column), ring), legacy: false };
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    }
  }
  if (typeof stored === 'string' && LEGACY_PLAINTEXT.test(stored)) {
    if (!warnedAboutLegacy.has(userId)) {
      warnedAboutLegacy.add(userId);
      logger.warn(`⚠️ Strava legacy plaintext token read for user ${userId} (legacy plaintext token read)`);
    }
    return { ok: true, token: stored, legacy: true };
  }
  return { ok: false, code: 'legacy_shape' };
}

/** The user's connection as stored: the token columns as the raw strings the database holds, and the connection state. */
export interface StoredTokenRow {
  /** The exact stored string; a compare-and-swap is on this, never on a plaintext. null when the column is empty. */
  accessRaw: string | null;
  refreshRaw: string | null;
  /** Epoch seconds as stored. */
  expiresAt: number | null;
  connectionDate: string | null;
  /** null for connections made before the consent log (ADR 010 decision 12). */
  consentVersion: string | null;
}

/**
 * The user's token row, or null when there is none (maybeSingle: a missing row is data null WITHOUT an error, so a read that failed can
 * be told apart from "not connected"). THROWS on a database error: a caller must never take a failed read for "not connected".
 */
export async function readStoredTokenRow(userId: string): Promise<StoredTokenRow | null> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('access_token, refresh_token, expires_at, connection_date, consent_version')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    accessRaw: data.access_token ?? null,
    refreshRaw: data.refresh_token ?? null,
    expiresAt: data.expires_at ?? null,
    connectionDate: data.connection_date ?? null,
    consentVersion: data.consent_version ?? null,
  };
}

/**
 * Saves the tokens of a refresh, compare-and-swap on the STORED refresh string (ADR 013 decision 5): the row is only ours to change while
 * it still holds exactly what the refresh started from. A reconnect (a new row) or a disconnect that happened meanwhile is not overwritten
 * or brought back. `saved` is false when no row matched; `error` is the database error, if any.
 */
export async function saveRotatedTokens(
  userId: string,
  expectedRefreshRaw: string,
  sealed: SealedTokenPair,
  expiresAt: number,
): Promise<{ error: unknown; saved: boolean }> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .update({ access_token: sealed.access_token, refresh_token: sealed.refresh_token, expires_at: expiresAt })
    .eq('user_id', userId)
    .eq('refresh_token', expectedRefreshRaw)
    .select('user_id');
  if (error) return { error, saved: false };
  return { error: null, saved: Array.isArray(data) && data.length > 0 };
}

/**
 * Whether the user's row holds exactly this refresh token. Compares plaintexts: the same token sealed twice is two different strings.
 * A read or a decryption that fails is "no", the same as a failed read always was: the save then counts as not done.
 */
export async function storedRefreshTokenEquals(userId: string, expectedPlain: string, ring: KeyRing): Promise<boolean> {
  try {
    const row = await readStoredTokenRow(userId);
    if (!row) return false;
    const opened = openStravaToken(userId, 'refresh_token', row.refreshRaw, ring);
    return opened.ok && opened.token === expectedPlain;
  } catch {
    return false;
  }
}

/** Columns of a connection other than the tokens; the token columns are the store's alone. */
export type ConnectionColumns = Record<string, unknown> & { access_token?: never; refresh_token?: never; user_id?: never; expires_at?: never };

/**
 * Creates or replaces the user's connection (the OAuth callback). The tokens are encrypted here; `columns` carries everything else.
 * Throws a `SecretBoxError` if the tokens cannot be sealed (the callback checks the key first, before it exchanges the code).
 */
export async function upsertStravaConnection(
  userId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number },
  columns: ConnectionColumns,
  ring: KeyRing,
): Promise<{ error: { code?: string; message?: string; details?: string } | null }> {
  const sealed = sealStravaTokenPair(userId, tokens, ring);
  const { error } = await getSupabaseClient()
    .from(TABLE)
    .upsert({ user_id: userId, ...sealed, expires_at: tokens.expiresAt, ...columns });
  return { error };
}
