/**
 * The nightly check of the Strava push subscription (ADR 010 decision 11, alarm b): one GET /push_subscriptions per night,
 * compared with STRAVA_WEBHOOK_SUBSCRIPTION_ID. Network: installFakeStravaFetch only, so a request the test did not configure
 * fails it. No database is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { logger } from '../../../utils/logger.js';
import { installFakeStravaFetch, stravaError, stravaSubscription, type FakeStrava } from '../../../test-utils/fakeStrava.js';
import { setStravaRequestHooks } from '../../stravaClient.js';
import { STRAVA_WEBHOOK_CALLBACK_URL } from '../constants.js';
import { runStravaSubscriptionCheck } from '../subscriptionCheck.js';

const CLIENT_ID = '123456';
const CLIENT_SECRET = 'client-secret-0f9e8d7c6b5a';
const VERIFY_TOKEN = 'verify-token-0123456789abcdef0123456789abcdef';
const CRITICAL = '🚨 KRITISKT: Strava-webhook';

const ENV: NodeJS.ProcessEnv = {
  STRAVA_CLIENT_ID: CLIENT_ID,
  STRAVA_CLIENT_SECRET: CLIENT_SECRET,
  STRAVA_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
  STRAVA_WEBHOOK_SUBSCRIPTION_ID: '777',
};

const OURS = stravaSubscription({ id: 777, callback_url: STRAVA_WEBHOOK_CALLBACK_URL });

type Level = 'info' | 'warn' | 'error' | 'debug';
let logged: Array<{ level: Level; text: string }>;
let strava: FakeStrava | undefined;

const text = (args: unknown[]) =>
  args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
const lines = (level: Level) => logged.filter((entry) => entry.level === level).map((entry) => entry.text);
const critical = () => lines('error').filter((line) => line.includes(CRITICAL));

beforeEach(() => {
  logged = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => void logged.push({ level, text: text(args) }));
  }
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push({ level: method === 'log' ? 'info' : method, text: text(args) }));
  }
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

describe('subscription check', () => {
  it('nightly check logs a critical error when Strava lists no subscription', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });

    const outcome = await runStravaSubscriptionCheck(ENV);

    expect(outcome).toBe('missing');
    expect(critical()).toHaveLength(1);
    expect(critical()[0]).toMatch(/missing/i);
  });

  it('nightly check logs a critical error when the listed subscription id differs from the configured one', async () => {
    strava = installFakeStravaFetch({
      pushSubscriptions: { list: [stravaSubscription({ id: 4242, callback_url: STRAVA_WEBHOOK_CALLBACK_URL })] },
    });

    const outcome = await runStravaSubscriptionCheck(ENV);

    expect(outcome).toBe('id_differs');
    expect(critical()).toHaveLength(1);
    expect(critical()[0]).toContain('777');
    expect(critical()[0]).toContain('4242');
  });

  it('nightly check logs a critical error when the subscription points at another callback url', async () => {
    strava = installFakeStravaFetch({
      pushSubscriptions: { list: [stravaSubscription({ id: 777, callback_url: 'https://old.example.test/hook' })] },
    });

    const outcome = await runStravaSubscriptionCheck(ENV);

    expect(outcome).toBe('callback_differs');
    expect(critical()).toHaveLength(1);
    expect(critical()[0]).toContain('https://old.example.test/hook');
    expect(critical()[0]).toContain(STRAVA_WEBHOOK_CALLBACK_URL);
  });

  it('nightly check logs no critical error when the subscription matches', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [OURS] } });

    const outcome = await runStravaSubscriptionCheck(ENV);

    expect(outcome).toBe('ok');
    expect(critical()).toEqual([]);
    expect(lines('error')).toEqual([]);
    expect(lines('warn')).toEqual([]);
    expect(lines('info').join('\n')).toMatch(/subscription ok/i);
  });

  it('nightly check makes exactly one Strava request', async () => {
    const scenarios: Array<{ name: string; list: Parameters<typeof installFakeStravaFetch>[0]['pushSubscriptions'] }> = [
      { name: 'match', list: { list: [OURS] } },
      { name: 'empty list', list: { list: [] } },
      { name: 'other id', list: { list: [stravaSubscription({ id: 1, callback_url: STRAVA_WEBHOOK_CALLBACK_URL })] } },
      { name: 'other callback', list: { list: [stravaSubscription({ id: 777, callback_url: 'https://old.example.test/hook' })] } },
      { name: 'rate limited', list: { list: stravaError(429) } },
      { name: 'server error', list: { list: stravaError(500) } },
    ];

    for (const scenario of scenarios) {
      strava = installFakeStravaFetch({ pushSubscriptions: scenario.list });

      await runStravaSubscriptionCheck(ENV);

      expect(strava.requests, scenario.name).toHaveLength(1);
      expect(strava.calls.pushSubscriptionsList, scenario.name).toBe(1);
      strava.restore();
    }
  });

  it('nightly check is skipped without a critical error when the subscription id is not configured', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });

    for (const value of [undefined, '', '   ', 'abc', '0', '-5', '12.5', '12abc']) {
      logged = [];
      const outcome = await runStravaSubscriptionCheck({ ...ENV, STRAVA_WEBHOOK_SUBSCRIPTION_ID: value });

      expect(outcome, String(value)).toBe('skipped');
      expect(critical(), String(value)).toEqual([]);
      expect(lines('error'), String(value)).toEqual([]);
      expect(lines('info').join('\n'), String(value)).toMatch(/skipped/i);
    }
    expect(strava.requests).toHaveLength(0);
  });

  it('nightly check logs an error, not a critical one, and sends nothing when the client credentials are missing', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [OURS] } });

    for (const missing of ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']) {
      logged = [];
      const outcome = await runStravaSubscriptionCheck({ ...ENV, [missing]: '' });

      expect(outcome, missing).toBe('missing_credentials');
      expect(critical(), missing).toEqual([]);
      expect(lines('error'), missing).toHaveLength(1);
      expect(lines('error')[0], missing).toMatch(/missing client credentials/i);
    }
    expect(strava.requests).toHaveLength(0);
  });

  it('nightly check logs a warning, not a critical error, and does not retry when the call fails', async () => {
    const failures: Array<{ name: string; list: Parameters<typeof installFakeStravaFetch>[0]['pushSubscriptions']; expected: RegExp }> = [
      { name: '5xx', list: { list: stravaError(503) }, expected: /503/ },
      { name: '429', list: { list: stravaError(429) }, expected: /429/ },
      { name: '401', list: { list: stravaError(401) }, expected: /401/ },
      // The fake serves whatever the test hands it: a list that is not a list, and a row without a valid id.
      { name: 'not a list', list: { list: { message: 'maintenance' } as never }, expected: /list/i },
      { name: 'row without id', list: { list: [{ callback_url: STRAVA_WEBHOOK_CALLBACK_URL }] as never }, expected: /id/i },
    ];

    for (const failure of failures) {
      logged = [];
      strava = installFakeStravaFetch({ pushSubscriptions: failure.list });

      const outcome = await runStravaSubscriptionCheck(ENV);

      expect(outcome, failure.name).toBe('check_failed');
      expect(critical(), failure.name).toEqual([]);
      expect(lines('error'), failure.name).toEqual([]);
      expect(lines('warn'), failure.name).toHaveLength(1);
      expect(lines('warn')[0], failure.name).toMatch(failure.expected);
      expect(strava.requests, failure.name).toHaveLength(1);
      strava.restore();
    }
  });

  it('nightly check logs a warning with the error name when the request gets no answer', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      const error = new Error('socket hang up');
      error.name = 'TimeoutError';
      throw error;
    }) as typeof fetch;
    try {
      const outcome = await runStravaSubscriptionCheck(ENV);

      expect(outcome).toBe('check_failed');
      expect(critical()).toEqual([]);
      expect(lines('warn')).toHaveLength(1);
      expect(lines('warn')[0]).toContain('TimeoutError');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('nightly check request passes through the Strava client hooks that count it', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [OURS] } });
    const before = vi.fn();
    const after = vi.fn();
    const restoreHooks = setStravaRequestHooks({ before, after });
    try {
      await runStravaSubscriptionCheck(ENV);
    } finally {
      restoreHooks();
    }

    expect(before).toHaveBeenCalledTimes(1);
    expect(String(before.mock.calls[0][0])).toContain('/api/v3/push_subscriptions');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('nightly check never logs the client secret or the verify token', async () => {
    // Every outcome, including answers that echo the credentials and fetch errors whose message carries the whole request url
    // (the url holds client_secret in its query string).
    const echo = { message: `rejected ${CLIENT_SECRET} / ${VERIFY_TOKEN}`, errors: [{ code: `bad ${VERIFY_TOKEN}`, field: CLIENT_SECRET }] };
    const withSecretsInCallback = stravaSubscription({
      id: 777,
      callback_url: `https://old.example.test/hook?client_secret=${CLIENT_SECRET}&verify_token=${VERIFY_TOKEN}`,
    });
    const httpScenarios: Array<{ name: string; routes: Parameters<typeof installFakeStravaFetch>[0] }> = [
      { name: 'match', routes: { pushSubscriptions: { list: [OURS] } } },
      { name: 'empty', routes: { pushSubscriptions: { list: [] } } },
      { name: 'other id', routes: { pushSubscriptions: { list: [stravaSubscription({ id: 9, callback_url: withSecretsInCallback.callback_url })] } } },
      { name: 'other callback holding secrets', routes: { pushSubscriptions: { list: [withSecretsInCallback] } } },
      { name: '401 echoing the credentials', routes: { pushSubscriptions: { list: stravaError(401, { body: echo }) } } },
      { name: '500 echoing the credentials', routes: { pushSubscriptions: { list: stravaError(500, { body: echo }) } } },
      { name: '429', routes: { pushSubscriptions: { list: stravaError(429, { body: echo }) } } },
      { name: 'answer that is not a list', routes: { pushSubscriptions: { list: echo as never } } },
      // A row with an invalid id that echoes the credentials in its other fields.
      { name: 'row without id', routes: { pushSubscriptions: { list: [{ callback_url: CLIENT_SECRET, created_at: VERIFY_TOKEN }] as never } } },
    ];
    const everything = () => logged.map((entry) => entry.text).join('\n');

    for (const scenario of httpScenarios) {
      logged = [];
      strava = installFakeStravaFetch(scenario.routes);
      await runStravaSubscriptionCheck(ENV);
      expect(logged.length, `${scenario.name} wrote nothing`).toBeGreaterThan(0);
      for (const secret of [CLIENT_SECRET, VERIFY_TOKEN]) expect(everything(), `${scenario.name} leaked ${secret}`).not.toContain(secret);
      strava.restore();
      strava = undefined;
    }

    const original = globalThis.fetch;
    const fetchErrors: Array<{ name: string; make: (url: string) => Error }> = [
      { name: 'invalid url', make: (url) => new TypeError(`Failed to parse URL from ${url}`) },
      { name: 'fetch failed with url in cause', make: (url) => Object.assign(new TypeError('fetch failed'), { cause: new Error(`connect ECONNREFUSED ${url}`) }) },
      { name: 'message with both secrets', make: () => new Error(`while sending ${CLIENT_SECRET} and ${VERIFY_TOKEN}`) },
      { name: 'secret in the error code', make: () => Object.assign(new Error('boom'), { code: `X${CLIENT_SECRET}` }) },
    ];
    try {
      for (const fetchError of fetchErrors) {
        logged = [];
        globalThis.fetch = (async (input: string | URL | Request) => {
          throw fetchError.make(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        }) as typeof fetch;
        await runStravaSubscriptionCheck(ENV);
        expect(logged.length, `${fetchError.name} wrote nothing`).toBeGreaterThan(0);
        for (const secret of [CLIENT_SECRET, VERIFY_TOKEN]) expect(everything(), `${fetchError.name} leaked ${secret}`).not.toContain(secret);
      }

      // An answer whose body is not JSON at all.
      logged = [];
      globalThis.fetch = (async () => new Response(`<html>${CLIENT_SECRET} ${VERIFY_TOKEN}</html>`, { status: 200 })) as typeof fetch;
      await runStravaSubscriptionCheck(ENV);
      expect(logged.length).toBeGreaterThan(0);
      for (const secret of [CLIENT_SECRET, VERIFY_TOKEN]) expect(everything()).not.toContain(secret);
    } finally {
      globalThis.fetch = original;
    }

    // The two paths that send nothing.
    for (const env of [{ ...ENV, STRAVA_WEBHOOK_SUBSCRIPTION_ID: undefined }, { ...ENV, STRAVA_CLIENT_ID: '' }]) {
      logged = [];
      await runStravaSubscriptionCheck(env);
      expect(logged.length).toBeGreaterThan(0);
      for (const secret of [CLIENT_SECRET, VERIFY_TOKEN]) expect(everything()).not.toContain(secret);
    }
  });
});
