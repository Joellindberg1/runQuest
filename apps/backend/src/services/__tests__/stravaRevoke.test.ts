/**
 * The revoke step of "Disconnect" (services/stravaRevoke.ts, ADR 010 decision 7.4.2): POST /oauth/deauthorize with the user's
 * access token, tolerant by contract (the caller logs a warning and carries on), bounded in time, and never a lock of its own.
 * Database: createFakeDb. Network: installFakeStravaFetch, so a Strava URL the test did not configure fails the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { REVOKE_TIMEOUT_MS, revokeStravaAuthorization } from '../stravaRevoke.js';

let strava: FakeStrava | undefined;
const NOW = Math.floor(Date.now() / 1000);

const tokenRow = (over: Row = {}): Row => ({
  user_id: 'user-1',
  access_token: 'SECRET-ACCESS',
  refresh_token: 'SECRET-REFRESH',
  expires_at: NOW + 3600,
  connection_date: '2026-09-01T09:00:00+00:00',
  consent_version: '2026-10-14',
  ...over,
});

function useTokens(rows: Row[]) {
  const tables: Record<string, Row[]> = { strava_tokens: rows };
  const db = createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables, db };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks(); // before strava.restore(): a spy on fetch sits on top of the fake
  vi.unstubAllGlobals();
  strava?.restore();
  strava = undefined;
});

describe('revokeStravaAuthorization', () => {
  it('posts the access token to oauth/deauthorize as a form body and as a bearer header', async () => {
    useTokens([tokenRow()]);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'SECRET-ACCESS' } });

    await expect(revokeStravaAuthorization('user-1')).resolves.toBeUndefined();

    expect(strava.requests).toHaveLength(1);
    expect(strava.requests[0]).toMatchObject({
      route: 'oauthDeauthorize',
      method: 'POST',
      url: 'https://www.strava.com/oauth/deauthorize',
      body: { access_token: 'SECRET-ACCESS' },
    });
    expect(strava.requests[0].headers.authorization).toBe('Bearer SECRET-ACCESS');
    expect(strava.requests[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('renews an expired token first and revokes the new one', async () => {
    const { tables } = useTokens([tokenRow({ expires_at: NOW - 60 })]);
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', expires_at: NOW + 3600 }),
      oauthDeauthorize: { access_token: 'NEW-ACCESS' },
    });

    await revokeStravaAuthorization('user-1');

    expect(strava.requests.map((call) => call.route)).toEqual(['oauthToken', 'oauthDeauthorize']);
    expect(strava.requests[1].body).toEqual({ access_token: 'NEW-ACCESS' });
    expect(tables.strava_tokens[0]).toMatchObject({ access_token: 'NEW-ACCESS' });
  });

  it('does not call Strava and resolves when the user has no token row', async () => {
    useTokens([]);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'x' } });

    await expect(revokeStravaAuthorization('user-1')).resolves.toBeUndefined();

    expect(strava.requests).toEqual([]);
  });

  it('rejects with a code and does not revoke when the token cannot be renewed', async () => {
    useTokens([tokenRow({ expires_at: NOW - 60 })]);
    strava = installFakeStravaFetch({ oauthToken: stravaError(400), oauthDeauthorize: { access_token: 'x' } });

    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_refresh_failed' });

    expect(strava.calls.oauthDeauthorize).toBe(0);
  });

  it('rejects with a code when the token has expired and there is no refresh token', async () => {
    useTokens([tokenRow({ expires_at: NOW - 60, refresh_token: null })]);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'x' } });

    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_no_refresh_token' });

    expect(strava.requests).toEqual([]);
  });

  it.each([401, 403, 500, 503])('rejects with strava_%i when Strava answers that status', async (status) => {
    useTokens([tokenRow()]);
    strava = installFakeStravaFetch({ oauthDeauthorize: stravaError(status) });

    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: `strava_${status}` });
  });

  it('rejects with strava_network when the request fails', async () => {
    useTokens([tokenRow()]);
    strava = installFakeStravaFetch({
      oauthDeauthorize: () => {
        throw new TypeError('fetch failed: ECONNRESET for token SECRET-ACCESS');
      },
    });

    const error = await revokeStravaAuthorization('user-1').catch((e: Error & { code?: string }) => e);

    expect(error).toMatchObject({ code: 'strava_network' });
    expect((error as Error).message).not.toContain('SECRET-ACCESS');
  });

  it('gives up with strava_timeout when Strava does not answer, and honours the abort signal', async () => {
    useTokens([tokenRow()]);
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    });

    const started = Date.now();
    await expect(revokeStravaAuthorization('user-1', { timeoutMs: 30 })).rejects.toMatchObject({ code: 'strava_timeout' });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(true);
  });

  it('gives up with strava_timeout even when the request ignores the abort signal', async () => {
    useTokens([tokenRow()]);
    vi.stubGlobal('fetch', () => new Promise(() => {}));

    await expect(revokeStravaAuthorization('user-1', { timeoutMs: 30 })).rejects.toMatchObject({ code: 'strava_timeout' });
  });

  it('gives up with strava_timeout when the token renewal hangs', async () => {
    useTokens([tokenRow({ expires_at: NOW - 60 })]);
    vi.stubGlobal('fetch', () => new Promise(() => {}));

    await expect(revokeStravaAuthorization('user-1', { timeoutMs: 30 })).rejects.toMatchObject({ code: 'strava_timeout' });
  });

  it('has a default deadline of ten seconds', () => {
    expect(REVOKE_TIMEOUT_MS).toBe(10_000);
  });

  it('takes no lock of its own: it runs inside the caller lock', async () => {
    useTokens([tokenRow()]);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'SECRET-ACCESS' } });

    await expect(withUserLock('user-1', () => revokeStravaAuthorization('user-1'))).resolves.toBeUndefined();

    expect(strava.calls.oauthDeauthorize).toBe(1);
  });

  it('writes nothing: it only reads the connection', async () => {
    const { db } = useTokens([tokenRow()]);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'SECRET-ACCESS' } });

    await revokeStravaAuthorization('user-1');

    expect(db.queries.filter((q) => q.mutation !== undefined)).toEqual([]);
  });
});
