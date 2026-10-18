/**
 * Encryption of secret values at rest (ADR 013 decisions 2, 3, 9 and 10): AES-256-GCM through node:crypto, no dependency.
 *
 * Stored form: `enc:v1:<kid>:<iv>:<ciphertext>:<tag>`. `kid` names the key, `iv` is 12 random bytes (new for every seal), and iv,
 * ciphertext and tag (16 bytes) are base64url without padding. The AAD binds a value to where it lives (table, column and user_id), so a
 * ciphertext moved to another row or column fails authentication.
 *
 * Keys come from the environment when `parseKeyRing` is called, never when this module is loaded:
 *   TOKEN_ENCRYPTION_KEY=<kid>:<base64 of 32 bytes>                 the active key, used for every seal
 *   TOKEN_ENCRYPTION_KEYS_RETIRED=<kid>:<base64>[,<kid>:<base64>]   optional, open only (rotation)
 * A missing or invalid configuration throws (fail-closed); there is no fallback to plaintext.
 *
 * Nothing here ever puts key material, plaintext or stored values into an error: a `SecretBoxError` carries a code and a fixed message,
 * and the exceptions from node:crypto (which can echo input) are caught and replaced by the code. That keeps keys out of logs and Sentry.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ACTIVE_KEY_ENV = 'TOKEN_ENCRYPTION_KEY';
export const RETIRED_KEYS_ENV = 'TOKEN_ENCRYPTION_KEYS_RETIRED';

/** The only detail a failure carries. The first five are the internal causes of ADR 013 decision 9; `bad_aad` is a caller bug (never data). */
export const SECRET_BOX_ERROR_CODES = ['key_missing', 'key_invalid', 'unknown_key_id', 'bad_format', 'auth_failed', 'bad_aad'] as const;
export type SecretBoxErrorCode = (typeof SECRET_BOX_ERROR_CODES)[number];

export class SecretBoxError extends Error {
  readonly code: SecretBoxErrorCode;

  constructor(code: SecretBoxErrorCode) {
    super(`secretBox: ${code}`);
    this.name = 'SecretBoxError';
    this.code = code;
  }
}

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'enc:v1';
const KID_PATTERN = /^[a-z0-9][a-z0-9-]{0,15}$/;
const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

// The key bytes live here, not on the ring object, so the ring cannot print or serialise them by accident.
const keyBytes = new WeakMap<KeyRing, ReadonlyMap<string, Buffer>>();

/** The configured keys. Prints and serialises as key ids only. */
export class KeyRing {
  /** The kid every seal uses. */
  readonly activeKid: string;
  /** Every kid the ring can open, the active one first. */
  readonly kids: readonly string[];

  constructor(keys: ReadonlyMap<string, Buffer>, activeKid: string) {
    this.activeKid = activeKid;
    this.kids = [...keys.keys()];
    keyBytes.set(this, keys);
  }

  toJSON(): { activeKid: string; kids: readonly string[] } {
    return { activeKid: this.activeKid, kids: this.kids };
  }
}

function parseKeyEntry(entry: string): { kid: string; key: Buffer } {
  const separator = entry.indexOf(':');
  if (separator < 0) throw new SecretBoxError('key_invalid');
  const kid = entry.slice(0, separator);
  const encoded = entry.slice(separator + 1);
  if (!KID_PATTERN.test(kid) || !STANDARD_BASE64.test(encoded)) throw new SecretBoxError('key_invalid');
  const key = Buffer.from(encoded, 'base64');
  // Re-encoding rejects a non-canonical spelling of the same bytes as well as a wrong length.
  if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) throw new SecretBoxError('key_invalid');
  return { kid, key };
}

/**
 * Reads and validates the key configuration. Called when a key is needed, never on import. Throws `key_missing` when there is no active
 * key and `key_invalid` for anything malformed: a bad kid, a key that is not 32 bytes of standard base64, an empty list entry or a kid
 * used twice. Whitespace around an entry is ignored; a blank retired variable means no retired keys.
 */
export function parseKeyRing(env: Readonly<Record<string, string | undefined>> = process.env): KeyRing {
  const active = env[ACTIVE_KEY_ENV]?.trim();
  if (!active) throw new SecretBoxError('key_missing');

  const entries = [active];
  const retired = env[RETIRED_KEYS_ENV]?.trim();
  if (retired) entries.push(...retired.split(',').map((entry) => entry.trim()));

  const keys = new Map<string, Buffer>();
  let activeKid = '';
  for (const [index, entry] of entries.entries()) {
    const { kid, key } = parseKeyEntry(entry);
    if (keys.has(kid)) throw new SecretBoxError('key_invalid');
    keys.set(kid, key);
    if (index === 0) activeKid = kid;
  }
  return new KeyRing(keys, activeKid);
}

/** `rq:v1:<table>:<column>:<user_id>`. The parts are constants or ids and may not be empty or contain `:`, which would make two places collide. */
export function buildSecretAad(parts: { table: string; column: string; userId: string }): string {
  const { table, column, userId } = parts;
  for (const part of [table, column, userId]) {
    if (typeof part !== 'string' || part === '' || part.includes(':')) throw new SecretBoxError('bad_aad');
  }
  return `rq:v1:${table}:${column}:${userId}`;
}

function bytesFromField(field: string, expectedLength?: number): Buffer {
  if (!BASE64URL.test(field)) throw new SecretBoxError('bad_format');
  const bytes = Buffer.from(field, 'base64url');
  // A field that is not the canonical spelling of its bytes (stray trailing bits) is treated as damaged, not as the same value.
  if (bytes.toString('base64url') !== field || (expectedLength !== undefined && bytes.length !== expectedLength)) {
    throw new SecretBoxError('bad_format');
  }
  return bytes;
}

/** Encrypts `plain` under the ring's active key and binds it to `aad`. A new random iv is used every call. */
export function seal(plain: string, aad: string, ring: KeyRing = parseKeyRing()): string {
  const key = keyBytes.get(ring)?.get(ring.activeKid);
  if (!key) throw new SecretBoxError('key_missing');
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, ring.activeKid, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join(':');
  } catch {
    throw new SecretBoxError('key_invalid');
  }
}

/**
 * Decrypts a stored value with the key its kid names (active or retired). Throws `bad_format` for anything that is not a well-formed
 * `enc:v1:` string, `unknown_key_id` when the ring holds no such kid, and `auth_failed` when the tag does not verify (wrong key, changed
 * bytes or a different `aad`). GCM verifies the tag inside node:crypto's `final()`, so no value of ours is compared by hand.
 */
export function open(stored: string, aad: string, ring: KeyRing = parseKeyRing()): string {
  if (typeof stored !== 'string') throw new SecretBoxError('bad_format');
  const parts = stored.split(':');
  if (parts.length !== 6 || `${parts[0]}:${parts[1]}` !== PREFIX) throw new SecretBoxError('bad_format');
  const [, , kid, ivField, ciphertextField, tagField] = parts;
  if (!KID_PATTERN.test(kid)) throw new SecretBoxError('bad_format');
  const iv = bytesFromField(ivField, IV_BYTES);
  const ciphertext = bytesFromField(ciphertextField);
  const tag = bytesFromField(tagField, TAG_BYTES);

  const key = keyBytes.get(ring)?.get(kid);
  if (!key) throw new SecretBoxError('unknown_key_id');
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('auth_failed');
  }
}
