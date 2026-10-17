/**
 * The token-write alarm of the Strava client as a Sentry alert: a rotated token that cannot be saved means the user must reconnect.
 * Real logger, faked Sentry transport, createFakeDb for the database and installFakeStravaFetch for the network.
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
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';
import { createFakeDb, type Row, type RecordedQuery } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { getValidAccessToken } from '../stravaClient.js';

const EXPIRED: Row = { user_id: 'user-1', access_token: 'old-at-secret-1', refresh_token: 'old-rt-secret-1', expires_at: 100, connection_date: '2026-09-01' };

let sentry: FakeSentry;
let strava: FakeStrava | undefined;

function use(rows: Row[], failWhen?: (q: RecordedQuery) => { message: string } | null) {
  const db = createFakeDb({ strava_tokens: rows }, { failWhen, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
}
const failingWrite = (q: RecordedQuery) => (q.table === 'strava_tokens' && q.mutation === 'update' ? { message: 'write failed' } : null);

beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  sentry = startFakeSentry();
});
afterEach(async () => {
  strava?.restore();
  strava = undefined;
  await sentry.stop();
  vi.restoreAllMocks();
});

describe('token write alerts in sentry', () => {
  it('critical log lines reach sentry', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at-secret-1', refresh_token: 'new-rt-secret-1' }) });
    use([{ ...EXPIRED }], failingWrite);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: false, reason: 'refresh_failed' });
    const sent = await sentry.flush();

    const critical = sent.filter((event) => event.tags?.alert === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'token_write', user_id: 'user-1' } });
  });

  it('sends no token in the event', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at-secret-1', refresh_token: 'new-rt-secret-1' }) });
    use([{ ...EXPIRED }], failingWrite);

    await getValidAccessToken('user-1');
    const sent = await sentry.flush();

    // The whole event, not just the tags: only our own user id identifies anyone.
    const text = JSON.stringify(sent);
    expect(text).toContain('user-1');
    for (const secret of ['old-at-secret-1', 'old-rt-secret-1', 'new-at-secret-1', 'new-rt-secret-1']) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/(object|owner|athlete)_id/);
  });

  it('a second user whose token cannot be saved within 10 minutes is counted, not sent again', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at-secret-1', refresh_token: 'new-rt-secret-1' }) });
    use([{ ...EXPIRED }, { ...EXPIRED, user_id: 'user-2' }], failingWrite);

    await getValidAccessToken('user-1');
    await getValidAccessToken('user-2');
    const sent = await sentry.flush();

    expect(sent.filter((event) => event.tags?.alert === 'critical')).toHaveLength(1);
  });

  it('sends no critical alert for a refresh that succeeds', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'new-at-secret-1', refresh_token: 'new-rt-secret-1' }) });
    use([{ ...EXPIRED }]);

    expect(await getValidAccessToken('user-1')).toMatchObject({ ok: true });

    expect((await sentry.flush()).filter((event) => event.tags?.alert === 'critical')).toEqual([]);
  });
});
