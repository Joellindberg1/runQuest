/**
 * What the Strava client writes to the log (ADR 010 decision 8.6): our user id and a status or an error CODE, never a token, a Strava
 * error body, a Strava id, a coordinate or a title. Every path that can fail is driven with a body or an error full of such values,
 * and then everything that was logged is searched for them.
 *
 * Database: createFakeDb. Network: installFakeStravaFetch, except where a test needs a body that is not JSON.
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
import { createFakeDb, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { fetchDetailedActivity, getValidAccessToken, refreshAccessToken } from '../stravaClient.js';

const LEAK = 'failed for external_id 987654321 at 59.3293,18.0686 "My secret morning run" token AT-leak-7f3';
const SECRETS = ['987654321', '59.3293', '18.0686', 'secret morning', 'AT-leak-7f3', 'AT-old-7f3', 'RT-old-7f3', 'AT-new-7f3', 'RT-new-7f3', 'FRAGMENT-7f3'];
const leaky = (code = 'XX000'): Error => Object.assign(new Error(LEAK), { code, details: LEAK, hint: LEAK });

let strava: FakeStrava | undefined;
let lines: string[];

beforeEach(() => {
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  strava?.restore();
  strava = undefined;
});

const EXPIRED: Row = { user_id: 'user-1', access_token: 'AT-old-7f3', refresh_token: 'RT-old-7f3', expires_at: 100, connection_date: '2026-09-01' };

function use(rows: Row[], failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb({ strava_tokens: rows }, { failWhen, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return rows;
}

function expectNothingSecretLogged() {
  expect(lines.filter((line) => SECRETS.some((secret) => line.includes(secret)))).toEqual([]);
  expect(lines.filter((line) => line.includes('    at '))).toEqual([]); // no stack
}

describe('stravaClient logging', () => {
  it('stravaClient never logs a token, a Strava error body, an activity id or coordinates', async () => {
    const leakyBody = { message: LEAK, errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: LEAK }] };
    const newTokens = stravaTokenResponse({ access_token: 'AT-new-7f3', refresh_token: 'RT-new-7f3', expires_at: 9999999990 });

    // A refresh Strava rejects, and refreshes it answers with an error, all with a body full of values.
    for (const status of [400, 401, 429, 500]) {
      strava = installFakeStravaFetch({ oauthToken: stravaError(status, { body: leakyBody }) });
      use([{ ...EXPIRED }]);
      await getValidAccessToken('user-1');
      await refreshAccessToken('user-1');
      strava.restore();
      strava = undefined;
    }
    expect(lines.some((line) => line.includes('user-1') && line.includes('400'))).toBe(true);

    // A network error whose message carries values.
    strava = installFakeStravaFetch({ oauthToken: () => { throw leaky('ECONNRESET'); } });
    use([{ ...EXPIRED }]);
    await getValidAccessToken('user-1');
    strava.restore();
    strava = undefined;

    // A successful answer that is not valid JSON: the SyntaxError message holds a piece of the body.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"access_token":"FRAGMENT-7f3', { status: 200 })));
    use([{ ...EXPIRED }]);
    await getValidAccessToken('user-1');
    vi.unstubAllGlobals();

    // The new tokens cannot be saved: the retry line and the critical line.
    strava = installFakeStravaFetch({ oauthToken: newTokens });
    use([{ ...EXPIRED }], (q) => (q.table === 'strava_tokens' && q.mutation === 'update' ? (leaky('U0001') as never) : null));
    await getValidAccessToken('user-1');
    expect(lines.some((line) => line.includes('KRITISKT') && line.includes('user-1') && line.includes('U0001'))).toBe(true);
    strava.restore();
    strava = undefined;

    // The new tokens are superseded by a reconnect while the refresh was under way.
    strava = installFakeStravaFetch({ oauthToken: newTokens });
    const rows = use([{ ...EXPIRED }], (q) => {
      if (q.table === 'strava_tokens' && q.mutation === 'update') Object.assign(rows[0], { refresh_token: 'RT-reconnect-7f3' });
      return null;
    });
    await getValidAccessToken('user-1');
    strava.restore();
    strava = undefined;

    // The token row cannot be read.
    use([{ ...EXPIRED }], (q) => (q.table === 'strava_tokens' && q.select !== null ? (leaky('R0001') as never) : null));
    await getValidAccessToken('user-1');
    expect(lines.some((line) => line.includes('user-1') && line.includes('R0001'))).toBe(true);
    vi.mocked(getSupabaseClient).mockImplementation(() => { throw leaky('R0002'); });
    await getValidAccessToken('user-1');

    // The detail call: an error status and a thrown error, for an activity whose id must stay out of the log.
    strava = installFakeStravaFetch({ activities: {} });
    await fetchDetailedActivity(987654321, 'AT-old-7f3');
    strava.restore();
    strava = undefined;
    vi.stubGlobal('fetch', vi.fn(async () => { throw leaky('ECONNRESET'); }));
    await fetchDetailedActivity(987654321, 'AT-old-7f3');

    expect(lines.length).toBeGreaterThan(0);
    expectNothingSecretLogged();
  });

  it('the refresh that succeeds logs no token', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'AT-new-7f3', refresh_token: 'RT-new-7f3', expires_at: 9999999990 }) });
    use([{ ...EXPIRED }]);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: true, accessToken: 'AT-new-7f3' });

    expect(lines.length).toBeGreaterThan(0);
    expectNothingSecretLogged();
  });
});
