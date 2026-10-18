/**
 * Test helpers for token rows (ADR 013): a stored value is `enc:v1:...` or, until the backfill has run, legacy plaintext of the strict
 * shape. The key is the open test key of vitest.config.ts, so these helpers use the same key the code under test reads.
 */
import { buildSecretAad, open, parseKeyRing, seal } from '../utils/secretBox.js';

export type TokenColumn = 'access_token' | 'refresh_token';

const aadFor = (userId: string, column: TokenColumn) => buildSecretAad({ table: 'strava_tokens', column, userId });

/** What the database holds for this plaintext: the value as the code under test seals it. */
export function storedToken(userId: string, column: TokenColumn, plain: string): string {
  return seal(plain, aadFor(userId, column), parseKeyRing());
}

/** Both token columns of a row, encrypted: `{ user_id, ...tokenCols('user-1', 'at', 'rt') }`. */
export function tokenCols(userId: string, access: string, refresh: string): { access_token: string; refresh_token: string } {
  return { access_token: storedToken(userId, 'access_token', access), refresh_token: storedToken(userId, 'refresh_token', refresh) };
}

/** The plaintext behind a stored value. Throws for a value that is not encrypted for this row and column. */
export function plainOfStored(userId: string, column: TokenColumn, stored: string): string {
  return open(stored, aadFor(userId, column), parseKeyRing());
}

/**
 * A legacy plaintext value (the form before the backfill) that passes the strict shape check: `label` padded with zeros to 24 characters.
 * Strava's own tokens are 40 hexadecimal characters; the label keeps a test readable.
 */
export function legacyToken(label: string): string {
  return label.padEnd(24, '0');
}

/**
 * A copy of a token row with both token columns decrypted, for assertions on what was saved. Null columns stay null, and a legacy
 * plaintext column (not `enc:`) stays as it is, so one assertion fits a row before and after a refresh.
 */
export function plainRow<T extends Record<string, any>>(row: T): T {
  const userId = String(row.user_id);
  const decrypted: Record<string, unknown> = { ...row };
  for (const column of ['access_token', 'refresh_token'] as const) {
    if (typeof row[column] === 'string' && row[column].startsWith('enc:')) decrypted[column] = plainOfStored(userId, column, row[column]);
  }
  return decrypted as T;
}

/** A row as the database would hold it after a connection: both tokens encrypted. */
export function encryptedRow<T extends Record<string, any>>(row: T & { user_id: string }, plain: { access?: string | null; refresh?: string | null }): T {
  return {
    ...row,
    access_token: plain.access == null ? null : storedToken(row.user_id, 'access_token', plain.access),
    refresh_token: plain.refresh == null ? null : storedToken(row.user_id, 'refresh_token', plain.refresh),
  };
}
