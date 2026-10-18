/**
 * The key configuration of the token store as an operator meets it (ADR 013 decisions 3, 9 and 10): which key ids an environment
 * accepts, what the health read reports about the rows, and the count of tokens that could not be read. Database: createFakeDb.
 * Keys are generated per run from random bytes: nothing here is a real key. No network.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { legacyToken } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV, parseKeyRing } from '../../utils/secretBox.js';
import { getValidAccessToken } from '../stravaClient.js';
import {
  checkSealingReady,
  inspectTokenKeyConfig,
  readTokenEncryptionHealth,
  recordUnreadableToken,
  requiredKidPrefix,
  resetUnreadableCount,
  sealStravaToken,
  unreadableSinceStart,
} from '../stravaTokenStore.js';

const newKey = () => randomBytes(32).toString('base64');
const entry = (kid: string) => `${kid}:${newKey()}`;

function configure(env: { node?: string; sentry?: string; active?: string; retired?: string }) {
  vi.stubEnv('NODE_ENV', env.node ?? 'production');
  vi.stubEnv('SENTRY_ENVIRONMENT', env.sentry ?? '');
  vi.stubEnv(ACTIVE_KEY_ENV, env.active ?? '');
  vi.stubEnv(RETIRED_KEYS_ENV, env.retired ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUnreadableCount();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the key id an environment accepts', () => {
  it('production needs a prod- key id, staging (SENTRY_ENVIRONMENT=staging) a stg- one, other environments any', () => {
    expect(requiredKidPrefix({ NODE_ENV: 'production' })).toBe('prod-');
    expect(requiredKidPrefix({ NODE_ENV: 'production', SENTRY_ENVIRONMENT: 'production' })).toBe('prod-');
    expect(requiredKidPrefix({ NODE_ENV: 'production', SENTRY_ENVIRONMENT: ' Staging ' })).toBe('stg-');
    expect(requiredKidPrefix({ NODE_ENV: 'development' })).toBeNull();
    expect(requiredKidPrefix({ NODE_ENV: 'test' })).toBeNull();
    expect(requiredKidPrefix({})).toBeNull();
  });

  it('in production a key with the test- prefix is refused, because the open test key is not a secret', () => {
    configure({ active: entry('test-1') });

    const config = inspectTokenKeyConfig();

    expect(config).toMatchObject({ ok: false, problem: 'kid_not_allowed', requiredPrefix: 'prod-', offendingKids: ['test-1'] });
    expect(checkSealingReady()).toEqual({ ok: false, code: 'key_invalid' });
  });

  it('in production a key without the prod- prefix is refused, whatever else it is', () => {
    for (const kid of ['stg-1', 'k1', 'production-1']) {
      configure({ active: entry(kid) });
      expect(inspectTokenKeyConfig(), kid).toMatchObject({ ok: false, problem: 'kid_not_allowed', offendingKids: [kid] });
      expect(checkSealingReady(), kid).toEqual({ ok: false, code: 'key_invalid' });
    }
  });

  it('in production a retired key with the wrong prefix is refused too, because a test key that opens values lets anyone with database access plant tokens', () => {
    configure({ active: entry('prod-2'), retired: `${entry('prod-1')},${entry('test-1')}` });

    expect(inspectTokenKeyConfig()).toMatchObject({ ok: false, problem: 'kid_not_allowed', offendingKids: ['test-1'] });
    expect(checkSealingReady()).toEqual({ ok: false, code: 'key_invalid' });
  });

  it('a prod- key with a prod- retired key is accepted in production, and the ring is the one parsed from the environment', () => {
    const active = entry('prod-2');
    const retired = entry('prod-1');
    configure({ active, retired });

    const config = inspectTokenKeyConfig();
    const ready = checkSealingReady();

    expect(config).toMatchObject({ ok: true });
    expect(ready.ok).toBe(true);
    if (!config.ok || !ready.ok) throw new Error('expected a usable configuration');
    expect(config.ring.activeKid).toBe('prod-2');
    expect(config.ring.kids).toEqual(['prod-2', 'prod-1']);
    expect(ready.ring.toJSON()).toEqual(parseKeyRing({ [ACTIVE_KEY_ENV]: active, [RETIRED_KEYS_ENV]: retired }).toJSON());
  });

  it('staging accepts stg- and refuses prod-, so a production key pasted into staging is caught', () => {
    configure({ sentry: 'staging', active: entry('stg-1') });
    expect(checkSealingReady().ok).toBe(true);

    configure({ sentry: 'staging', active: entry('prod-1') });
    expect(inspectTokenKeyConfig()).toMatchObject({ ok: false, problem: 'kid_not_allowed', requiredPrefix: 'stg-', offendingKids: ['prod-1'] });
  });

  it('outside production any valid key id is accepted, the open test key included', () => {
    for (const node of ['test', 'development']) {
      configure({ node, active: entry('test-1') });
      expect(checkSealingReady().ok, node).toBe(true);
      configure({ node, active: entry('whatever') });
      expect(checkSealingReady().ok, node).toBe(true);
    }
  });

  it('a missing or malformed key is key_missing or key_invalid in every environment, and never reads as a prefix problem', () => {
    for (const node of ['production', 'test']) {
      configure({ node, active: '' });
      expect(inspectTokenKeyConfig(), node).toEqual({ ok: false, problem: 'key_missing' });
      expect(checkSealingReady(), node).toEqual({ ok: false, code: 'key_missing' });
      configure({ node, active: 'prod-1:not-a-key' });
      expect(inspectTokenKeyConfig(), node).toEqual({ ok: false, problem: 'key_invalid' });
      expect(checkSealingReady(), node).toEqual({ ok: false, code: 'key_invalid' });
    }
  });

  it('the answer never carries key material', () => {
    const active = entry('test-1');
    configure({ active });

    const rendered = JSON.stringify(inspectTokenKeyConfig());

    expect(rendered).not.toContain(active.split(':')[1]);
    expect(rendered).not.toContain(active.split(':')[1].slice(0, 8));
  });
});

describe('the health read of the token rows', () => {
  const active = entry('prod-2');
  const retired = entry('prod-1');
  const ringOf = (...entries: string[]) => parseKeyRing({ [ACTIVE_KEY_ENV]: entries[0], ...(entries[1] ? { [RETIRED_KEYS_ENV]: entries[1] } : {}) });
  const sealedBy = (ring: ReturnType<typeof ringOf>, userId: string, tag: string) => ({
    user_id: userId,
    access_token: sealStravaToken(userId, 'access_token', `${tag}-access-0123456789`, ring),
    refresh_token: sealStravaToken(userId, 'refresh_token', `${tag}-refresh-0123456789`, ring),
  });

  function useRows(rows: Row[]) {
    const tables: Record<string, Row[]> = { strava_tokens: rows };
    const db = createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
    return db;
  }

  it('counts the rows by form: encrypted, plaintext (legacy) and unrecognised, and those on another key id', async () => {
    configure({ active, retired });
    useRows([
      sealedBy(ringOf(active), 'u1', 'a'), // on the active key
      sealedBy(ringOf(active), 'u2', 'b'),
      sealedBy(ringOf(retired), 'u3', 'c'), // on the retired key
      sealedBy(ringOf(entry('prod-9')), 'u4', 'd'), // on a key the configuration does not hold
      { user_id: 'u5', access_token: legacyToken('legacy-a'), refresh_token: legacyToken('legacy-r') },
      { user_id: 'u6', access_token: sealStravaToken('u6', 'access_token', 'mixed-access-0123456789', ringOf(active)), refresh_token: legacyToken('legacy-r') }, // half moved
      { user_id: 'u7', access_token: 'enc:v1:prod-2:broken', refresh_token: legacyToken('legacy-r') },
      { user_id: 'u8', access_token: null, refresh_token: null }, // nothing stored: counted nowhere
    ]);

    const health = await readTokenEncryptionHealth();

    expect(health).toMatchObject({
      configured: true,
      config_error: null,
      active_kid: 'prod-2',
      retired_kids: ['prod-1'],
      encrypted_rows: 4,
      plaintext_rows: 2,
      unrecognised_rows: 1,
      rows_on_other_kid: 2,
      unreadable_since_start: 0,
    });
  });

  it('a configuration without a key reports it and still counts what the table holds', async () => {
    configure({ active: '' });
    useRows([sealedBy(ringOf(active), 'u1', 'a'), { user_id: 'u2', access_token: legacyToken('legacy-a'), refresh_token: legacyToken('legacy-r') }]);

    const health = await readTokenEncryptionHealth();

    expect(health).toMatchObject({
      configured: false, config_error: 'key_missing', active_kid: null, retired_kids: [], encrypted_rows: 1, plaintext_rows: 1, rows_on_other_kid: null,
    });
  });

  it('a refused key id is reported as such: not configured, with the key ids that are named', async () => {
    configure({ active: entry('test-1'), retired: retired });
    useRows([]);

    const health = await readTokenEncryptionHealth();

    expect(health).toMatchObject({ configured: false, config_error: 'kid_not_allowed', active_kid: 'test-1', retired_kids: ['prod-1'] });
  });

  it('an invalid key names no key ids', async () => {
    configure({ active: 'prod-1:short' });
    useRows([]);

    expect(await readTokenEncryptionHealth()).toMatchObject({ configured: false, config_error: 'key_invalid', active_kid: null, retired_kids: [] });
  });

  it('the report holds counts and key ids only: no token, no ciphertext, no key and no user id', async () => {
    configure({ active, retired });
    const rows = [sealedBy(ringOf(active), 'user-secret-uuid-1', 'a'), { user_id: 'user-secret-uuid-2', access_token: legacyToken('legacy-a'), refresh_token: legacyToken('legacy-r') }];
    useRows(rows);

    const rendered = JSON.stringify(await readTokenEncryptionHealth());

    for (const secret of [active.split(':')[1], retired.split(':')[1], rows[0].access_token as string, rows[0].refresh_token as string, legacyToken('legacy-a'), 'user-secret-uuid', 'enc:v1']) {
      expect(rendered).not.toContain(secret);
    }
  });

  it('a failed read throws instead of reporting zeros', async () => {
    configure({ active });
    const db = createFakeDb({ strava_tokens: [] }, { failWhen: () => ({ message: 'down', code: 'XX001' }) as never });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);

    await expect(readTokenEncryptionHealth()).rejects.toMatchObject({ code: 'XX001' });
  });

  it('counts the tokens that could not be read since start, once per unreadable result', async () => {
    configure({ node: 'test', active: entry('test-1') });
    const ring = ringOf(entry('test-1'));
    useRows([{ user_id: 'u1', ...sealedBy(ring, 'u1', 'a'), expires_at: 1 }]);
    expect(unreadableSinceStart()).toBe(0);

    // The key is gone: u1's token cannot be read, and Strava is not called (no fetch is stubbed, so a call would fail the test).
    vi.stubEnv(ACTIVE_KEY_ENV, '');
    expect(await getValidAccessToken('u1')).toEqual({ ok: false, reason: 'token_unreadable' });
    expect(await getValidAccessToken('u1')).toEqual({ ok: false, reason: 'token_unreadable' });
    // A missing connection is not an unreadable token.
    expect(await getValidAccessToken('nobody')).toEqual({ ok: false, reason: 'not_connected' });

    expect(unreadableSinceStart()).toBe(2);
    expect((await readTokenEncryptionHealth()).unreadable_since_start).toBe(2);
    recordUnreadableToken();
    expect(unreadableSinceStart()).toBe(3);
  });
});
