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
import { fetchDetailedActivity, getValidAccessToken } from '../stravaClient.js';

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
    expect(strava.requests[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-rt', client_id: 'client-id' });
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

    expect(result).toEqual({ ok: true, accessToken: 'old-at', refreshed: false, expiresAt: 9999999999, connectionDate: '2026-09-01' });
    expect(strava.requests).toHaveLength(0);
    expect(tokenWrites(db)).toHaveLength(0);
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
