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
import { buildSecretAad, kidOfStored, open, parseKeyRing, seal, SecretBoxError, type KeyRing, type SecretAad, type SecretBoxErrorCode } from '../utils/secretBox.js';

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

/** The key id prefix of the environment this process runs in (ADR 013 decision 3: `prod-1`, `stg-1`). */
export type KidPrefix = 'prod-' | 'stg-';

/**
 * Which key ids this process accepts, as a prefix, or null where any id is accepted. Only in production (NODE_ENV=production) is a
 * prefix required: `stg-` when SENTRY_ENVIRONMENT says staging (docs/staging.md gives staging its own value there), `prod-` otherwise,
 * so an unset variable means the strictest rule. That keeps the open test key (`test-1`, vitest.config.ts) and a key of the other
 * environment out of a deployed backend: a test key that opens values lets anyone who can write to the database plant tokens, and a
 * staging key in production (or the reverse) is a mix-up.
 */
export function requiredKidPrefix(env: Readonly<Record<string, string | undefined>> = process.env): KidPrefix | null {
  if (env.NODE_ENV !== 'production') return null;
  return env.SENTRY_ENVIRONMENT?.trim().toLowerCase() === 'staging' ? 'stg-' : 'prod-';
}

/** What is wrong with the key configuration: nothing usable, malformed, or a key id this environment does not accept. */
export type TokenKeyProblem = 'key_missing' | 'key_invalid' | 'kid_not_allowed';

export type TokenKeyConfig =
  | { ok: true; ring: KeyRing }
  | { ok: false; problem: 'key_missing' }
  | { ok: false; problem: 'key_invalid' }
  | { ok: false; problem: 'kid_not_allowed'; ring: KeyRing; requiredPrefix: KidPrefix; offendingKids: string[] };

/**
 * The key configuration as this process would use it, with the reason when it is not usable. Key ids (never key material) are all the
 * answer names. Every key in the ring must carry the environment's prefix, the retired ones too: they open values just as the active one.
 */
export function inspectTokenKeyConfig(): TokenKeyConfig {
  let ring: KeyRing;
  try {
    ring = parseKeyRing();
  } catch (error) {
    return { ok: false, problem: codeOf(error) === 'key_missing' ? 'key_missing' : 'key_invalid' };
  }
  const requiredPrefix = requiredKidPrefix();
  const offendingKids = requiredPrefix ? ring.kids.filter((kid) => !kid.startsWith(requiredPrefix)) : [];
  if (requiredPrefix && offendingKids.length > 0) return { ok: false, problem: 'kid_not_allowed', ring, requiredPrefix, offendingKids };
  return { ok: true, ring };
}

/**
 * Is the key configuration usable? Called before anything is read and, above all, before Strava's token endpoint is called: Strava
 * rotates the refresh token when it answers, so a refresh made without being able to save the answer would lose the connection
 * (ADR 013 decision 5.5). The ring it returns is the one to use for the whole operation. Never throws for a key problem. A key id the
 * environment does not accept (requiredKidPrefix) is `key_invalid`, the same fail-closed answer as a malformed key; the startup alarm
 * says which of the two it is.
 */
export function checkSealingReady(): SealingReadiness {
  const config = inspectTokenKeyConfig();
  if (config.ok) return { ok: true, ring: config.ring };
  return { ok: false, code: config.problem === 'key_missing' ? 'key_missing' : 'key_invalid' };
}

// Token reads that ended in token_unreadable since this process started (the health block's `unreadable_since_start`). A count of
// results, not of users: a poll that meets the same user twice counts twice. It is memory, not a record; a restart starts at zero.
let unreadableCount = 0;

/** One token read ended in `token_unreadable` (stravaClient says so, once per result). */
export function recordUnreadableToken(): void {
  unreadableCount += 1;
}

export function unreadableSinceStart(): number {
  return unreadableCount;
}

/** For tests. */
export function resetUnreadableCount(): void {
  unreadableCount = 0;
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

/** What the token columns of the table look like and whether this process can use its key: the `token_encryption` block of the webhook health. */
export interface TokenEncryptionHealth {
  /** The key configuration is usable and accepted in this environment (checkSealingReady is ok). */
  configured: boolean;
  /** Why not, when it is not. */
  config_error: TokenKeyProblem | null;
  /** The key id writes use. Null when no key could be parsed. */
  active_kid: string | null;
  /** The key ids that only open (TOKEN_ENCRYPTION_KEYS_RETIRED). */
  retired_kids: string[];
  /** Rows whose every stored token column is a well-formed enc:v1 value. */
  encrypted_rows: number;
  /** Rows with a legacy plaintext column and no unrecognised one (until the backfill has run). The invariant after it is 0. */
  plaintext_rows: number;
  /** Rows with a column that is neither: a broken enc: value, or a value of no known shape. */
  unrecognised_rows: number;
  /** Of the encrypted rows, those with a column on a key id other than the active one (a retired key, or one the configuration does not hold). Null without a key. */
  rows_on_other_kid: number | null;
  /** Token reads that ended in token_unreadable since this process started. */
  unreadable_since_start: number;
}

type TokenColumnForm = { form: 'empty' } | { form: 'encrypted'; kid: string } | { form: 'plaintext' } | { form: 'unrecognised' };

function formOfStored(stored: unknown): TokenColumnForm {
  if (stored === null || stored === undefined) return { form: 'empty' };
  if (typeof stored === 'string' && stored.startsWith('enc:')) {
    const kid = kidOfStored(stored);
    return kid ? { form: 'encrypted', kid } : { form: 'unrecognised' };
  }
  return typeof stored === 'string' && LEGACY_PLAINTEXT.test(stored) ? { form: 'plaintext' } : { form: 'unrecognised' };
}

/** PostgREST answers at most 1000 rows per request (the project default); a table larger than that is read in pages of this size. */
const TOKEN_ROWS_PAGE_SIZE = 1000;

/**
 * Every row's token columns, and nothing else (no user id), in pages: one request would silently stop at the server's row limit and
 * the health would undercount. The first page asks for the exact count, so no page is requested past the end (PostgREST answers 416 for
 * that). Ordered by the key so that pages do not overlap. THROWS on a database error.
 */
async function readAllTokenColumns(pageSize: number): Promise<Array<{ access_token: unknown; refresh_token: unknown }>> {
  const rows: Array<{ access_token: unknown; refresh_token: unknown }> = [];
  let total = Infinity;
  for (let from = 0; from < total; from += pageSize) {
    const { data, error, count } = await getSupabaseClient()
      .from(TABLE)
      .select('access_token, refresh_token', { count: 'exact' })
      .order('user_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (typeof count !== 'number') throw Object.assign(new Error('no count'), { code: 'no_count' });
    total = count;
    rows.push(...(data ?? []));
  }
  return rows;
}

/**
 * Counts for the admin health endpoint (ADR 013 decision 9): is the key usable, which key ids, and how many rows are in which form.
 * Every row's token columns are read here, in memory, and only the counts leave: no value, no user id. The rows are classified by shape
 * and by the key id they name; nothing is decrypted, so this says nothing about whether a value opens (`unreadable_since_start` does,
 * for the reads that happened). THROWS on a database error: a health check that says 0 when the read failed lies.
 */
export async function readTokenEncryptionHealth(pageSize: number = TOKEN_ROWS_PAGE_SIZE): Promise<TokenEncryptionHealth> {
  const config = inspectTokenKeyConfig();
  const ring = config.ok || config.problem === 'kid_not_allowed' ? config.ring : null;

  const rows = await readAllTokenColumns(pageSize);

  let encrypted = 0;
  let plaintext = 0;
  let unrecognised = 0;
  let onOtherKid = 0;
  for (const row of rows) {
    const forms = [formOfStored(row.access_token), formOfStored(row.refresh_token)].filter((form) => form.form !== 'empty');
    if (forms.length === 0) continue;
    if (forms.some((form) => form.form === 'unrecognised')) unrecognised += 1;
    else if (forms.some((form) => form.form === 'plaintext')) plaintext += 1;
    else {
      encrypted += 1;
      if (forms.some((form) => form.form === 'encrypted' && form.kid !== ring?.activeKid)) onOtherKid += 1;
    }
  }

  return {
    configured: config.ok,
    config_error: config.ok ? null : config.problem,
    active_kid: ring?.activeKid ?? null,
    retired_kids: ring ? ring.kids.filter((kid) => kid !== ring.activeKid) : [],
    encrypted_rows: encrypted,
    plaintext_rows: plaintext,
    unrecognised_rows: unrecognised,
    rows_on_other_kid: ring ? onOtherKid : null,
    unreadable_since_start: unreadableCount,
  };
}
