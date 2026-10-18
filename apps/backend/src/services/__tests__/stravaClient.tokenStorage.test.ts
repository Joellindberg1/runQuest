/**
 * The token path of the Strava client with encrypted storage (ADR 013 decisions 5, 6 and 9): compare-and-swap on the stored string, one
 * sealing per refresh, the key check before Strava is called, and `token_unreadable` that is never read as a revoked authorisation.
 * Database: createFakeDb. Network: installFakeStravaFetch.
 */
import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV, buildSecretAad, parseKeyRing, seal } from '../../utils/secretBox.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';
import { encryptedRow, legacyToken, plainRow, storedToken } from '../../test-utils/stravaTokens.js';
import { installFakeStravaFetch, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { getValidAccessToken, refreshAccessToken, setStravaRequestHooks } from '../stravaClient.js';

let strava: FakeStrava | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const TOKEN_ROW = encryptedRow({ user_id: 'user-1', expires_at: 9999999999, connection_date: '2026-09-01' }, { access: 'old-at', refresh: 'old-rt' });
const REFRESH_TOKEN_INVALID = { resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' };

function use(tokens: Row[], failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const t: Record<string, Row[]> = { strava_tokens: tokens };
  const db = createFakeDb(t, { failWhen, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return { t, db };
}

const tokenWrites = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.table === 'strava_tokens' && q.mutation === 'update');

/** The values every update of strava_tokens was given, in order. */
function recordTokenUpdates(db: ReturnType<typeof use>['db']): Row[] {
  const values: Row[] = [];
  const from = db.client.from;
  db.client.from = (table: string) => {
    const builder = from(table);
    if (table === 'strava_tokens') {
      const update = builder.update;
      builder.update = (row: Row) => { values.push(row); return update(row); };
    }
    return builder;
  };
  return values;
}

const newKey = () => randomBytes(32).toString('base64');
const sealedUnder = (key: string, userId: string, column: 'access_token' | 'refresh_token', plain: string) =>
  seal(plain, buildSecretAad({ table: 'strava_tokens', column, userId }), parseKeyRing({ [ACTIVE_KEY_ENV]: key }));

/** Holds the token request at Strava until `release` is called; `reached` resolves once the request is waiting. */
function holdTheTokenRequest() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let signal!: () => void;
  const reached = new Promise<void>((resolve) => { signal = resolve; });
  const restore = setStravaRequestHooks({ before: async () => { signal(); await gate; } });
  return { release, reached, restore };
}

describe('saving the tokens of a refresh', () => {
  it('a refresh saves the new tokens encrypted and never as plaintext', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const { t, db } = use([{ ...TOKEN_ROW, expires_at: 100 }]);
    const writes = recordTokenUpdates(db);

    await getValidAccessToken('user-1');

    expect(writes).toHaveLength(1);
    expect(writes[0].access_token).toMatch(/^enc:v1:/);
    expect(writes[0].refresh_token).toMatch(/^enc:v1:/);
    expect(JSON.stringify(writes)).not.toContain('new-at');
    expect(JSON.stringify(writes)).not.toContain('new-rt');
    expect(JSON.stringify(t.strava_tokens)).not.toContain('new-rt');
  });

  it('the save is conditional on the exact string the row held, and the retry saves the very same ciphertext', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    let failFirst = true;
    const { t, db } = use([{ ...TOKEN_ROW, expires_at: 100 }], (q) => {
      if (q.table !== 'strava_tokens' || q.mutation !== 'update' || !failFirst) return null;
      failFirst = false;
      return { message: 'connection lost' };
    });
    const storedBefore = t.strava_tokens[0].refresh_token as string;
    const writes = recordTokenUpdates(db);

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]); // sealed once per refresh, not once per attempt
    for (const update of tokenWrites(db)) {
      expect(update.filters).toContainEqual({ op: 'eq', column: 'refresh_token', value: storedBefore });
    }
    expect(t.strava_tokens[0].refresh_token).toBe(writes[0].refresh_token);
  });

  it('a lost save answer is recognised by comparing plaintexts, even when the row holds another sealing of the same token', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const rows: Row[] = [{ ...TOKEN_ROW, expires_at: 100 }];
    let first = true;
    use(rows, (q) => {
      if (q.table !== 'strava_tokens' || q.mutation !== 'update' || !first) return null;
      first = false;
      // Applied, but not as the string our retry would write: sealing the same plaintext again gives a different string.
      Object.assign(rows[0], { access_token: storedToken('user-1', 'access_token', 'new-at'), refresh_token: storedToken('user-1', 'refresh_token', 'new-rt'), expires_at: 9999999990 });
      return { message: 'connection lost' };
    });

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
  });

  it('a rejection is still a rejection when the stored refresh token was only sealed again, with the same plaintext', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request', errors: [REFRESH_TOKEN_INVALID] } }) });
    const { t } = use([{ ...TOKEN_ROW, expires_at: 100 }]);
    const hold = holdTheTokenRequest();
    try {
      const pending = getValidAccessToken('user-1');
      await hold.reached;
      t.strava_tokens[0].refresh_token = storedToken('user-1', 'refresh_token', 'old-rt'); // the same token, another ciphertext
      hold.release();

      expect(await pending).toMatchObject({ ok: false, reason: 'refresh_rejected' });
    } finally {
      hold.restore();
    }
  });

  it('new tokens that cannot be sealed are a failed refresh with the critical alarm, nothing saved and no token in the log', async () => {
    // Strava has rotated the refresh token by now, so the connection is lost: that is what the alarm is for.
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'LONE-\ud800-SURROGATE', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const { t, db } = use([{ ...TOKEN_ROW, expires_at: 100 }]);
    const before = JSON.stringify(t.strava_tokens);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: false, reason: 'refresh_failed' });

    expect(tokenWrites(db)).toHaveLength(0);
    expect(JSON.stringify(t.strava_tokens)).toBe(before);
    const critical = vi.mocked(logger.error).mock.calls.filter((call) => String(call[0]).includes('KRITISKT'));
    expect(critical).toHaveLength(1);
    expect(String(critical[0][0])).toContain('user-1');
    expect(String(critical[0][0])).not.toContain('LONE-');
  });

  it('after a rotation a row sealed under the retired key is read, and the refresh seals the new tokens under the active key', async () => {
    const retired = `old-1:${newKey()}`;
    vi.stubEnv(ACTIVE_KEY_ENV, `new-1:${newKey()}`);
    vi.stubEnv(RETIRED_KEYS_ENV, retired);
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const { t } = use([{
      user_id: 'user-1',
      expires_at: 100,
      connection_date: '2026-09-01',
      access_token: sealedUnder(retired, 'user-1', 'access_token', 'old-at'),
      refresh_token: sealedUnder(retired, 'user-1', 'refresh_token', 'old-rt'),
    }]);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });

    expect(strava.requests[0].body).toMatchObject({ refresh_token: 'old-rt' });
    expect(t.strava_tokens[0].refresh_token).toMatch(/^enc:v1:new-1:/);
    expect(t.strava_tokens[0].access_token).toMatch(/^enc:v1:new-1:/);
  });
});

describe('rows that are still plaintext (the dual-read of the transition)', () => {
  it('a legacy plaintext row is read as it is, sent to Strava as it is, and replaced by an encrypted one after the refresh', async () => {
    const legacyAccess = legacyToken('legacy-at');
    const legacyRefresh = legacyToken('legacy-rt');
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const { t, db } = use([{ user_id: 'user-1', access_token: legacyAccess, refresh_token: legacyRefresh, expires_at: 100, connection_date: '2026-09-01' }]);

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(strava.requests[0].body).toMatchObject({ refresh_token: legacyRefresh });
    // The raw stored string is the plaintext here, and that is what the save is conditional on.
    expect(tokenWrites(db)[0].filters).toContainEqual({ op: 'eq', column: 'refresh_token', value: legacyRefresh });
    expect(t.strava_tokens[0].refresh_token).toMatch(/^enc:v1:/);
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt' });
  });

  it('a stored access token that has not expired is returned from a legacy plaintext row too', async () => {
    strava = installFakeStravaFetch({});
    use([{ user_id: 'user-1', access_token: legacyToken('legacy-at'), refresh_token: legacyToken('legacy-rt'), expires_at: 9999999999, connection_date: '2026-09-01' }]);

    await expect(getValidAccessToken('user-1')).resolves.toMatchObject({ ok: true, accessToken: legacyToken('legacy-at'), refreshed: false });
  });

  it('a row with no stored access token is renewed instead of handing out nothing', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    use([{ ...TOKEN_ROW, access_token: null }]);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
  });
});

describe('a backend without a key', () => {
  it('loads the token store and the client without a key, and only a call that needs a token reports the missing key', async () => {
    vi.stubEnv(ACTIVE_KEY_ENV, '');
    vi.stubEnv(RETIRED_KEYS_ENV, '');
    vi.resetModules();

    const store = await import('../stravaTokenStore.js');
    const client = await import('../stravaClient.js');

    expect(store.checkSealingReady()).toEqual({ ok: false, code: 'key_missing' });
    expect(typeof client.getValidAccessToken).toBe('function');
  });
});

describe('token_unreadable', () => {
  it('a refresh with a key that is missing or invalid does not call Strava, and nothing is written', async () => {
    for (const value of ['', 'prod-1:not-a-key', `prod-1:${newKey()}:extra`]) {
      vi.stubEnv(ACTIVE_KEY_ENV, value);
      strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt' }) });
      const { t, db } = use([{ ...TOKEN_ROW, expires_at: 100 }]);
      const before = JSON.stringify(t.strava_tokens);

      expect(await getValidAccessToken('user-1'), value).toEqual({ ok: false, reason: 'token_unreadable' });
      expect(await refreshAccessToken('user-1'), value).toEqual({ ok: false, reason: 'token_unreadable' });

      expect(strava.requests, value).toHaveLength(0);
      expect(tokenWrites(db), value).toHaveLength(0);
      expect(JSON.stringify(t.strava_tokens), value).toBe(before);
      strava.restore();
      strava = undefined;
    }
  });

  it('no key means no token at all: a valid stored token is not handed out either, encrypted or legacy', async () => {
    vi.stubEnv(ACTIVE_KEY_ENV, '');
    strava = installFakeStravaFetch({});
    use([{ ...TOKEN_ROW }]);
    expect(await getValidAccessToken('user-1')).toEqual({ ok: false, reason: 'token_unreadable' });

    use([{ user_id: 'user-1', access_token: legacyToken('legacy-at'), refresh_token: legacyToken('legacy-rt'), expires_at: 9999999999 }]);
    expect(await getValidAccessToken('user-1')).toEqual({ ok: false, reason: 'token_unreadable' });
  });

  it('a user without a connection is still not_connected without a key: there is no token to be unable to read', async () => {
    vi.stubEnv(ACTIVE_KEY_ENV, '');
    strava = installFakeStravaFetch({});
    use([]);

    expect(await getValidAccessToken('user-1')).toEqual({ ok: false, reason: 'not_connected' });
  });

  it('a stored value that cannot be read is token_unreadable, never refresh_rejected or not_connected, and Strava is not called', async () => {
    const broken: Array<[string, Row]> = [
      ['a broken enc: refresh token', { ...TOKEN_ROW, expires_at: 100, refresh_token: 'enc:v1:prod-1:AAAA' }],
      ['a refresh token sealed for another user', { ...TOKEN_ROW, expires_at: 100, refresh_token: storedToken('user-2', 'refresh_token', 'old-rt') }],
      ['a refresh token sealed under a key id the ring does not hold', { ...TOKEN_ROW, expires_at: 100, refresh_token: sealedUnder(`gone-1:${newKey()}`, 'user-1', 'refresh_token', 'old-rt') }],
      ['a refresh token sealed under another key with the same id', { ...TOKEN_ROW, expires_at: 100, refresh_token: sealedUnder(`test-1:${newKey()}`, 'user-1', 'refresh_token', 'old-rt') }],
      ['a plaintext of the wrong shape', { ...TOKEN_ROW, expires_at: 100, refresh_token: 'short' }],
      ['a plaintext with a colon', { ...TOKEN_ROW, expires_at: 100, refresh_token: 'looks:like:a:broken:ciphertext:xx' }],
    ];
    for (const [label, row] of broken) {
      strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
      const { t, db } = use([row]);
      const before = JSON.stringify(t.strava_tokens);

      expect(await getValidAccessToken('user-1'), label).toEqual({ ok: false, reason: 'token_unreadable' });
      expect(await refreshAccessToken('user-1'), label).toEqual({ ok: false, reason: 'token_unreadable' });

      expect(strava.requests, label).toHaveLength(0);
      expect(tokenWrites(db), label).toHaveLength(0);
      expect(JSON.stringify(t.strava_tokens), label).toBe(before);
      strava.restore();
      strava = undefined;
    }
  });

  it('a stored access token that cannot be read is token_unreadable and is not sent anywhere, whatever the shape of the damage', async () => {
    for (const damaged of ['enc:v2:something', 'short', 'enc:v1:test-1:AAAA:AAAA:AAAA', storedToken('user-2', 'access_token', 'old-at')]) {
      strava = installFakeStravaFetch({});
      use([{ ...TOKEN_ROW, access_token: damaged }]);

      expect(await getValidAccessToken('user-1'), damaged).toEqual({ ok: false, reason: 'token_unreadable' });
      expect(strava.requests, damaged).toHaveLength(0);
      strava.restore();
      strava = undefined;
    }
  });

  it('an unreadable token is logged with its code, the column and the user only, never the value', async () => {
    strava = installFakeStravaFetch({});
    use([{ ...TOKEN_ROW, expires_at: 100, refresh_token: 'enc:v1:prod-1:SECRETISH-chunk' }]);

    await getValidAccessToken('user-1');

    const lines = [...vi.mocked(logger.error).mock.calls, ...vi.mocked(logger.warn).mock.calls].map((call) => call.map(String).join(' '));
    expect(lines.some((line) => line.includes('user-1') && line.includes('bad_format') && line.includes('refresh_token'))).toBe(true);
    expect(lines.join('\n')).not.toContain('SECRETISH');
    expect(lines.join('\n')).not.toContain('KRITISKT');
  });
});
