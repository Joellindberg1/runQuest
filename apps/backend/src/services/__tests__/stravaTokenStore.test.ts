/**
 * The token store (ADR 013 decisions 2, 4, 5, 6 and 9): the one place that encrypts and decrypts Strava tokens, and the one place that
 * reads or writes the token columns. Database: createFakeDb. No network.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV, buildSecretAad, parseKeyRing, seal } from '../../utils/secretBox.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { legacyToken, plainOfStored, storedToken } from '../../test-utils/stravaTokens.js';
import {
  checkSealingReady,
  openStravaToken,
  readStoredTokenRow,
  resetLegacyTokenWarnings,
  saveRotatedTokens,
  sealStravaToken,
  sealStravaTokenPair,
  storedRefreshTokenEquals,
  upsertStravaConnection,
} from '../stravaTokenStore.js';

// Keys are generated per run from random bytes: nothing here is a real key.
const newKey = () => randomBytes(32).toString('base64');
const ring = (active: string, retired?: string) => parseKeyRing({ [ACTIVE_KEY_ENV]: active, ...(retired === undefined ? {} : { [RETIRED_KEYS_ENV]: retired }) });

const ACCESS = legacyToken('plain-access');
const REFRESH = legacyToken('plain-refresh');

beforeEach(() => {
  vi.clearAllMocks();
  resetLegacyTokenWarnings();
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function use(rows: Row[]) {
  const tables: Record<string, Row[]> = { strava_tokens: rows };
  const db = createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return { tables, db };
}

describe('sealing and opening a token', () => {
  const k1 = ring(`stg-1:${newKey()}`);

  it('a sealed token opens to the same plaintext and is stored as enc:v1', () => {
    const stored = sealStravaToken('user-1', 'refresh_token', REFRESH, k1);

    expect(stored.startsWith('enc:v1:stg-1:')).toBe(true);
    expect(stored).not.toContain(REFRESH);
    expect(openStravaToken('user-1', 'refresh_token', stored, k1)).toEqual({ ok: true, token: REFRESH, legacy: false });
  });

  it('a token moved to another user or another column does not open', () => {
    const stored = sealStravaToken('user-1', 'refresh_token', REFRESH, k1);

    expect(openStravaToken('user-2', 'refresh_token', stored, k1)).toEqual({ ok: false, code: 'auth_failed' });
    expect(openStravaToken('user-1', 'access_token', stored, k1)).toEqual({ ok: false, code: 'auth_failed' });
  });

  it('a token sealed under a key the ring does not hold is unknown_key_id, and under the wrong key under the same id auth_failed', () => {
    const stored = sealStravaToken('user-1', 'access_token', ACCESS, k1);

    expect(openStravaToken('user-1', 'access_token', stored, ring(`stg-2:${newKey()}`))).toEqual({ ok: false, code: 'unknown_key_id' });
    expect(openStravaToken('user-1', 'access_token', stored, ring(`stg-1:${newKey()}`))).toEqual({ ok: false, code: 'auth_failed' });
  });

  it('a value read after a rotation opens through the retired key', () => {
    const oldKey = `old-1:${newKey()}`;
    const stored = sealStravaToken('user-1', 'access_token', ACCESS, ring(oldKey));

    const rotated = ring(`new-1:${newKey()}`, oldKey);

    expect(openStravaToken('user-1', 'access_token', stored, rotated)).toMatchObject({ ok: true, token: ACCESS });
    expect(sealStravaToken('user-1', 'access_token', ACCESS, rotated).startsWith('enc:v1:new-1:')).toBe(true);
  });

  it('sealStravaTokenPair seals both columns, each bound to its own column', () => {
    const pair = sealStravaTokenPair('user-1', { accessToken: ACCESS, refreshToken: REFRESH }, k1);

    expect(openStravaToken('user-1', 'access_token', pair.access_token, k1)).toMatchObject({ ok: true, token: ACCESS });
    expect(openStravaToken('user-1', 'refresh_token', pair.refresh_token, k1)).toMatchObject({ ok: true, token: REFRESH });
    expect(openStravaToken('user-1', 'access_token', pair.refresh_token, k1)).toMatchObject({ ok: false });
  });
});

describe('the legacy plaintext shape', () => {
  const k1 = ring(`stg-1:${newKey()}`);

  it('a plaintext token of the strict shape is read as it is and warned about once per user', () => {
    const forty = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

    expect(openStravaToken('user-1', 'access_token', forty, k1)).toEqual({ ok: true, token: forty, legacy: true });
    expect(openStravaToken('user-1', 'refresh_token', forty, k1)).toMatchObject({ ok: true, legacy: true });
    expect(openStravaToken('user-2', 'access_token', forty, k1)).toMatchObject({ ok: true, legacy: true });

    const warnings = vi.mocked(logger.warn).mock.calls.map((call) => String(call[0]));
    expect(warnings).toHaveLength(2); // user-1 once, user-2 once
    expect(warnings.join('\n')).toContain('legacy plaintext token read');
    expect(warnings.join('\n')).not.toContain(forty);
  });

  it('anything else is legacy_shape and is never handed on: too short, too long, a colon, a space, an empty string', () => {
    const shapes = ['short', 'x'.repeat(19), 'x'.repeat(129), 'abc:defghijklmnopqrstuvwxyz', 'has a space inside it 123456789', ''];
    for (const value of shapes) {
      expect(openStravaToken('user-1', 'access_token', value, k1), JSON.stringify(value)).toEqual({ ok: false, code: 'legacy_shape' });
    }
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('a value that starts with enc: is never read as plaintext, whatever is wrong with it', () => {
    const intact = sealStravaToken('user-1', 'access_token', ACCESS, k1);
    const cases = ['enc:', 'enc:v1', 'enc:v2:stg-1:AAAA:AAAA:AAAA', intact.slice(0, -4), `${intact}:extra`, `enc:v1:stg-1:${'a'.repeat(30)}`];
    for (const value of cases) {
      expect(openStravaToken('user-1', 'access_token', value, k1), value).toEqual({ ok: false, code: 'bad_format' });
    }
  });

  it('a column that is not a string is legacy_shape', () => {
    expect(openStravaToken('user-1', 'access_token', 42 as never, k1)).toEqual({ ok: false, code: 'legacy_shape' });
  });
});

describe('the key check before a token is touched', () => {
  it('checkSealingReady is ok with a valid key and reports the cause otherwise', () => {
    vi.stubEnv(ACTIVE_KEY_ENV, `stg-1:${newKey()}`);
    expect(checkSealingReady()).toMatchObject({ ok: true });

    vi.stubEnv(ACTIVE_KEY_ENV, '');
    expect(checkSealingReady()).toEqual({ ok: false, code: 'key_missing' });

    vi.stubEnv(ACTIVE_KEY_ENV, 'stg-1:not-a-key');
    expect(checkSealingReady()).toEqual({ ok: false, code: 'key_invalid' });

    vi.stubEnv(ACTIVE_KEY_ENV, `stg-1:${newKey()}`);
    vi.stubEnv(RETIRED_KEYS_ENV, 'broken');
    expect(checkSealingReady()).toEqual({ ok: false, code: 'key_invalid' });
  });
});

describe('reading and writing the token row', () => {
  it('readStoredTokenRow returns the raw stored strings and the connection state, or null without a row', async () => {
    const stored = { access: storedToken('user-1', 'access_token', ACCESS), refresh: storedToken('user-1', 'refresh_token', REFRESH) };
    use([{ user_id: 'user-1', access_token: stored.access, refresh_token: stored.refresh, expires_at: 123, connection_date: '2026-09-01', consent_version: 'v1' }]);

    expect(await readStoredTokenRow('user-1')).toEqual({ accessRaw: stored.access, refreshRaw: stored.refresh, expiresAt: 123, connectionDate: '2026-09-01', consentVersion: 'v1' });
    expect(await readStoredTokenRow('user-9')).toBeNull();
  });

  it('readStoredTokenRow throws on a database error, so the caller never mistakes it for no connection', async () => {
    const db = createFakeDb({ strava_tokens: [{ user_id: 'user-1' }] }, { errors: { strava_tokens: { message: 'connection reset' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);

    await expect(readStoredTokenRow('user-1')).rejects.toBeTruthy();
  });

  it('saveRotatedTokens writes only while the row still holds the exact stored string it was told to expect', async () => {
    const k = parseKeyRing();
    const before = storedToken('user-1', 'refresh_token', REFRESH);
    const { tables } = use([{ user_id: 'user-1', access_token: storedToken('user-1', 'access_token', ACCESS), refresh_token: before, expires_at: 1 }]);
    const sealed = sealStravaTokenPair('user-1', { accessToken: legacyToken('next-access'), refreshToken: legacyToken('next-refresh') }, k);

    // The same plaintext sealed again is a different string: the guard is on the stored string, not on the plaintext.
    const other = sealStravaToken('user-1', 'refresh_token', REFRESH, k);
    expect(other).not.toBe(before);
    expect(await saveRotatedTokens('user-1', other, sealed, 2)).toEqual({ error: null, saved: false });
    expect(tables.strava_tokens[0].refresh_token).toBe(before);

    expect(await saveRotatedTokens('user-1', before, sealed, 2)).toEqual({ error: null, saved: true });
    expect(tables.strava_tokens[0]).toMatchObject({ access_token: sealed.access_token, refresh_token: sealed.refresh_token, expires_at: 2 });
  });

  it('saveRotatedTokens reports a database error and does not claim it saved', async () => {
    use([{ user_id: 'user-1', refresh_token: 'x' }]);
    const failing = createFakeDb({ strava_tokens: [{ user_id: 'user-1', refresh_token: 'x' }] }, { errors: { strava_tokens: { message: 'write failed' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(failing.client as never);

    const result = await saveRotatedTokens('user-1', 'x', { access_token: 'a', refresh_token: 'b' }, 2);

    expect(result.saved).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('upsertStravaConnection writes both tokens encrypted and the other columns as given, never a plaintext token', async () => {
    const { tables, db } = use([]);

    const { error } = await upsertStravaConnection(
      'user-1',
      { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: 999 },
      { connection_date: '2026-10-18', sync_paused: false },
      parseKeyRing(),
    );

    expect(error).toBeNull();
    const written = tables.strava_tokens[0];
    expect(written).toMatchObject({ user_id: 'user-1', expires_at: 999, connection_date: '2026-10-18', sync_paused: false });
    expect(written.access_token.startsWith('enc:v1:')).toBe(true);
    expect(written.refresh_token.startsWith('enc:v1:')).toBe(true);
    expect(plainOfStored('user-1', 'access_token', written.access_token)).toBe(ACCESS);
    expect(plainOfStored('user-1', 'refresh_token', written.refresh_token)).toBe(REFRESH);
    expect(JSON.stringify(db.queries)).not.toContain(ACCESS);
    expect(JSON.stringify(db.queries)).not.toContain(REFRESH);
  });

  it('storedRefreshTokenEquals compares plaintexts, so a re-encrypted row still matches, and a read or decryption that fails is "no"', async () => {
    const { tables } = use([{ user_id: 'user-1', refresh_token: storedToken('user-1', 'refresh_token', REFRESH) }]);

    expect(await storedRefreshTokenEquals('user-1', REFRESH, parseKeyRing())).toBe(true);
    expect(await storedRefreshTokenEquals('user-1', legacyToken('another'), parseKeyRing())).toBe(false);

    tables.strava_tokens[0].refresh_token = sealStravaToken('user-1', 'refresh_token', REFRESH, parseKeyRing()); // new IV, same plaintext
    expect(await storedRefreshTokenEquals('user-1', REFRESH, parseKeyRing())).toBe(true);

    tables.strava_tokens[0].refresh_token = 'enc:v1:broken';
    expect(await storedRefreshTokenEquals('user-1', REFRESH, parseKeyRing())).toBe(false);

    tables.strava_tokens[0].refresh_token = seal(REFRESH, buildSecretAad({ table: 'strava_tokens', column: 'refresh_token', userId: 'user-2' }), parseKeyRing());
    expect(await storedRefreshTokenEquals('user-1', REFRESH, parseKeyRing())).toBe(false);

    tables.strava_tokens.length = 0;
    expect(await storedRefreshTokenEquals('user-1', REFRESH, parseKeyRing())).toBe(false);
  });

  it('storedRefreshTokenEquals reads a legacy plaintext row too', async () => {
    use([{ user_id: 'user-1', refresh_token: REFRESH }]);

    expect(await storedRefreshTokenEquals('user-1', REFRESH, parseKeyRing())).toBe(true);
  });
});
