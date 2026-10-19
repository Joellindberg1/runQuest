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
import { plainRow, tokenCols } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { REVOKE_TIMEOUT_MS, revokeStravaAuthorization } from '../stravaRevoke.js';

let strava: FakeStrava | undefined;
const NOW = Math.floor(Date.now() / 1000);

const tokenRow = (over: Row = {}): Row => ({
  user_id: 'user-1',
  ...tokenCols('user-1', 'SECRET-ACCESS', 'SECRET-REFRESH'),
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
    expect(plainRow(tables.strava_tokens[0])).toMatchObject({ access_token: 'NEW-ACCESS' });
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

  it('rejects with strava_refresh_rejected, and does not revoke, when Strava rejects the refresh token', async () => {
    useTokens([tokenRow({ expires_at: NOW - 60 })]);
    strava = installFakeStravaFetch({
      oauthToken: stravaError(401, { body: { message: 'Authorization Error', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } }),
      oauthDeauthorize: { access_token: 'x' },
    });

    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_refresh_rejected' });

    expect(strava.calls.oauthDeauthorize).toBe(0);
  });

  it('rejects with strava_token_read_failed, not silently, when the token row cannot be read', async () => {
    const db = createFakeDb({ strava_tokens: [tokenRow()] }, { failWhen: (q) => (q.table === 'strava_tokens' ? { message: 'connection reset' } : null) });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'x' } });

    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_token_read_failed' });

    expect(strava.requests).toEqual([]);
  });

  it('rejects with strava_token_unreadable, not silently and without calling Strava, when the stored token cannot be read', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse(), oauthDeauthorize: { access_token: 'x' } });
    for (const row of [tokenRow({ access_token: 'enc:v1:test-1:AAAA' }), tokenRow({ expires_at: NOW - 60, refresh_token: 'short' })]) {
      useTokens([row]);

      await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_token_unreadable' });
    }

    useTokens([tokenRow()]);
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_token_unreadable' });
    vi.unstubAllEnvs();

    expect(strava.requests).toEqual([]);
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

    // Counts calls instead of measuring wall time: the deadline is built from the injected limit, never from the 10 s default,
    // so a hanging Strava is cut off at the limit the caller chose. A slow runner cannot make that fail.
    const deadlines = vi.spyOn(AbortSignal, 'timeout');
    await expect(revokeStravaAuthorization('user-1', { timeoutMs: 30 })).rejects.toMatchObject({ code: 'strava_timeout' });

    expect(deadlines).toHaveBeenCalledWith(30);
    expect(deadlines).not.toHaveBeenCalledWith(REVOKE_TIMEOUT_MS);
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(true);
  });

  it('gives up with strava_timeout even when the request ignores the abort signal', async () => {
    useTokens([tokenRow()]);
    vi.stubGlobal('fetch', () => new Promise(() => {}));

    await expect(revokeStravaAuthorization('user-1', { timeoutMs: 30 })).rejects.toMatchObject({ code: 'strava_timeout' });
  });

  it('reports a timeout of the Strava call itself as strava_timeout, not as a network error', async () => {
    useTokens([tokenRow()]);
    vi.stubGlobal('fetch', () => Promise.reject(Object.assign(new Error('Strava did not answer in time'), { name: 'TimeoutError' })));

    await expect(revokeStravaAuthorization('user-1')).rejects.toMatchObject({ code: 'strava_timeout' });
  });

  it('gives up with strava_timeout when the token renewal hangs', async () => {
    useTokens([tokenRow({ expires_at: NOW - 60 })]);
    vi.stubGlobal('fetch', () => new Promise(() => {}));

    await expect(revokeStravaAuthorization('user-1', { timeoutMs: 30 })).rejects.toMatchObject({ code: 'strava_timeout' });
  });

  it.each([401, 500, 200])('never reads the body of a %i answer, releases it, and reports only the status', async (status) => {
    useTokens([tokenRow()]);
    const body = JSON.stringify({ message: 'failed for athlete 424242 token SECRET-ACCESS' });
    const response = new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    const reads = (['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes'] as const).map((method) => vi.spyOn(response, method as 'text'));
    const cancel = vi.spyOn(response.body!, 'cancel');
    vi.stubGlobal('fetch', async () => response);

    const outcome = await revokeStravaAuthorization('user-1').then(() => null, (e: Error & { code?: string }) => e);

    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    if (status === 200) {
      expect(outcome).toBeNull();
    } else {
      expect(outcome).toMatchObject({ code: `strava_${status}` });
      expect(outcome!.message).not.toContain('SECRET-ACCESS');
      expect(outcome!.message).not.toContain('424242');
    }
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
