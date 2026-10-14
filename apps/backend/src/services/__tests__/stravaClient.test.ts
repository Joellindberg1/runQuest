/**
 * The shared Strava client (ADR 010 decision 7): one token path and one fetch path for polling, GET /status and the webhook worker.
 * Database: createFakeDb. Network: installFakeStravaFetch, so a call to a URL the test did not configure fails the test.
 */
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
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaActivity, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { fetchAthleteActivities, fetchDetailedActivity, getValidAccessToken, refreshAccessToken, setStravaRequestHooks, stravaFetch } from '../stravaClient.js';

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
  vi.restoreAllMocks();
});

const TOKEN_ROW = { user_id: 'user-1', access_token: 'old-at', refresh_token: 'old-rt', expires_at: 9999999999, connection_date: '2026-09-01' };

function use(tokens: Row[], failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const t: Record<string, Row[]> = { strava_tokens: tokens };
  const db = createFakeDb(t, { failWhen, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { t, db };
}

const tokenWrites = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.table === 'strava_tokens' && q.mutation === 'update');

describe('getValidAccessToken', () => {
  it('getValidAccessToken refreshes an expired token once and saves the new tokens', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const { t, db } = use([{ ...TOKEN_ROW, expires_at: 100 }]);

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(strava.calls.oauthToken).toBe(1);
    expect(strava.requests[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-rt', client_id: 'client-id', client_secret: 'client-secret' });
    expect(tokenWrites(db)).toHaveLength(1);
    expect(t.strava_tokens[0]).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 });
  });

  it('getValidAccessToken logs a critical error when saving refreshed tokens keeps failing', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at' }) });
    const { db } = use(
      [{ ...TOKEN_ROW, expires_at: 100 }],
      (q) => (q.table === 'strava_tokens' && q.mutation === 'update' ? { message: 'write failed' } : null),
    );

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(tokenWrites(db)).toHaveLength(2); // the first attempt and one retry
    const critical = vi.mocked(logger.error).mock.calls.filter((call) => String(call[0]).includes('KRITISKT'));
    expect(critical).toHaveLength(1);
    expect(String(critical[0][0])).toContain('user-1');
  });

  it('getValidAccessToken reports a user without a Strava connection', async () => {
    strava = installFakeStravaFetch({});
    use([]);

    const result = await getValidAccessToken('user-1');

    expect(result).toEqual({ ok: false, reason: 'not_connected' });
    expect(strava.requests).toHaveLength(0);
  });

  it('getValidAccessToken returns a valid token as is, without calling Strava or writing', async () => {
    strava = installFakeStravaFetch({});
    const { db } = use([{ ...TOKEN_ROW }]);

    const result = await getValidAccessToken('user-1');

    expect(result).toEqual({ ok: true, accessToken: 'old-at', refreshed: false, expiresAt: 9999999999, connectionDate: '2026-09-01', consentVersion: null });
    expect(strava.requests).toHaveLength(0);
    expect(tokenWrites(db)).toHaveLength(0);
  });

  it('getValidAccessToken carries the stored consent version on success and on a failed refresh', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request' } }) });
    use([{ ...TOKEN_ROW, consent_version: 'v1' }]);
    await expect(getValidAccessToken('user-1')).resolves.toMatchObject({ ok: true, consentVersion: 'v1' });

    use([{ ...TOKEN_ROW, expires_at: 100, consent_version: 'v1' }]);
    await expect(getValidAccessToken('user-1')).resolves.toMatchObject({ ok: false, reason: 'refresh_failed', consentVersion: 'v1' });
  });

  it('getValidAccessToken does not rotate the stored token when Strava rejects the refresh', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request' } }) });
    const { t, db } = use([{ ...TOKEN_ROW, expires_at: 100 }]);

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed', expiresAt: 100, connectionDate: '2026-09-01' });
    expect(tokenWrites(db)).toHaveLength(0);
    expect(t.strava_tokens[0].access_token).toBe('old-at');
  });

  it('getValidAccessToken reports an expired token without a refresh token without calling Strava', async () => {
    strava = installFakeStravaFetch({});
    use([{ ...TOKEN_ROW, expires_at: 100, refresh_token: null }]);

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: false, reason: 'no_refresh_token', expiresAt: 100 });
    expect(strava.requests).toHaveLength(0);
  });
});

describe('refreshAccessToken', () => {
  it('refreshAccessToken renews a token that has not expired and saves the new tokens', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const { t } = use([{ ...TOKEN_ROW }]);

    const result = await refreshAccessToken('user-1');

    expect(result).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true, connectionDate: '2026-09-01' });
    expect(strava.calls.oauthToken).toBe(1);
    expect(strava.requests[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-rt' });
    expect(t.strava_tokens[0]).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt' });
  });

  it('refreshAccessToken reports a user without a connection, and a connection without a refresh token, without calling Strava', async () => {
    strava = installFakeStravaFetch({});
    use([]);
    expect(await refreshAccessToken('user-1')).toEqual({ ok: false, reason: 'not_connected' });

    use([{ ...TOKEN_ROW, refresh_token: null }]);
    expect(await refreshAccessToken('user-1')).toMatchObject({ ok: false, reason: 'no_refresh_token' });
    expect(strava.calls.oauthToken).toBe(0);
  });

  it('refreshAccessToken reports a refresh Strava rejects and leaves the stored token alone', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400) });
    const { t } = use([{ ...TOKEN_ROW }]);

    expect(await refreshAccessToken('user-1')).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(t.strava_tokens[0]).toMatchObject({ access_token: 'old-at', refresh_token: 'old-rt' });
  });
});

// What Strava's token endpoint answers for an invalid or revoked refresh token. ASSUMED shapes, to be checked against real Strava in the
// release preview: 400 {"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]} and
// 401 {"message":"Authorization Error", ...}. See isRefreshTokenRejection in stravaClient.ts.
const REFRESH_TOKEN_INVALID = { resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' };

describe('why a token refresh failed', () => {
  const EXPIRED = { ...TOKEN_ROW, expires_at: 100, consent_version: 'v1' };
  const STATE = { expiresAt: 100, connectionDate: '2026-09-01', consentVersion: 'v1' };

  it('token refresh rejected by Strava is reported as refresh_rejected, not refresh_failed', async () => {
    const rejections: Array<[string, number, unknown]> = [
      ['400 naming the refresh token', 400, { message: 'Bad Request', errors: [REFRESH_TOKEN_INVALID] }],
      ['400 naming only the field', 400, { message: 'Bad Request', errors: [{ field: 'refresh_token', code: 'invalid' }] }],
      ['400 naming only the resource', 400, { message: 'Bad Request', errors: [{ resource: 'RefreshToken' }] }],
      ['401 Authorization Error naming the refresh token', 401, { message: 'Authorization Error', errors: [REFRESH_TOKEN_INVALID] }],
      ['400 invalid_grant', 400, { error: 'invalid_grant' }],
    ];
    for (const [label, status, body] of rejections) {
      strava = installFakeStravaFetch({ oauthToken: stravaError(status, { body }) });
      const { t, db } = use([{ ...EXPIRED }]);

      expect(await getValidAccessToken('user-1'), label).toEqual({ ok: false, reason: 'refresh_rejected', ...STATE });
      expect(await refreshAccessToken('user-1'), label).toEqual({ ok: false, reason: 'refresh_rejected', ...STATE });
      expect(tokenWrites(db), label).toHaveLength(0);
      expect(t.strava_tokens[0], label).toMatchObject({ access_token: 'old-at', refresh_token: 'old-rt' });

      strava.restore();
      strava = undefined;
    }
  });

  it('a network error, 5xx or 429 on token refresh stays refresh_failed', async () => {
    const answers: Array<[string, () => ReturnType<typeof stravaError> | never]> = [
      ['network error', () => { throw new Error('connect ECONNRESET'); }],
      ['500', () => stravaError(500)],
      ['502', () => stravaError(502, { body: { message: 'Bad Gateway' } })],
      ['503 naming the refresh token', () => stravaError(503, { body: { message: 'Unavailable', errors: [REFRESH_TOKEN_INVALID] } })],
      ['429', () => stravaError(429)],
    ];
    for (const [label, answer] of answers) {
      strava = installFakeStravaFetch({ oauthToken: answer });
      const { t, db } = use([{ ...EXPIRED }]);

      expect(await getValidAccessToken('user-1'), label).toEqual({ ok: false, reason: 'refresh_failed', ...STATE });
      expect(await refreshAccessToken('user-1'), label).toEqual({ ok: false, reason: 'refresh_failed', ...STATE });
      expect(tokenWrites(db), label).toHaveLength(0);
      expect(t.strava_tokens[0].refresh_token, label).toBe('old-rt');

      strava.restore();
      strava = undefined;
    }
  });

  it('an answer that does not clearly name the refresh token stays refresh_failed', async () => {
    // A wrong "rejected" would let a forged deauthorize event delete a user's runs, so only a recognisable refresh-token error counts.
    const answers: Array<[string, number, unknown]> = [
      ['400 without detail', 400, { message: 'Bad Request' }],
      ['400 with an empty error list', 400, { message: 'Bad Request', errors: [] }],
      ['400 with errors that is not a list', 400, { message: 'Bad Request', errors: 'refresh_token' }],
      ['401 without a body', 401, null],
      ['401 with a text body', 401, 'Authorization Error'],
      ['401 with another message', 401, { message: 'Something else' }],
      ['400 about the client id', 400, { message: 'Bad Request', errors: [{ resource: 'Application', field: 'client_id', code: 'invalid' }] }],
      ['401 Authorization Error about the client secret', 401, { message: 'Authorization Error', errors: [{ resource: 'Application', field: 'client_secret', code: 'invalid' }] }],
      // Strava uses "Authorization Error" for every 401, a wrong client secret included, so the message alone proves nothing.
      ['401 Authorization Error alone', 401, { message: 'Authorization Error' }],
      ['401 Authorization Error about the athlete token', 401, { message: 'Authorization Error', errors: [{ resource: 'Athlete', field: 'access_token', code: 'invalid' }] }],
      ['401 Authorization Error naming both the application and the refresh token', 401, { message: 'Authorization Error', errors: [{ resource: 'Application', field: 'client_id' }, REFRESH_TOKEN_INVALID] }],
      ['401 naming the application by resource only, with an empty field, and the refresh token', 401, { message: 'Authorization Error', errors: [{ resource: 'Application', field: '' }, REFRESH_TOKEN_INVALID] }],
      ['403 naming the refresh token', 403, { message: 'Forbidden', errors: [REFRESH_TOKEN_INVALID] }],
      ['404 naming the refresh token', 404, { message: 'Not Found', errors: [REFRESH_TOKEN_INVALID] }],
    ];
    for (const [label, status, body] of answers) {
      strava = installFakeStravaFetch({ oauthToken: stravaError(status, { body }) });
      use([{ ...EXPIRED }]);

      expect(await getValidAccessToken('user-1'), label).toMatchObject({ ok: false, reason: 'refresh_failed' });

      strava.restore();
      strava = undefined;
    }
  });

  it('missing Strava credentials stay refresh_failed without calling Strava', async () => {
    strava = installFakeStravaFetch({});
    use([{ ...EXPIRED }]);
    const id = process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_ID;
    try {
      expect(await getValidAccessToken('user-1')).toMatchObject({ ok: false, reason: 'refresh_failed' });
    } finally {
      process.env.STRAVA_CLIENT_ID = id;
    }
    expect(strava.requests).toHaveLength(0);
  });

  it('a token answer without the new tokens is a failed refresh and nothing is saved', async () => {
    strava = installFakeStravaFetch({ oauthToken: { token_type: 'Bearer', access_token: 'new-at' } as never });
    const { t, db } = use([{ ...EXPIRED }]);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(tokenWrites(db)).toHaveLength(0);
    expect(t.strava_tokens[0].refresh_token).toBe('old-rt');
  });

  it('a database error while reading the token row is not reported as not connected', async () => {
    strava = installFakeStravaFetch({});
    const readFails = (q: RecordedQuery) => (q.table === 'strava_tokens' && q.select !== null ? { message: 'connection reset' } : null);
    use([{ ...TOKEN_ROW }], readFails);

    expect(await getValidAccessToken('user-1')).toEqual({ ok: false, reason: 'token_read_failed' });
    expect(await refreshAccessToken('user-1')).toEqual({ ok: false, reason: 'token_read_failed' });

    // A client that cannot even be created is a failed read too.
    vi.mocked(getSupabaseClient).mockImplementation(() => { throw new Error('no database configured'); });
    expect(await getValidAccessToken('user-1')).toEqual({ ok: false, reason: 'token_read_failed' });

    // Only a row that is really missing is "not connected".
    use([]);
    expect(await getValidAccessToken('user-1')).toEqual({ ok: false, reason: 'not_connected' });
    expect(strava.requests).toHaveLength(0);
  });

  /** Holds the token request at Strava until `release` is called; `reached` resolves once the request is waiting. */
  function holdTheTokenRequest() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signal!: () => void;
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    const restore = setStravaRequestHooks({ before: async () => { signal(); await gate; } });
    return { release, reached, restore };
  }

  it('a late token refresh never overwrites a newer connection', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'late-at', refresh_token: 'late-rt', expires_at: 9999999990 }) });
    const { t } = use([{ ...EXPIRED }]);
    const reconnected: Row = { user_id: 'user-1', access_token: 'reconnect-at', refresh_token: 'reconnect-rt', expires_at: 9999999000, connection_date: '2026-10-15' };
    const hold = holdTheTokenRequest();
    try {
      // The refresh hangs at Strava while the user reconnects.
      const late = getValidAccessToken('user-1');
      await hold.reached;
      t.strava_tokens.splice(0, 1, { ...reconnected });
      hold.release();

      const result = await late;

      // The late answer is not trusted: it belongs to the old connection.
      expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
      expect(JSON.stringify(result)).not.toContain('late-at');
      expect(t.strava_tokens).toEqual([reconnected]);
    } finally {
      hold.restore();
    }
  });

  it('a rejection that arrives after the stored refresh token was replaced is not a rejected refresh token', async () => {
    // Two callers refresh at once with the same token; the second one's answer can be a rejection only because the first one's
    // refresh already replaced it. That says nothing about the authorisation, and must not confirm a deauthorize.
    strava = installFakeStravaFetch({ oauthToken: stravaError(400, { body: { message: 'Bad Request', errors: [REFRESH_TOKEN_INVALID] } }) });
    const { t } = use([{ ...EXPIRED }]);
    const hold = holdTheTokenRequest();
    try {
      const second = getValidAccessToken('user-1');
      await hold.reached;
      Object.assign(t.strava_tokens[0], { access_token: 'first-at', refresh_token: 'first-rt', expires_at: 9999999990 });
      hold.release();

      expect(await second).toMatchObject({ ok: false, reason: 'refresh_failed' });
      expect(t.strava_tokens[0]).toMatchObject({ access_token: 'first-at', refresh_token: 'first-rt' });
    } finally {
      hold.restore();
    }
  });

  it('a rejection is not trusted when the stored refresh token cannot be checked again', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(401, { body: { message: 'Authorization Error', errors: [REFRESH_TOKEN_INVALID] } }) });
    let reads = 0;
    use([{ ...EXPIRED }], (q) => (q.table === 'strava_tokens' && q.select !== null && ++reads === 2 ? { message: 'connection reset' } : null));

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: false, reason: 'refresh_failed' });
  });

  it('a rejection that arrives after the user was disconnected is not a rejected refresh token', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(401, { body: { message: 'Authorization Error', errors: [REFRESH_TOKEN_INVALID] } }) });
    const { t } = use([{ ...EXPIRED }]);
    const hold = holdTheTokenRequest();
    try {
      const pending = getValidAccessToken('user-1');
      await hold.reached;
      t.strava_tokens.splice(0, 1);
      hold.release();

      expect(await pending).toMatchObject({ ok: false, reason: 'refresh_failed' });
      expect(t.strava_tokens).toEqual([]);
    } finally {
      hold.restore();
    }
  });

  it('a save lost after it was applied, followed by a reconnect, is a failed refresh that leaves the new connection alone', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'late-at', refresh_token: 'late-rt', expires_at: 9999999990 }) });
    const reconnected: Row = { user_id: 'user-1', access_token: 'reconnect-at', refresh_token: 'reconnect-rt', expires_at: 9999999000, connection_date: '2026-10-15' };
    const rows: Row[] = [{ ...EXPIRED }];
    let first = true;
    use(rows, (q) => {
      if (q.table !== 'strava_tokens' || q.mutation !== 'update' || !first) return null;
      first = false;
      // The first save is applied, its answer is lost, and the user reconnects before the retry.
      Object.assign(rows[0], { access_token: 'late-at', refresh_token: 'late-rt', expires_at: 9999999990 });
      rows.splice(0, 1, { ...reconnected });
      return { message: 'connection lost' };
    });

    const result = await getValidAccessToken('user-1');

    expect(result).toMatchObject({ ok: false, reason: 'refresh_failed' });
    expect(JSON.stringify(result)).not.toContain('late-at');
    expect(rows).toEqual([reconnected]);
  });

  it('a late token refresh does not bring a disconnected user back', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'late-at', refresh_token: 'late-rt' }) });
    const { t } = use([{ ...EXPIRED }]);
    const hold = holdTheTokenRequest();
    try {
      const late = getValidAccessToken('user-1');
      await hold.reached;
      t.strava_tokens.splice(0, 1);
      hold.release();

      expect(await late).toMatchObject({ ok: false, reason: 'refresh_failed' });
      expect(t.strava_tokens).toEqual([]);
    } finally {
      hold.restore();
    }
  });

  it('a token save that reported an error after it was applied is recognised as saved', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }) });
    const rows: Row[] = [{ ...EXPIRED }];
    let first = true;
    use(rows, (q) => {
      if (q.table !== 'strava_tokens' || q.mutation !== 'update' || !first) return null;
      first = false;
      Object.assign(rows[0], { access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }); // committed, then the answer was lost
      return { message: 'connection lost' };
    });

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: true, accessToken: 'new-at', refreshed: true });
    expect(rows[0]).toMatchObject({ access_token: 'new-at', refresh_token: 'new-rt' });
  });
});

describe('the central fetch path', () => {
  let restoreHooks: (() => void) | undefined;
  afterEach(() => restoreHooks?.());

  it('runs the before hook ahead of the request, waits for it, and runs the after hook with the response', async () => {
    strava = installFakeStravaFetch({ activities: { 7010: stravaActivity({ id: 7010 }) } });
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    restoreHooks = setStravaRequestHooks({
      before: async (url) => { events.push(`before ${url}`); await gate; events.push('released'); },
      after: (url, response) => { events.push(`after ${response.status} ${url}`); },
    });
    const url = 'https://www.strava.com/api/v3/activities/7010';

    const pending = stravaFetch(url);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(strava.requests).toHaveLength(0); // the request is held back while the before hook is pending
    release();
    await pending;

    expect(events).toEqual([`before ${url}`, 'released', `after 200 ${url}`]);
    expect(strava.requests).toHaveLength(1);
  });

  it('shows the after hook error responses too', async () => {
    strava = installFakeStravaFetch({ activities: {} });
    const seen: number[] = [];
    restoreHooks = setStravaRequestHooks({ after: (_url, response) => { seen.push(response.status); } });

    await stravaFetch('https://www.strava.com/api/v3/activities/7011');

    expect(seen).toEqual([404]);
  });

  it('puts the previous hooks back when the returned function is called', async () => {
    strava = installFakeStravaFetch({ activities: { 7012: stravaActivity({ id: 7012 }) } });
    const seen: string[] = [];
    const restore = setStravaRequestHooks({ before: (url) => { seen.push(url); } });
    restore();

    await stravaFetch('https://www.strava.com/api/v3/activities/7012');

    expect(seen).toEqual([]);
  });

  it('sends the detail call, the activity list and the token refresh through the hooks', async () => {
    strava = installFakeStravaFetch({
      activities: { 7013: stravaActivity({ id: 7013 }) },
      athleteActivities: [],
      oauthToken: stravaTokenResponse(),
    });
    use([{ ...TOKEN_ROW, expires_at: 100 }]);
    const seen: string[] = [];
    restoreHooks = setStravaRequestHooks({ before: (url) => { seen.push(url); } });

    await fetchDetailedActivity(7013, 'at');
    await fetchAthleteActivities('at', 1_700_000_000);
    await getValidAccessToken('user-1');

    expect(seen).toEqual(strava.requests.map((request) => request.url));
    expect(seen).toEqual([
      'https://www.strava.com/api/v3/activities/7013',
      'https://www.strava.com/api/v3/athlete/activities?after=1700000000&per_page=200',
      'https://www.strava.com/oauth/token',
    ]);
  });
});

describe('fetchDetailedActivity', () => {
  it('returns the detailed activity, fetched with the bearer token', async () => {
    strava = installFakeStravaFetch({ activities: { 7001: stravaActivity({ id: 7001, name: 'Detail' }) } });

    const activity = await fetchDetailedActivity(7001, 'the-token');

    expect(activity).toMatchObject({ id: 7001, name: 'Detail' });
    expect(strava.requests[0].headers.authorization).toBe('Bearer the-token');
  });

  it('returns null, not an error, when Strava answers 404', async () => {
    strava = installFakeStravaFetch({ activities: {} });

    await expect(fetchDetailedActivity(7002, 'the-token')).resolves.toBeNull();
    expect(strava.activityCalls(7002)).toBe(1);
  });
});
