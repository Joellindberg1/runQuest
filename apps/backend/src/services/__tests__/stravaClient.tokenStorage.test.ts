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

describe('the row is encrypted again while a refresh is under way (the backfill script)', () => {
  const NEW_TOKENS = { access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 };

  /** Runs a refresh that Strava answers only after `during` has changed the row, as the backfill script would. */
  async function refreshWhile(rows: Row[], during: (t: Record<string, Row[]>) => void, failWhen?: (q: RecordedQuery) => { message: string } | null) {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(NEW_TOKENS) });
    const world = use(rows, failWhen);
    const hold = holdTheTokenRequest();
    try {
      const pending = getValidAccessToken('user-1');
      await hold.reached;
      during(world.t);
      hold.release();
      return { result: await pending, ...world };
    } finally {
      hold.restore();
    }
  }

  it('follows the row to its new string and saves the new tokens there, instead of throwing them away', async () => {
    const { result, t, db } = await refreshWhile([{ ...TOKEN_ROW, expires_at: 100 }], (tables) => {
      // The same tokens, sealed again (a re-encryption to the active key): the string the refresh started from is gone.
      Object.assign(tables.strava_tokens[0], { access_token: storedToken('user-1', 'access_token', 'old-at'), refresh_token: storedToken('user-1', 'refresh_token', 'old-rt') });
    });

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 });
    expect(tokenWrites(db)).toHaveLength(2); // the first save matched nothing, the second was made on the new string
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does the same when the row was plaintext and has been encrypted meanwhile', async () => {
    const legacy = { ...TOKEN_ROW, access_token: legacyToken('old-at'), refresh_token: legacyToken('old-rt'), expires_at: 100 };
    const { result, t } = await refreshWhile([legacy], (tables) => {
      Object.assign(tables.strava_tokens[0], { access_token: storedToken('user-1', 'access_token', legacyToken('old-at')), refresh_token: storedToken('user-1', 'refresh_token', legacyToken('old-rt')) });
    });

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt' });
    expect(t.strava_tokens[0].refresh_token.startsWith('enc:v1:')).toBe(true);
  });

  it('still drops the answer when the row now holds another connection, and overwrites nothing', async () => {
    const { result, t } = await refreshWhile([{ ...TOKEN_ROW, expires_at: 100 }], (tables) => {
      Object.assign(tables.strava_tokens[0], { access_token: storedToken('user-1', 'access_token', 'other-at'), refresh_token: storedToken('user-1', 'refresh_token', 'other-rt') });
    });

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(result).not.toHaveProperty('mayHaveRotated');
    expect(plainRow(t.strava_tokens[0])).toMatchObject({ access_token: 'other-at', refresh_token: 'other-rt' });
    expect(vi.mocked(logger.warn).mock.calls.some((call) => String(call[0]).includes('superseded by a newer connection'))).toBe(true);
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('still drops the answer when the row is gone', async () => {
    const { result } = await refreshWhile([{ ...TOKEN_ROW, expires_at: 100 }], (tables) => {
      tables.strava_tokens.length = 0;
    });

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(result).not.toHaveProperty('mayHaveRotated');
  });

  it('gives up after a few tries when the row keeps changing, with the critical alarm and mayHaveRotated', async () => {
    let writes = 0;
    const rows: Row[] = [{ ...TOKEN_ROW, expires_at: 100 }];
    const { result } = await refreshWhile(
      rows,
      () => {},
      (q) => {
        if (q.table !== 'strava_tokens' || q.mutation !== 'update') return null;
        writes += 1;
        // Before every save the row is sealed again (same tokens), so the save never matches.
        Object.assign(rows[0], { refresh_token: storedToken('user-1', 'refresh_token', 'old-rt') });
        return null;
      },
    );

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed', mayHaveRotated: true });
    expect(writes).toBeLessThanOrEqual(4); // the first save and at most three follow-ups
    expect(vi.mocked(logger.error).mock.calls.some((call) => String(call[0]).includes('KRITISKT'))).toBe(true);
  });

  /** Every argument of every log call as text (objects such as CriticalAlert as JSON), to search for tokens. */
  const loggedText = () =>
    [logger.info, logger.warn, logger.error]
      .flatMap((spy) => vi.mocked(spy).mock.calls)
      .flatMap((call) => call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))))
      .join('\n');
  const kritiskt = () => vi.mocked(logger.error).mock.calls.filter((call) => String(call[0]).includes('KRITISKT'));
  const expectNoTokensLogged = () => {
    const text = loggedText();
    for (const secret of ['old-rt', 'old-at', 'new-rt', 'new-at', 'enc:v1:']) expect(text, secret).not.toContain(secret);
  };

  it.each([
    ['broken', () => 'enc:v1:test-1:AAAA:BBBB:CCCC'],
    ['sealed for another user', () => storedToken('user-2', 'refresh_token', 'old-rt')],
    ['sealed under a key that is not configured', () => sealedUnder(`other-1:${newKey()}`, 'user-1', 'refresh_token', 'old-rt')],
  ])('a row sealed again into a value that cannot be opened (%s) is a lost rotation, critical, and not "superseded"', async (_name, unreadable) => {
    const value = unreadable();
    const { result, t } = await refreshWhile([{ ...TOKEN_ROW, expires_at: 100 }], (tables) => {
      tables.strava_tokens[0].refresh_token = value;
    });

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed', mayHaveRotated: true });
    expect(kritiskt()).toHaveLength(1);
    expect(kritiskt()[0][1]).toMatchObject({ source: 'token_write' });
    expect(vi.mocked(logger.warn).mock.calls.some((call) => String(call[0]).includes('superseded'))).toBe(false);
    expect(t.strava_tokens[0].refresh_token).toBe(value); // nothing of ours was written over it
    expectNoTokensLogged();
  });

  it('a save that fails while following the row is a lost rotation, critical, and not "superseded"', async () => {
    let updates = 0;
    const rows: Row[] = [{ ...TOKEN_ROW, expires_at: 100 }];
    const { result } = await refreshWhile(
      rows,
      (tables) => {
        Object.assign(tables.strava_tokens[0], { refresh_token: storedToken('user-1', 'refresh_token', 'old-rt') }); // sealed again
      },
      (q) => {
        if (q.table !== 'strava_tokens' || q.mutation !== 'update') return null;
        updates += 1;
        return updates === 1 ? null : { message: 'the database is read-only: Key (refresh_token)=(old-rt)' }; // the first save misses, the follow-up errors
      },
    );

    expect(updates).toBe(2);
    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed', mayHaveRotated: true });
    expect(kritiskt()).toHaveLength(1);
    expect(vi.mocked(logger.warn).mock.calls.some((call) => String(call[0]).includes('superseded'))).toBe(false);
    expectNoTokensLogged();
  });

  it('the search for tokens in the log finds one in a message and in an alert object (so an empty result means something)', () => {
    logger.error('🚨 KRITISKT: example with old-rt in the text');
    logger.error('🚨 KRITISKT: example', { source: 'token_write', leaked: 'new-at' });

    const text = loggedText();
    expect(text).toContain('old-rt');
    expect(text).toContain('new-at');
    expect(() => expectNoTokensLogged()).toThrow();
  });

  it('the critical line and everything else logged carry no token, old or new, and no stored value, in any of the failing scenarios', async () => {
    // The row keeps changing: the longest path through the follow-up (three tries) and then the alarm.
    const rows: Row[] = [{ ...TOKEN_ROW, expires_at: 100 }];
    await refreshWhile(rows, () => {}, (q) => {
      if (q.table === 'strava_tokens' && q.mutation === 'update') Object.assign(rows[0], { refresh_token: storedToken('user-1', 'refresh_token', 'old-rt') });
      return null;
    });

    expect(kritiskt()).toHaveLength(1);
    expect(loggedText()).toContain('user-1'); // the user is named, which is what the owner needs
    expectNoTokensLogged();
  });

  it('an earlier save of ours that landed (its answer lost) counts as saved when the follow-up finds the new tokens in the row', async () => {
    let updates = 0;
    const rows: Row[] = [{ ...TOKEN_ROW, expires_at: 100 }];
    const { result, db } = await refreshWhile(
      rows,
      () => {},
      (q) => {
        if (q.table !== 'strava_tokens' || q.mutation !== 'update') return null;
        updates += 1;
        // The row holds our new tokens under another sealing; this save (on the string it started from) matches nothing.
        Object.assign(rows[0], { access_token: storedToken('user-1', 'access_token', 'new-at'), refresh_token: storedToken('user-1', 'refresh_token', 'new-rt'), expires_at: 9999999990 });
        return null;
      },
    );

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(updates).toBe(1); // nothing was written again over the tokens that were already there
    expect(tokenWrites(db)).toHaveLength(1);
    expect(kritiskt()).toHaveLength(0);
  });

  it('a row that has no refresh token any more when read again is not ours to save into: the answer is dropped without an alarm', async () => {
    const { result, t } = await refreshWhile([{ ...TOKEN_ROW, expires_at: 100 }], (tables) => {
      tables.strava_tokens[0].refresh_token = null;
    });

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(result).not.toHaveProperty('mayHaveRotated');
    expect(t.strava_tokens[0].refresh_token).toBeNull();
    expect(kritiskt()).toHaveLength(0);
    expect(vi.mocked(logger.warn).mock.calls.some((call) => String(call[0]).includes('superseded'))).toBe(true);
  });

  it('is unsure, and says so as critical, when the row cannot be read again after the save missed', async () => {
    let updated = false;
    const { result } = await refreshWhile(
      [{ ...TOKEN_ROW, expires_at: 100 }],
      (tables) => {
        Object.assign(tables.strava_tokens[0], { refresh_token: storedToken('user-1', 'refresh_token', 'old-rt') });
      },
      (q) => {
        if (q.table !== 'strava_tokens') return null;
        if (q.mutation === 'update') {
          updated = true;
          return null;
        }
        return updated ? { message: 'connection lost' } : null;
      },
    );

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed', mayHaveRotated: true });
    expect(vi.mocked(logger.error).mock.calls.some((call) => String(call[0]).includes('KRITISKT'))).toBe(true);
  });
});

describe('the reason a forced refresh gives in the log', () => {
  it('says Strava rejected the access token by default, and what the caller says when it is not that', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    use([{ ...TOKEN_ROW }]);

    await refreshAccessToken('user-1');
    await refreshAccessToken('user-1', { reason: 'Renewing the tokens on request' });

    const lines = vi.mocked(logger.info).mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('🔄 Strava rejected the access token, refreshing...');
    expect(lines).toContain('🔄 Renewing the tokens on request, refreshing...');
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
