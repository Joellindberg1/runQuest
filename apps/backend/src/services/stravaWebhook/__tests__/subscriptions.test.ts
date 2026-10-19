/**
 * listStravaSubscriptions: the one parser of GET /push_subscriptions, shared by the subscription script and the nightly check.
 * Fail-closed: an unreadable answer is a failure, never "none". The failure reason is a status or an error name, never a message
 * and never the request url (it carries client_secret in its query string). Network: installFakeStravaFetch or a stub of fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { installFakeStravaFetch, stravaError, stravaSubscription, type FakeStrava } from '../../../test-utils/fakeStrava.js';
import { STRAVA_API_TIMEOUT_MS } from '../../stravaClient.js';
import { listStravaSubscriptions } from '../subscriptions.js';

const CLIENT_ID = '123456';
const CLIENT_SECRET = 'client-secret-0f9e8d7c6b5a';
const input = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };

let strava: FakeStrava | undefined;
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

describe('listStravaSubscriptions', () => {
  it('returns the listed rows and sends the credentials in the query string of one GET', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [stravaSubscription({ id: 777 }), stravaSubscription({ id: 778 })] } });

    const result = await listStravaSubscriptions(input);

    expect(result.ok).toBe(true);
    expect(result.ok && result.rows.map((row) => row.id)).toEqual([777, 778]);
    expect(strava.requests).toHaveLength(1);
    expect(strava.requests[0].method).toBe('GET');
    expect(strava.requests[0].query).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  });

  it('an empty list is a successful, empty answer', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });

    expect(await listStravaSubscriptions(input)).toEqual({ ok: true, rows: [] });
  });

  it('fails closed on an error status, an answer that is not a list and a row without a valid id', async () => {
    const answers: Array<[string, unknown]> = [
      ['500', stravaError(500)],
      ['429', stravaError(429)],
      ['object', { message: 'maintenance' }],
      ['string id', [{ id: '777', callback_url: 'x' }]],
      ['zero id', [{ id: 0, callback_url: 'x' }]],
      ['null row', [null]],
    ];
    for (const [name, list] of answers) {
      strava = installFakeStravaFetch({ pushSubscriptions: { list: list as never } });
      const result = await listStravaSubscriptions(input);
      expect(result.ok, name).toBe(false);
      strava.restore();
    }
  });

  it('an HTTP failure reports its status and nothing from the body', async () => {
    strava = installFakeStravaFetch({
      pushSubscriptions: { list: stravaError(401, { body: { message: `bad ${CLIENT_SECRET}` } }) },
    });

    const result = await listStravaSubscriptions(input);

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
  });

  it('a request that gets no answer reports the error name, never the message, the cause or the url', async () => {
    const original = globalThis.fetch;
    const errors = [
      (url: string) => new TypeError(`Failed to parse URL from ${url}`),
      (url: string) => Object.assign(new TypeError('fetch failed'), { cause: new Error(`connect ECONNREFUSED ${url}`) }),
      () => Object.assign(new Error('x'), { name: 'TimeoutError' }),
    ];
    try {
      for (const make of errors) {
        globalThis.fetch = (async (target: string | URL | Request) => {
          throw make(typeof target === 'string' ? target : target instanceof URL ? target.href : target.url);
        }) as typeof fetch;

        const result = await listStravaSubscriptions(input);

        expect(result).toMatchObject({ ok: false, unanswered: true });
        const serialised = JSON.stringify(result);
        expect(serialised).not.toContain(CLIENT_SECRET);
        expect(serialised).not.toContain('strava.com');
        expect(serialised).not.toContain('client_secret');
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it('gives up when the answer does not come within the central Strava timeout', async () => {
    vi.useFakeTimers();
    const original = globalThis.fetch;
    globalThis.fetch = ((_target: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    try {
      const pending = listStravaSubscriptions(input);
      await vi.advanceTimersByTimeAsync(STRAVA_API_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(result).toMatchObject({ ok: false, unanswered: true });
      expect(result.ok === false && result.reason).toContain('TimeoutError');
    } finally {
      globalThis.fetch = original;
      vi.useRealTimers();
    }
  });

  it('fails closed when the body of the answer stalls past the central Strava timeout', async () => {
    vi.useFakeTimers();
    const original = globalThis.fetch;
    globalThis.fetch = (async (_target: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream({ start(controller) { signal?.addEventListener('abort', () => controller.error(signal.reason)); } });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    try {
      const pending = listStravaSubscriptions(input);
      await vi.advanceTimersByTimeAsync(STRAVA_API_TIMEOUT_MS);

      expect(await pending).toMatchObject({ ok: false }); // fail-closed; the stalled body ends at the central timeout
    } finally {
      globalThis.fetch = original;
      vi.useRealTimers();
    }
  });
});
