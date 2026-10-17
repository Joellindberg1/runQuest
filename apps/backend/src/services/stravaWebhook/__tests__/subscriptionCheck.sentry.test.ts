/**
 * The nightly subscription check as a Sentry alert (alarm b of ADR 010 decision 11). The real logger runs and Sentry is faked at the
 * transport, so the test sees what would leave the process. Network: installFakeStravaFetch only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { startFakeSentry, type FakeSentry } from '../../../observability/__tests__/helpers/fakeSentry.js';
import { installFakeStravaFetch, stravaSubscription, type FakeStrava } from '../../../test-utils/fakeStrava.js';
import { STRAVA_WEBHOOK_CALLBACK_URL } from '../constants.js';
import { runStravaSubscriptionCheck } from '../subscriptionCheck.js';

const ENV: NodeJS.ProcessEnv = {
  STRAVA_CLIENT_ID: '123456',
  STRAVA_CLIENT_SECRET: 'client-secret-0f9e8d7c6b5a',
  STRAVA_WEBHOOK_VERIFY_TOKEN: 'verify-token-0123456789abcdef0123456789abcdef',
  STRAVA_WEBHOOK_SUBSCRIPTION_ID: '777',
};

let sentry: FakeSentry;
let strava: FakeStrava | undefined;

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

describe('subscription check alerts in sentry', () => {
  it('critical log lines reach sentry', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });

    expect(await runStravaSubscriptionCheck(ENV)).toBe('missing');
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'subscription_missing' } });
    expect(sent[0].message).toMatch(/missing/i);
  });

  it.each([
    ['id_differs', [stravaSubscription({ id: 4242, callback_url: STRAVA_WEBHOOK_CALLBACK_URL })]],
    ['callback_differs', [stravaSubscription({ id: 777, callback_url: 'https://old.example.test/hook' })]],
  ] as const)('a subscription that is %s is the same alert', async (outcome, list) => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [...list] } });

    expect(await runStravaSubscriptionCheck(ENV)).toBe(outcome);
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'subscription_missing' } });
  });

  it('alerts again the next night when the subscription is still missing', async () => {
    for (let night = 0; night < 2; night++) {
      strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });
      await runStravaSubscriptionCheck(ENV);
      strava.restore();
      strava = undefined;
    }

    expect(await sentry.flush()).toHaveLength(2);
  });

  it('sends no alert when the subscription is fine or the check could not be made', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [stravaSubscription({ id: 777, callback_url: STRAVA_WEBHOOK_CALLBACK_URL })] } });
    expect(await runStravaSubscriptionCheck(ENV)).toBe('ok');
    strava.restore();

    expect(await runStravaSubscriptionCheck({ ...ENV, STRAVA_WEBHOOK_SUBSCRIPTION_ID: undefined })).toBe('skipped');

    const sent = await sentry.flush();
    expect(sent.filter((event) => event.tags?.alert === 'critical')).toEqual([]);
  });

  it('puts only alert and source in the tags', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });
    await runStravaSubscriptionCheck(ENV);
    const [event] = await sentry.flush();

    expect(Object.keys(event.tags).sort()).toEqual(['alert', 'source']);
  });
});
