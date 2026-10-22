/**
 * The Strava token store (ADR 013 decisions 2, 4, 5, 6 and 9): the one place that encrypts and decrypts Strava tokens, and the one place
 * that reads or writes the token columns of `strava_tokens` (access_token, refresh_token). Everything else asks this module.
 *
 * A stored value is `enc:v1:...` (utils/secretBox.ts, bound to the table, column and user). Writing is always encrypted; there is no
 * path and no switch that writes plaintext, and the database refuses it too (the CHECK constraint of migration 060). Reading has no
 * plaintext branch either: a value that does not start with `enc:` is `legacy_shape`, which is `token_unreadable` to the callers.
 *
 * A token that cannot be read is NEVER evidence that Strava withdrew the authorisation. `openStravaToken` says why in a code (the
 * `SecretBoxError` codes plus `legacy_shape`) and the callers turn it into `token_unreadable`, which nobody may read as "revoked": a
 * wrong reading lets a forged deauthorize event delete a user's runs (ADR 010 7.4.3, ADR 013 decision 9). The codes are for logs only;
 * nothing here puts a token, a stored value or key material into an error or a log line.
 */
import type { StravaTokenEncryptionHealth } from '@runquest/shared';
import { getSupabaseClient } from '../config/database.js';
import { buildSecretAad, kidOfStored, open, parseKeyRing, seal, SecretBoxError, type KeyRing, type SecretAad, type SecretBoxErrorCode } from '../utils/secretBox.js';

const TABLE = 'strava_tokens';

export type StravaTokenColumn = 'access_token' | 'refresh_token';

/** Why a stored token could not be read: the secretBox codes, plus `legacy_shape` for any value that does not start with `enc:` (an old plaintext token, or anything else). */
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

// The shape a plaintext Strava token had before the encryption (ADR 013 decision 6). Strava's tokens are 40 hexadecimal characters; this is
// wider but has no `:`, so nothing that looks like a broken ciphertext matches. It is used ONLY to tell a stored plaintext value from a value of
// no known shape (the health counts and the backfill report); it never makes a value readable.
const PLAINTEXT_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

export type OpenedToken = { ok: true; token: string } | { ok: false; code: TokenUnreadableCode };

/**
 * The plaintext behind a stored value. Never throws.
 *   - `enc:...`: decrypted; a failure is the secretBox code (`bad_format`, `unknown_key_id`, `auth_failed`, ...).
 *   - anything else, an old plaintext token included: `legacy_shape`. It is not sent to Strava as if it were a token, not logged, not
 *     rewritten and not deleted; to the callers it is `token_unreadable`, never "revoked" (ADR 013 decisions 8 and 9).
 */
export function openStravaToken(userId: string, column: StravaTokenColumn, stored: unknown, ring: KeyRing): OpenedToken {
  if (typeof stored !== 'string' || !stored.startsWith('enc:')) return { ok: false, code: 'legacy_shape' };
  try {
    return { ok: true, token: open(stored, aadFor(userId, column), ring) };
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
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

/**
 * What a stored column holds, by shape alone (nothing is decrypted): no value, `enc:v1` under a key id, plaintext, or neither. A `plaintext`
 * column is a finding and not a readable token: the reader gives `legacy_shape` for it, and migration 060 keeps new ones out.
 */
export type TokenColumnForm = { form: 'empty' } | { form: 'encrypted'; kid: string } | { form: 'plaintext' } | { form: 'unrecognised' };

function formOfStored(stored: unknown): TokenColumnForm {
  if (stored === null || stored === undefined) return { form: 'empty' };
  if (typeof stored === 'string' && stored.startsWith('enc:')) {
    const kid = kidOfStored(stored);
    return kid ? { form: 'encrypted', kid } : { form: 'unrecognised' };
  }
  return typeof stored === 'string' && PLAINTEXT_SHAPE.test(stored) ? { form: 'plaintext' } : { form: 'unrecognised' };
}

/** PostgREST answers at most 1000 rows per request (the project default); a table larger than that is read in pages of this size. */
const TOKEN_ROWS_PAGE_SIZE = 1000;

/**
 * The named columns of every row, in pages: one request would silently stop at the server's row limit and the answer would undercount.
 * The first page asks for the exact count, so no page is requested past the end (PostgREST answers 416 for that). Ordered by the key so
 * that pages do not overlap. THROWS on a database error.
 */
async function readAllRows<T>(columns: string, pageSize: number): Promise<T[]> {
  const rows: T[] = [];
  let total = Infinity;
  for (let from = 0; from < total; from += pageSize) {
    const { data, error, count } = await getSupabaseClient()
      .from(TABLE)
      .select(columns, { count: 'exact' })
      .order('user_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (typeof count !== 'number') throw Object.assign(new Error('no count'), { code: 'no_count' });
    total = count;
    rows.push(...((data ?? []) as unknown as T[]));
  }
  return rows;
}

/** Every row's token columns, and nothing else (no user id): the health counts need no more. */
const readAllTokenColumns = (pageSize: number) => readAllRows<{ access_token: unknown; refresh_token: unknown }>('access_token, refresh_token', pageSize);

/**
 * Counts for the admin health endpoint (ADR 013 decision 9): is the key usable, which key ids, and how many rows are in which form.
 * Every row's token columns are read here, in memory, and only the counts leave: no value, no user id. The rows are classified by shape
 * and by the key id they name; nothing is decrypted, so this says nothing about whether a value opens (`unreadable_since_start` does,
 * for the reads that happened). THROWS on a database error: a health check that says 0 when the read failed lies.
 */
export async function readTokenEncryptionHealth(pageSize: number = TOKEN_ROWS_PAGE_SIZE): Promise<StravaTokenEncryptionHealth> {
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

// ─── Rewriting whole rows: the backfill (ADR 013 decision 7) ────────────────────────────────────────────────────────────────────────
//
// The backfill script moves every row to the active key (or, as the emergency exit, back to plaintext). The plaintext of a token is only
// ever a local variable in this section; the script gets forms, codes and counts, so it has nothing to print by accident.

// The stored strings of a listed row live here, not on the object, so a row cannot print or serialise them by accident (the KeyRing way).
const listedStrings = new WeakMap<ListedTokenRow, { accessRaw: string | null; refreshRaw: string | null }>();

/** A row as listed: who, and the form of each token column. The stored strings are inside; only `rewriteTokenRow` can use them. */
export class ListedTokenRow {
  readonly userId: string;
  readonly access: TokenColumnForm;
  readonly refresh: TokenColumnForm;

  constructor(userId: string, accessRaw: unknown, refreshRaw: unknown) {
    this.userId = userId;
    this.access = formOfStored(accessRaw);
    this.refresh = formOfStored(refreshRaw);
    // A column that is not a string is `unrecognised` and is never written, so it needs no stored string.
    listedStrings.set(this, {
      accessRaw: typeof accessRaw === 'string' ? accessRaw : null,
      refreshRaw: typeof refreshRaw === 'string' ? refreshRaw : null,
    });
  }

  toJSON(): { userId: string; access: TokenColumnForm; refresh: TokenColumnForm } {
    return { userId: this.userId, access: this.access, refresh: this.refresh };
  }
}

/** Every token row, in pages, as `ListedTokenRow`s. THROWS on a database error: a failed listing is never an empty table. */
export async function listTokenRows(pageSize: number = TOKEN_ROWS_PAGE_SIZE): Promise<ListedTokenRow[]> {
  const rows = await readAllRows<{ user_id: string; access_token: unknown; refresh_token: unknown }>('user_id, access_token, refresh_token', pageSize);
  return rows.map((row) => new ListedTokenRow(row.user_id, row.access_token, row.refresh_token));
}

/** The shape a plaintext token must have to be listed as one (not `unrecognised`) after `--decrypt` has written it; the emergency exit writes nothing else. */
export const isPlaintextShape = (value: string): boolean => PLAINTEXT_SHAPE.test(value);

export type TokenRewriteMode = 'encrypt' | 'decrypt';

/**
 * Why a row was not rewritten or not verified. The first group are the codes of `openStravaToken`/secretBox (the value or the key);
 * `unrecognised` is a column of no known shape; `plaintext_shape` (decrypt) a token the reader would not take for plaintext;
 * `roundtrip_failed` a sealing that did not open to its own input; `write_failed` a database error on the write; `check_violation` the
 * database refused the value (while migration 060 holds, that is every plaintext write of `--decrypt`); `verify_read_failed`
 * a read-back that failed; `verify_failed` a stored value that does not open after the write. None carries a value.
 */
export type TokenRewriteFailure =
  | TokenUnreadableCode
  | 'unrecognised'
  | 'plaintext_shape'
  | 'roundtrip_failed'
  | 'write_failed'
  | 'check_violation'
  | 'verify_read_failed'
  | 'verify_failed';

/** SQLSTATE of a CHECK violation: what the database answers when the encrypted-tokens constraint (migration 060) refuses a plaintext write. */
const CHECK_VIOLATION = '23514';

export type TokenRewriteOutcome =
  | { status: 'nothing_to_do' }
  /** Dry run: the rewrite is possible and the round trip holds in memory. Nothing was written. */
  | { status: 'ready' }
  /** Written, read back and opened to the same plaintext. */
  | { status: 'written' }
  /** No row held both stored strings the listing saw (a refresh landed, the user reconnected or disconnected). Nothing was written. */
  | { status: 'conflict' }
  /** Written, but the row held something else readable when read back (a refresh landed right after). */
  | { status: 'superseded' }
  | { status: 'failed'; code: TokenRewriteFailure; column?: StravaTokenColumn };

const TOKEN_COLUMNS: readonly StravaTokenColumn[] = ['access_token', 'refresh_token'];

type RewritePlan =
  | { ok: true; changes: Partial<Record<StravaTokenColumn, string>>; plains: Partial<Record<StravaTokenColumn, string>> }
  | { ok: false; failure: TokenRewriteOutcome };

const failedOutcome = (code: TokenRewriteFailure, column?: StravaTokenColumn): TokenRewriteOutcome =>
  column ? { status: 'failed', code, column } : { status: 'failed', code };

/** Decides, for every column, what the row should hold, working it out entirely in memory (including the sealing round trip). */
function planRewrite(row: ListedTokenRow, strings: { accessRaw: string | null; refreshRaw: string | null }, mode: TokenRewriteMode, ring: KeyRing): RewritePlan {
  const changes: Partial<Record<StravaTokenColumn, string>> = {};
  const plains: Partial<Record<StravaTokenColumn, string>> = {};
  for (const column of TOKEN_COLUMNS) {
    const form = column === 'access_token' ? row.access : row.refresh;
    const stored = column === 'access_token' ? strings.accessRaw : strings.refreshRaw;
    if (form.form === 'empty') continue;
    if (form.form === 'unrecognised' || stored === null) return { ok: false, failure: failedOutcome('unrecognised', column) };

    if (mode === 'encrypt') {
      if (form.form === 'encrypted' && form.kid === ring.activeKid) {
        // Not rewritten, but it must open: a ciphertext that belongs to another row, or was damaged, is a finding and not "done".
        const check = openStravaToken(row.userId, column, stored, ring);
        if (!check.ok) return { ok: false, failure: failedOutcome(check.code, column) };
        continue;
      }
      let plain = stored;
      if (form.form === 'encrypted') {
        const opened = openStravaToken(row.userId, column, stored, ring);
        if (!opened.ok) return { ok: false, failure: failedOutcome(opened.code, column) };
        plain = opened.token;
      }
      let sealed: string;
      try {
        sealed = sealStravaToken(row.userId, column, plain, ring);
      } catch (error) {
        return { ok: false, failure: failedOutcome(codeOf(error), column) };
      }
      // The sealing must open to its own input before anything is written.
      const back = openStravaToken(row.userId, column, sealed, ring);
      if (!back.ok || back.token !== plain) return { ok: false, failure: failedOutcome('roundtrip_failed', column) };
      changes[column] = sealed;
      plains[column] = plain;
    } else {
      if (form.form === 'plaintext') continue;
      const opened = openStravaToken(row.userId, column, stored, ring);
      if (!opened.ok) return { ok: false, failure: failedOutcome(opened.code, column) };
      if (!isPlaintextShape(opened.token)) return { ok: false, failure: failedOutcome('plaintext_shape', column) };
      changes[column] = opened.token;
      plains[column] = opened.token;
    }
  }
  return { ok: true, changes, plains };
}

/**
 * Can this stored value be read with the ring? An empty column and an encrypted value that opens can. A plaintext value cannot, as the
 * reader sees it; it counts as readable only where plaintext is what the run is writing (`decrypt`, the emergency exit).
 */
function isReadable(userId: string, column: StravaTokenColumn, stored: unknown, ring: KeyRing, plaintextIsExpected: boolean): boolean {
  const form = formOfStored(stored);
  if (form.form === 'empty') return true;
  if (form.form === 'plaintext') return plaintextIsExpected;
  if (form.form === 'unrecognised' || typeof stored !== 'string') return false;
  try {
    open(stored, aadFor(userId, column), ring);
    return true;
  } catch (error) {
    codeOf(error); // only a SecretBoxError means "cannot be read"; anything else is a bug and goes on
    return false;
  }
}

/**
 * Rewrites one listed row (ADR 013 decision 7):
 *   - `encrypt`: every column that is plaintext or on a key id other than the active one is sealed under the active key
 *     (a column already on the active key is left as it is);
 *   - `decrypt`: every encrypted column is written back as plaintext, the emergency exit before a rollback to code that reads no `enc:`.
 * The new strings are worked out and proved in memory first. The write is a compare-and-swap on BOTH stored strings the listing saw
 * (`null` matches `is null`), so a refresh that landed since, a reconnect or a disconnect is never overwritten; that is `conflict` and
 * the row is left for the next run. After the write the row is read back and each written column is checked. `dryRun` stops after the
 * in-memory proof. Does not throw for a row or a database problem; the answer is a status and a code, never a value.
 */
export async function rewriteTokenRow(row: ListedTokenRow, mode: TokenRewriteMode, ring: KeyRing, options: { dryRun: boolean }): Promise<TokenRewriteOutcome> {
  const strings = listedStrings.get(row);
  if (!strings) throw new Error('rewriteTokenRow needs a row from listTokenRows');

  const plan = planRewrite(row, strings, mode, ring);
  if (!plan.ok) return plan.failure;
  const { changes, plains } = plan;
  if (Object.keys(changes).length === 0) return { status: 'nothing_to_do' };
  if (options.dryRun) return { status: 'ready' };

  let query = getSupabaseClient().from(TABLE).update(changes).eq('user_id', row.userId);
  query = strings.accessRaw === null ? query.is('access_token', null) : query.eq('access_token', strings.accessRaw);
  query = strings.refreshRaw === null ? query.is('refresh_token', null) : query.eq('refresh_token', strings.refreshRaw);
  const { data, error } = await query.select('user_id');
  if (error) return failedOutcome((error as { code?: unknown }).code === CHECK_VIOLATION ? 'check_violation' : 'write_failed');
  if (!Array.isArray(data) || data.length === 0) return { status: 'conflict' };

  let now: StoredTokenRow | null;
  try {
    now = await readStoredTokenRow(row.userId);
  } catch {
    return failedOutcome('verify_read_failed');
  }
  if (!now) return { status: 'superseded' }; // disconnected right after the write

  const expected = { access: changes.access_token ?? strings.accessRaw, refresh: changes.refresh_token ?? strings.refreshRaw };
  if (now.accessRaw === expected.access && now.refreshRaw === expected.refresh) {
    // Exactly what we wrote: every column we wrote must open to the plaintext it was made from.
    for (const column of TOKEN_COLUMNS) {
      const plain = plains[column];
      if (plain === undefined) continue;
      const stored = column === 'access_token' ? now.accessRaw : now.refreshRaw;
      const back = mode === 'encrypt' ? openStravaToken(row.userId, column, stored, ring) : { ok: true as const, token: stored };
      if (!back.ok || back.token !== plain) return failedOutcome('verify_failed', column);
    }
    return { status: 'written' };
  }

  // Something else is stored now. Readable: a refresh landed after our write. Not readable: the write damaged the row.
  for (const column of TOKEN_COLUMNS) {
    if (!isReadable(row.userId, column, column === 'access_token' ? now.accessRaw : now.refreshRaw, ring, mode === 'decrypt')) return failedOutcome('verify_failed', column);
  }
  return { status: 'superseded' };
}
