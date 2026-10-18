import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_KEY_ENV,
  RETIRED_KEYS_ENV,
  KeyRing,
  SecretBoxError,
  buildSecretAad,
  open,
  parseKeyRing,
  seal,
  type SecretAad,
  type SecretBoxErrorCode,
} from '../secretBox.js';
import { errorCode } from '../errorCode.js';

// The keys are generated per test run from random bytes: nothing in this file is a real key.
const newKey = () => randomBytes(32).toString('base64');
const ringFrom = (active: string, retired?: string) =>
  parseKeyRing({ [ACTIVE_KEY_ENV]: active, ...(retired === undefined ? {} : { [RETIRED_KEYS_ENV]: retired }) });

const AAD = buildSecretAad({ table: 'strava_tokens', column: 'refresh_token', userId: 'user-a' });

function codeOf(fn: () => unknown): SecretBoxErrorCode {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretBoxError);
    return (error as SecretBoxError).code;
  }
  throw new Error('expected the call to throw');
}

/** A different valid base64url character in the first position of a field: always a real change of the decoded bytes. */
function flipFirstChar(value: string): string {
  return (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
}

function withField(stored: string, index: number, mutate: (field: string) => string): string {
  const parts = stored.split(':');
  parts[index] = mutate(parts[index]);
  return parts.join(':');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('secretBox format and round trip', () => {
  it('seal then open returns the same plaintext', () => {
    const ring = ringFrom(`k-1:${newKey()}`);
    const plain = 'a'.repeat(40);
    expect(open(seal(plain, AAD, ring), AAD, ring)).toBe(plain);
  });

  it('round-trips an empty string, a long value and non-ASCII text', () => {
    const ring = ringFrom(`k-1:${newKey()}`);
    for (const plain of ['', 'x'.repeat(10_000), 'åäö 🏃 – ✓']) {
      expect(open(seal(plain, AAD, ring), AAD, ring)).toBe(plain);
    }
  });

  it('stores the value as enc:v1:<kid>:<iv>:<ct>:<tag> with a 12 byte iv and a 16 byte tag in base64url without padding', () => {
    const ring = ringFrom(`prod-1:${newKey()}`);
    const stored = seal('hello', AAD, ring);
    const parts = stored.split(':');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 3)).toEqual(['enc', 'v1', 'prod-1']);
    for (const field of parts.slice(3)) expect(field).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(parts[3], 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[4], 'base64url')).toHaveLength(5);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(16);
  });

  it('two encryptions of the same plaintext give different strings because the iv is random', () => {
    const ring = ringFrom(`k-1:${newKey()}`);
    const first = seal('same', AAD, ring);
    const second = seal('same', AAD, ring);
    expect(first).not.toBe(second);
    expect(first.split(':')[3]).not.toBe(second.split(':')[3]);
    expect(open(first, AAD, ring)).toBe('same');
    expect(open(second, AAD, ring)).toBe('same');
  });

  it('does not contain the plaintext in the stored value', () => {
    const ring = ringFrom(`k-1:${newKey()}`);
    const plain = 'plain-token-value-that-must-not-leak';
    expect(seal(plain, AAD, ring)).not.toContain(plain);
  });
});

describe('secretBox wrong key', () => {
  it('open with another key under the same kid fails with auth_failed', () => {
    const sealed = seal('secret', AAD, ringFrom(`k-1:${newKey()}`));
    expect(codeOf(() => open(sealed, AAD, ringFrom(`k-1:${newKey()}`)))).toBe('auth_failed');
  });

  it('open with a kid the ring does not hold fails with unknown_key_id', () => {
    const sealed = seal('secret', AAD, ringFrom(`prod-1:${newKey()}`));
    expect(codeOf(() => open(sealed, AAD, ringFrom(`stg-1:${newKey()}`)))).toBe('unknown_key_id');
  });

  it('parseKeyRing reports a missing, blank or retired-only configuration as key_missing', () => {
    expect(codeOf(() => parseKeyRing({}))).toBe('key_missing');
    expect(codeOf(() => parseKeyRing({ [ACTIVE_KEY_ENV]: '' }))).toBe('key_missing');
    expect(codeOf(() => parseKeyRing({ [ACTIVE_KEY_ENV]: '   ' }))).toBe('key_missing');
    expect(codeOf(() => parseKeyRing({ [RETIRED_KEYS_ENV]: `old-1:${newKey()}` }))).toBe('key_missing');
  });

  it('reads the process environment when no ring is passed, and only when called', () => {
    vi.stubEnv(ACTIVE_KEY_ENV, '');
    expect(codeOf(() => seal('x', AAD))).toBe('key_missing');
    expect(codeOf(() => open('enc:v1:env-1:AAAAAAAAAAAAAAAA::AAAAAAAAAAAAAAAAAAAAAA', AAD))).toBe('key_missing');
    vi.stubEnv(ACTIVE_KEY_ENV, `env-1:${newKey()}`);
    expect(open(seal('x', AAD), AAD)).toBe('x');
  });
});

describe('secretBox tampered ciphertext', () => {
  const ring = ringFrom(`k-1:${newKey()}`, `k-2:${newKey()}`);
  const stored = seal('a token value', AAD, ring);

  it('a changed iv fails with auth_failed', () => {
    expect(codeOf(() => open(withField(stored, 3, flipFirstChar), AAD, ring))).toBe('auth_failed');
  });

  it('a changed ciphertext fails with auth_failed', () => {
    expect(codeOf(() => open(withField(stored, 4, flipFirstChar), AAD, ring))).toBe('auth_failed');
  });

  it('a changed tag fails with auth_failed', () => {
    expect(codeOf(() => open(withField(stored, 5, flipFirstChar), AAD, ring))).toBe('auth_failed');
  });

  it('a changed last character of iv, ciphertext and tag fails too, since a non-canonical encoding is not accepted', () => {
    for (const index of [3, 4, 5]) {
      const tampered = withField(stored, index, (field) => {
        const last = field[field.length - 1];
        return field.slice(0, -1) + (last === 'A' ? 'B' : 'A');
      });
      expect(['auth_failed', 'bad_format']).toContain(codeOf(() => open(tampered, AAD, ring)));
    }
  });

  it('an iv that is not 12 bytes (canonical 8 or 16 byte spellings) fails with bad_format, not auth_failed', () => {
    for (const bytes of [0, 8, 11, 13, 16]) {
      const iv = randomBytes(bytes).toString('base64url');
      expect(codeOf(() => open(withField(stored, 3, () => iv), AAD, ring))).toBe('bad_format');
    }
  });

  it('a tag truncated to 12 bytes fails with bad_format, since GCM would otherwise accept a short tag', () => {
    const truncated = withField(stored, 5, (tag) => Buffer.from(tag, 'base64url').subarray(0, 12).toString('base64url'));
    expect(Buffer.from(truncated.split(':')[5], 'base64url')).toHaveLength(12);
    expect(codeOf(() => open(truncated, AAD, ring))).toBe('bad_format');
  });

  // An assumption about Node, not about secretBox: open() pins authTagLength as a second layer behind the format check, and this test
  // documents that the pin is what makes node:crypto refuse a truncated tag (without it Node accepts one, with a deprecation warning).
  // It cannot be reached through open(), where the format check answers first.
  it('assumption about node:crypto: a decipher with a pinned authTagLength refuses a 12 byte tag', () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.update('x', 'utf8');
    cipher.final();
    const shortTag = cipher.getAuthTag().subarray(0, 12);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    expect(() => decipher.setAuthTag(shortTag)).toThrow();
  });

  it('a non-canonical spelling of the same bytes (set spare bits in the last character) fails with bad_format', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    // The tag is 16 bytes = 22 characters, the last carrying 2 data bits and 4 spare bits; value + 1 sets a spare bit and decodes to the same bytes.
    const spare = withField(stored, 5, (tag) => tag.slice(0, -1) + alphabet[alphabet.indexOf(tag[tag.length - 1]) + 1]);
    expect(Buffer.from(spare.split(':')[5], 'base64url').equals(Buffer.from(stored.split(':')[5], 'base64url'))).toBe(true);
    expect(codeOf(() => open(spare, AAD, ring))).toBe('bad_format');
  });

  it('a changed kid to an unknown one fails with unknown_key_id', () => {
    expect(codeOf(() => open(withField(stored, 2, () => 'k-9'), AAD, ring))).toBe('unknown_key_id');
  });

  it('a changed kid to another key the ring holds fails with auth_failed', () => {
    expect(codeOf(() => open(withField(stored, 2, () => 'k-2'), AAD, ring))).toBe('auth_failed');
  });

  it('a changed prefix or version fails with bad_format', () => {
    expect(codeOf(() => open(stored.replace(/^enc:v1:/, 'enc:v2:'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(stored.replace(/^enc:v1:/, 'enc:v0:'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(stored.replace(/^enc:v1:/, 'ENC:v1:'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(stored.replace(/^enc:v1:/, 'xnc:v1:'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(stored.replace(/^enc:v1:/, ''), AAD, ring))).toBe('bad_format');
  });

  it('a truncated string, an extra field, a missing field and non-base64url fields fail with bad_format', () => {
    expect(codeOf(() => open(stored.slice(0, stored.length - 6), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(`${stored}:extra`, AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(stored.split(':').slice(0, 5).join(':'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 3, () => '!!!!!!!!!!!!!!!!'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 4, (f) => `${f}=`), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 5, (f) => `${f}+/`), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 3, (f) => f.slice(1)), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 5, (f) => f.slice(1)), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 2, () => 'Bad Kid'), AAD, ring))).toBe('bad_format');
    expect(codeOf(() => open(withField(stored, 2, () => ''), AAD, ring))).toBe('bad_format');
  });

  it('values that are not an encrypted string fail with bad_format', () => {
    for (const value of ['', 'enc:', 'enc:v1:', 'plain-looking-token-0123456789abcdef', null, undefined, 42, {}]) {
      expect(codeOf(() => open(value as unknown as string, AAD, ring))).toBe('bad_format');
    }
  });
});

describe('secretBox AAD binding', () => {
  const ring = ringFrom(`k-1:${newKey()}`);
  const aadFor = (table: string, column: string, userId: string) => buildSecretAad({ table, column, userId });

  it('builds the AAD as rq:v1:<table>:<column>:<user_id>', () => {
    expect(aadFor('strava_tokens', 'refresh_token', 'abc-123')).toBe('rq:v1:strava_tokens:refresh_token:abc-123');
  });

  it('refuses to build an AAD from parts that are empty or contain a colon', () => {
    expect(codeOf(() => aadFor('', 'refresh_token', 'u'))).toBe('bad_aad');
    expect(codeOf(() => aadFor('strava_tokens', '', 'u'))).toBe('bad_aad');
    expect(codeOf(() => aadFor('strava_tokens', 'refresh_token', ''))).toBe('bad_aad');
    expect(codeOf(() => aadFor('strava_tokens', 'refresh:token', 'u'))).toBe('bad_aad');
    expect(codeOf(() => aadFor('strava:tokens', 'refresh_token', 'u'))).toBe('bad_aad');
    expect(codeOf(() => aadFor('strava_tokens', 'refresh_token', 'a:b'))).toBe('bad_aad');
  });

  it('opens with the same table, column and user_id', () => {
    const stored = seal('t', aadFor('strava_tokens', 'refresh_token', 'user-a'), ring);
    expect(open(stored, aadFor('strava_tokens', 'refresh_token', 'user-a'), ring)).toBe('t');
  });

  it('a ciphertext moved to another user_id does not open', () => {
    const stored = seal('t', aadFor('strava_tokens', 'refresh_token', 'user-a'), ring);
    expect(codeOf(() => open(stored, aadFor('strava_tokens', 'refresh_token', 'user-b'), ring))).toBe('auth_failed');
  });

  it('a ciphertext moved to another column does not open', () => {
    const stored = seal('t', aadFor('strava_tokens', 'refresh_token', 'user-a'), ring);
    expect(codeOf(() => open(stored, aadFor('strava_tokens', 'access_token', 'user-a'), ring))).toBe('auth_failed');
  });

  it('a ciphertext moved to another table does not open', () => {
    const stored = seal('t', aadFor('strava_tokens', 'refresh_token', 'user-a'), ring);
    expect(codeOf(() => open(stored, aadFor('other_secrets', 'refresh_token', 'user-a'), ring))).toBe('auth_failed');
  });

  it('an empty, missing or non-string AAD is rejected as bad_aad by seal and open, not as a key or authentication problem', () => {
    const stored = seal('t', aadFor('strava_tokens', 'refresh_token', 'user-a'), ring);
    for (const bad of ['', undefined, null, 42, {}, '\ud800']) {
      expect(codeOf(() => seal('t', bad as unknown as SecretAad, ring))).toBe('bad_aad');
      expect(codeOf(() => open(stored, bad as unknown as SecretAad, ring))).toBe('bad_aad');
    }
  });
});

describe('secretBox caller mistakes are not key problems', () => {
  const ring = ringFrom(`k-1:${newKey()}`);

  it('a plaintext that is not a well-formed string is rejected as bad_input by seal', () => {
    for (const bad of [undefined, null, 42, {}, Buffer.from('x'), '\ud800', 'ok\udc00']) {
      expect(codeOf(() => seal(bad as unknown as string, AAD, ring))).toBe('bad_input');
    }
  });
});

describe('secretBox cipher initialisation', () => {
  it('seal reports key_invalid when the ring holds a key of the wrong length', () => {
    const ring = new KeyRing(new Map([['k-1', Buffer.alloc(5)]]), 'k-1');
    expect(codeOf(() => seal('t', AAD, ring))).toBe('key_invalid');
  });
});

describe('secretBox AAD parts', () => {
  it('only accepts letters, digits, underscore, dot and hyphen in each part', () => {
    const ok = { table: 'strava_tokens', column: 'refresh_token', userId: '123e4567-e89b-12d3-a456-426614174000' };
    expect(buildSecretAad(ok)).toBe('rq:v1:strava_tokens:refresh_token:123e4567-e89b-12d3-a456-426614174000');
    for (const bad of ['a b', 'a/b', 'a\nb', 'åäö', 'a:b', '', '\ud800', '\ud801', '🏃']) {
      for (const field of ['table', 'column', 'userId'] as const) {
        expect(codeOf(() => buildSecretAad({ ...ok, [field]: bad }))).toBe('bad_aad');
      }
    }
  });

  it('two lone surrogates can no longer produce the same AAD', () => {
    const make = (userId: string) => () => buildSecretAad({ table: 't', column: 'c', userId });
    expect(codeOf(make('\ud800'))).toBe('bad_aad');
    expect(codeOf(make('\ud801'))).toBe('bad_aad');
  });
});

describe('secretBox rotation with a retired key', () => {
  it('opens a value sealed under a retired kid, and always seals with the active key', () => {
    const k1 = newKey();
    const k2 = newKey();
    const oldStored = seal('old token', AAD, ringFrom(`k-1:${k1}`));

    const rotated = ringFrom(`k-2:${k2}`, `k-1:${k1}`);
    expect(open(oldStored, AAD, rotated)).toBe('old token');
    expect(rotated.activeKid).toBe('k-2');

    const resealed = seal('old token', AAD, rotated);
    expect(resealed.split(':')[2]).toBe('k-2');
    expect(seal('anything', AAD, rotated).split(':')[2]).toBe('k-2');
    expect(open(resealed, AAD, rotated)).toBe('old token');
  });

  it('cannot open the old value once the retired key is removed', () => {
    const k1 = newKey();
    const oldStored = seal('old token', AAD, ringFrom(`k-1:${k1}`));
    expect(codeOf(() => open(oldStored, AAD, ringFrom(`k-2:${newKey()}`)))).toBe('unknown_key_id');
  });

  it('holds several retired keys and tolerates whitespace around the entries', () => {
    const [a, b, c] = [newKey(), newKey(), newKey()];
    const stored1 = seal('one', AAD, ringFrom(`k-1:${a}`));
    const stored2 = seal('two', AAD, ringFrom(`k-2:${b}`));
    const ring = ringFrom(` k-3:${c} `, ` k-1:${a} , k-2:${b}\n`);
    expect(ring.kids).toEqual(['k-3', 'k-1', 'k-2']);
    expect(open(stored1, AAD, ring)).toBe('one');
    expect(open(stored2, AAD, ring)).toBe('two');
  });

  it('treats an empty retired variable as no retired keys', () => {
    expect(ringFrom(`k-1:${newKey()}`, '').kids).toEqual(['k-1']);
    expect(ringFrom(`k-1:${newKey()}`, '  ').kids).toEqual(['k-1']);
  });
});

describe('secretBox key configuration', () => {
  it('accepts a 32 byte standard base64 key and kids that follow the pattern', () => {
    for (const kid of ['prod-1', 'stg-1', 'a', '0', 'a-b-c-d', 'abcdefghij012345']) {
      expect(ringFrom(`${kid}:${newKey()}`).activeKid).toBe(kid);
    }
  });

  it('rejects a key of the wrong length as key_invalid', () => {
    for (const bytes of [0, 1, 16, 24, 31, 33, 64]) {
      const key = randomBytes(bytes).toString('base64');
      expect(codeOf(() => ringFrom(`k-1:${key}`))).toBe('key_invalid');
    }
  });

  it('rejects a key that is not base64 as key_invalid', () => {
    const good = newKey();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    // The last data character of a 32 byte key carries 4 bits and 2 padding bits that must be zero; value + 1 decodes to the same bytes.
    const nonCanonical = good.slice(0, 42) + alphabet[alphabet.indexOf(good[42]) + 1] + good.slice(43);
    const candidates = [
      '!'.repeat(44),
      `${good.slice(0, 20)} ${good.slice(21)}`,
      good.replace(/=$/, ''),
      `${good}=`,
      nonCanonical,
      'not base64 at all',
      '',
    ];
    for (const candidate of candidates) {
      expect(codeOf(() => ringFrom(`k-1:${candidate}`))).toBe('key_invalid');
    }
  });

  it('rejects a base64url alphabet key, since the key is standard base64', () => {
    const urlKey = Buffer.from(Uint8Array.from({ length: 32 }, () => 0xfb)).toString('base64url');
    expect(urlKey).toMatch(/[-_]/);
    expect(codeOf(() => ringFrom(`k-1:${urlKey}`))).toBe('key_invalid');
    expect(ringFrom(`k-1:${Buffer.from(Uint8Array.from({ length: 32 }, () => 0xfb)).toString('base64')}`).activeKid).toBe('k-1');
  });

  it('rejects an empty kid, an invalid kid and a missing separator as key_invalid', () => {
    const key = newKey();
    for (const entry of [`:${key}`, `Prod-1:${key}`, `-a:${key}`, `a_b:${key}`, `a b:${key}`, `abcdefghij0123456:${key}`, key, `k-1${key}`]) {
      expect(codeOf(() => ringFrom(entry))).toBe('key_invalid');
    }
  });

  it('rejects the same kid twice, between active and retired and within retired, as key_invalid', () => {
    const [a, b, c] = [newKey(), newKey(), newKey()];
    expect(codeOf(() => ringFrom(`k-1:${a}`, `k-1:${b}`))).toBe('key_invalid');
    expect(codeOf(() => ringFrom(`k-1:${a}`, `k-2:${b},k-2:${c}`))).toBe('key_invalid');
    expect(codeOf(() => ringFrom(`k-1:${a}`, `k-1:${a}`))).toBe('key_invalid');
  });

  it('rejects an invalid retired entry, an empty entry in the list and a trailing comma as key_invalid', () => {
    const [a, b] = [newKey(), newKey()];
    expect(codeOf(() => ringFrom(`k-1:${a}`, `k-2:${randomBytes(16).toString('base64')}`))).toBe('key_invalid');
    expect(codeOf(() => ringFrom(`k-1:${a}`, `k-2:${b},,k-3:${a}`))).toBe('key_invalid');
    expect(codeOf(() => ringFrom(`k-1:${a}`, `k-2:${b},`))).toBe('key_invalid');
    expect(codeOf(() => ringFrom(`k-1:${a}`, `K-2:${b}`))).toBe('key_invalid');
  });

  it('does not read or validate the environment on import, only when a key is needed', async () => {
    vi.resetModules();
    vi.stubEnv(ACTIVE_KEY_ENV, 'this is not a valid key');
    vi.stubEnv(RETIRED_KEYS_ENV, ',,garbage');
    const fresh = await import('../secretBox.js');
    expect(fresh.parseKeyRing).toBeTypeOf('function');
    // The invalid values are only noticed when a key is asked for.
    expect(() => fresh.parseKeyRing()).toThrow(fresh.SecretBoxError);
  });
});

describe('secretBox never carries key material', () => {
  const keyB64 = newKey();
  const retiredB64 = newKey();
  const plain = 'plaintext-token-must-not-appear-in-errors';
  const ring = ringFrom(`k-1:${keyB64}`, `k-0:${retiredB64}`);
  const stored = seal(plain, AAD, ring);

  function everyFailure(): SecretBoxError[] {
    const attempts: Array<() => unknown> = [
      () => open(withField(stored, 4, flipFirstChar), AAD, ring),
      () => open(withField(stored, 2, () => 'k-9'), AAD, ring),
      () => open(stored.replace('enc:v1:', 'enc:v2:'), AAD, ring),
      () => open(stored, buildSecretAad({ table: 'other', column: 'aad', userId: 'x' }), ring),
      () => open(stored, AAD, ringFrom(`k-1:${newKey()}`)),
      () => parseKeyRing({ [ACTIVE_KEY_ENV]: `k-1:${keyB64.slice(0, 20)}` }),
      () => parseKeyRing({ [ACTIVE_KEY_ENV]: `K 1:${keyB64}` }),
      () => parseKeyRing({ [ACTIVE_KEY_ENV]: `k-1:${keyB64}`, [RETIRED_KEYS_ENV]: `k-1:${retiredB64}` }),
      () => parseKeyRing({}),
      () => buildSecretAad({ table: 'a:b', column: 'c', userId: 'u' }),
    ];
    return attempts.map((attempt) => {
      try {
        attempt();
      } catch (error) {
        return error as SecretBoxError;
      }
      throw new Error('expected the call to throw');
    });
  }

  it('errors hold a code and a fixed message only, never a key, the plaintext or the stored value', () => {
    const forbidden = [keyB64, retiredB64, plain, stored, stored.split(':')[3], stored.split(':')[4], stored.split(':')[5], keyB64.slice(0, 20)];
    for (const error of everyFailure()) {
      expect(error).toBeInstanceOf(SecretBoxError);
      expect(error.name).toBe('SecretBoxError');
      expect(error.cause).toBeUndefined();
      const rendered = [error.message, error.stack ?? '', JSON.stringify(error), inspect(error, { depth: 5 }), errorCode(error)].join('\n');
      for (const secret of forbidden) expect(rendered).not.toContain(secret);
      expect(error.message).toBe(`secretBox: ${error.code}`);
      expect(errorCode(error)).toBe(error.code);
    }
  });

  it('a key ring prints and serialises as its kids only', () => {
    const rendered = [JSON.stringify(ring), inspect(ring, { depth: 5, showHidden: true }), String(ring), `${JSON.stringify({ ring })}`].join('\n');
    expect(rendered).not.toContain(keyB64);
    expect(rendered).not.toContain(retiredB64);
    expect(rendered).not.toContain(Buffer.from(keyB64, 'base64').toString('hex'));
    expect(rendered).toContain('k-1');
  });
});
