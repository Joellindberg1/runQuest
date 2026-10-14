import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import {
  installFakeStravaFetch,
  stravaActivity,
  stravaAthlete,
  stravaDeauthorizeEvent,
  stravaError,
  stravaEvent,
  stravaSubscription,
  stravaTokenResponse,
  type FakeStrava,
} from '../fakeStrava.js';

const API = 'https://www.strava.com/api/v3';
const bearer = { Authorization: 'Bearer access-1' };

// Varje test installerar sin egen fake; restore() återställer fetch och är idempotent.
const installed: FakeStrava[] = [];
function install(...args: Parameters<typeof installFakeStravaFetch>): FakeStrava {
  const fake = installFakeStravaFetch(...args);
  installed.push(fake);
  return fake;
}
afterEach(() => {
  while (installed.length) installed.pop()!.restore();
});

describe('fakeStrava', () => {
  it('fakeStrava serves a configured activity and counts calls', async () => {
    const activity = stravaActivity({ id: 111, distance: 8000 });
    const fake = install({ activities: { 111: activity } });

    const first = await fetch(`${API}/activities/111`, { headers: bearer });
    const second = await fetch(`${API}/activities/111?include_all_efforts=false`, { headers: bearer });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(activity);
    expect(second.status).toBe(200);
    expect(fake.calls.activity).toBe(2);
    expect(fake.activityCalls(111)).toBe(2);
    expect(fake.requests[0]).toMatchObject({ route: 'activity', method: 'GET', activityId: 111 });
    expect(fake.requests[0].headers.authorization).toBe('Bearer access-1');
    expect(fake.calls.athlete).toBe(0);
  });

  it('fakeStrava returns 404 for unknown activity ids', async () => {
    const fake = install({ activities: { 111: stravaActivity({ id: 111 }) } });

    const res = await fetch(`${API}/activities/999`, { headers: bearer });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: 'Resource Not Found' });
    expect(fake.activityCalls(999)).toBe(1);
    expect(fake.unmockedRequests).toEqual([]);
  });

  it('fakeStrava refuses any unmocked url', async () => {
    const fake = install({ activities: { 111: stravaActivity({ id: 111 }) } });

    await expect(fetch('https://example.com/anything')).rejects.toThrow(/unmocked/i);
    // Ej konfigurerad route på Stravas värd nekas också, i stället för att hamna på nätet.
    await expect(fetch(`${API}/athlete`, { headers: bearer })).rejects.toThrow(/unmocked/i);
    // Fel metod mot en konfigurerad route räknas som omockad.
    await expect(fetch(`${API}/activities/111`, { method: 'DELETE' })).rejects.toThrow(/unmocked/i);

    expect(fake.unmockedRequests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://example.com/anything',
      `GET ${API}/athlete`,
      `DELETE ${API}/activities/111`,
    ]);
    // Anropskoden kan svälja felet; restore() faller testet i så fall.
    expect(() => fake.restore()).toThrow(/unmocked/i);
    // Idempotent: andra restore() är ett no-op och fetch är återställd.
    expect(() => fake.restore()).not.toThrow();
  });

  it('fakeStrava returns 401, 429 and 5xx on demand', async () => {
    const fake = install({
      athlete: (call) => (call.count === 1 ? stravaError(401) : stravaAthlete({ id: 77 })),
      activities: {
        1: stravaError(429),
        2: stravaError(503),
        3: stravaError(500, { body: { message: 'boom' } }),
      },
      oauthToken: stravaError(401, { body: { message: 'Authorization Error', errors: [{ field: 'refresh_token', code: 'invalid' }] } }),
    });

    const unauthorized = await fetch(`${API}/athlete`, { headers: bearer });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ message: 'Authorization Error' });
    const ok = await fetch(`${API}/athlete`, { headers: bearer });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: 77 });
    expect(fake.calls.athlete).toBe(2);

    const tooMany = await fetch(`${API}/activities/1`);
    expect(tooMany.status).toBe(429);
    expect(await tooMany.json()).toMatchObject({ message: 'Rate Limit Exceeded' });
    expect((await fetch(`${API}/activities/2`)).status).toBe(503);
    const boom = await fetch(`${API}/activities/3`);
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({ message: 'boom' });

    const refresh = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'dead' }),
    });
    expect(refresh.status).toBe(401);
    expect(fake.calls.oauthToken).toBe(1);
    expect(fake.requests.at(-1)?.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'dead' });
  });

  it('fakeStrava answers oauth deauthorize and counts the call', async () => {
    const fake = install({ oauthDeauthorize: { access_token: 'access-1' } });

    const res = await fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-1' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'access-1' });
    expect(fake.calls.oauthDeauthorize).toBe(1);
    expect(fake.requests[0]).toMatchObject({ route: 'oauthDeauthorize', method: 'POST' });
    expect(fake.requests[0].headers.authorization).toBe('Bearer access-1');
  });

  it('fakeStrava attaches rate limit headers when configured', async () => {
    const withLimits = install({
      activities: { 1: stravaActivity({ id: 1 }), 2: stravaError(429) },
      rateLimit: { read: { usage: [210, 2100] }, overall: { usage: [250, 2500], limit: [600, 6000] } },
    });

    const ok = await fetch(`${API}/activities/1`);
    expect(ok.headers.get('X-ReadRateLimit-Usage')).toBe('210,2100');
    expect(ok.headers.get('X-ReadRateLimit-Limit')).toBe('300,3000');
    expect(ok.headers.get('X-RateLimit-Usage')).toBe('250,2500');
    expect(ok.headers.get('X-RateLimit-Limit')).toBe('600,6000');
    // Strava skickar huvudena även på 429.
    const limited = await fetch(`${API}/activities/2`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('X-ReadRateLimit-Usage')).toBe('210,2100');
    withLimits.restore();

    install({ activities: { 1: stravaActivity({ id: 1 }) } });
    const plain = await fetch(`${API}/activities/1`);
    expect(plain.headers.get('X-ReadRateLimit-Usage')).toBeNull();
    expect(plain.headers.get('X-RateLimit-Usage')).toBeNull();
  });

  it('fakeStrava lists activities after a timestamp without splits, like the real summary list', async () => {
    const older = stravaActivity({ id: 1, start_date: '2026-10-01T05:00:00Z', start_date_local: '2026-10-01T07:00:00Z' });
    const newer = stravaActivity({ id: 2, start_date: '2026-10-10T05:00:00Z', start_date_local: '2026-10-10T07:00:00Z' });
    const fake = install({ athleteActivities: [older, newer] });
    const after = Math.floor(Date.parse('2026-10-05T00:00:00Z') / 1000);

    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=200`, { headers: bearer });
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body.map((a) => a.id)).toEqual([2]);
    expect(body[0]).not.toHaveProperty('splits_metric');
    expect(fake.calls.athleteActivities).toBe(1);
    expect(fake.requests[0].query).toMatchObject({ after: String(after), per_page: '200' });
  });

  it('fakeStrava handles push_subscriptions and oauth token exchanges', async () => {
    const fake = install({
      pushSubscriptions: {
        list: [stravaSubscription({ id: 55 })],
        create: { id: 55 },
        delete: null,
      },
      oauthToken: stravaTokenResponse({ athlete: { id: 5001 } }),
    });

    const list = await fetch(`${API}/push_subscriptions?client_id=1&client_secret=s`);
    expect(await list.json()).toMatchObject([{ id: 55 }]);
    const created = await fetch(`${API}/push_subscriptions`, { method: 'POST', body: new URLSearchParams({ callback_url: 'https://x.test/hook' }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: 55 });
    const removed = await fetch(`${API}/push_subscriptions/55?client_id=1&client_secret=s`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    const token = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code' }) });
    expect(await token.json()).toMatchObject({ access_token: expect.any(String), refresh_token: expect.any(String), athlete: { id: 5001 } });

    expect(fake.calls).toMatchObject({ pushSubscriptionsList: 1, pushSubscriptionsCreate: 1, pushSubscriptionsDelete: 1, oauthToken: 1 });
    expect(fake.requests[1].body).toEqual({ callback_url: 'https://x.test/hook' });
  });
});

describe('stravaActivity', () => {
  it('builds runs, trail runs, virtual runs and rides with Stravas type fields', () => {
    const run = stravaActivity();
    expect(run).toMatchObject({ type: 'Run', sport_type: 'Run', private: false, trainer: false, distance: 5000 });
    expect(run.start_date_local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // Stravas TrailRun har type "Run"; VirtualRun och Ride har samma värde i båda fälten.
    expect(stravaActivity({ sport_type: 'TrailRun' })).toMatchObject({ type: 'Run', sport_type: 'TrailRun' });
    expect(stravaActivity({ sport_type: 'VirtualRun' })).toMatchObject({ type: 'VirtualRun', sport_type: 'VirtualRun' });
    expect(stravaActivity({ sport_type: 'Ride' })).toMatchObject({ type: 'Ride', sport_type: 'Ride' });
  });

  it('derives one split per started kilometre unless splits are given', () => {
    const derived = stravaActivity({ distance: 2500, moving_time: 750 });
    expect(derived.splits_metric.map((s) => s.distance)).toEqual([1000, 1000, 500]);
    expect(derived.splits_metric.reduce((sum, s) => sum + s.moving_time, 0)).toBe(750);

    const custom = [{ distance: 1000, moving_time: 300, elapsed_time: 300, split: 1 }];
    expect(stravaActivity({ splits_metric: custom }).splits_metric).toBe(custom);
  });

  it('carries private and trainer flags and a fixed owner', () => {
    expect(stravaActivity({ private: true, trainer: true, athlete: { id: 9, resource_state: 1 } })).toMatchObject({
      private: true,
      trainer: true,
      athlete: { id: 9 },
    });
  });
});

describe('stravaEvent', () => {
  it('stravaEvent builds a valid create payload with defaults', () => {
    const event = stravaEvent();

    expect(event).toMatchObject({ object_type: 'activity', aspect_type: 'create', updates: {} });
    for (const key of ['object_id', 'owner_id', 'subscription_id', 'event_time'] as const) {
      expect(Number.isInteger(event[key]), key).toBe(true);
    }
    // event_time är epoch-sekunder, inte millisekunder.
    expect(event.event_time).toBeLessThan(10_000_000_000);
    expect(stravaEvent({ aspect_type: 'update', updates: { private: 'true' }, object_id: 42 })).toMatchObject({
      aspect_type: 'update',
      updates: { private: 'true' },
      object_id: 42,
      object_type: 'activity',
    });
  });

  it('stravaDeauthorizeEvent builds an athlete event with authorized false', () => {
    const event = stravaDeauthorizeEvent({ owner_id: 5002 });

    expect(event).toMatchObject({
      object_type: 'athlete',
      aspect_type: 'update',
      object_id: 5002,
      owner_id: 5002,
      updates: { authorized: 'false' },
    });
    expect(Number.isInteger(event.subscription_id)).toBe(true);
    expect(Number.isInteger(event.event_time)).toBe(true);
    expect(stravaDeauthorizeEvent({ subscription_id: 9 }).subscription_id).toBe(9);
  });
});

describe('test-utils isolation', () => {
  it('the production bundle does not include test-utils', async () => {
    const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    // Samma bygge som `npm run build` (esbuild från server.ts), men i minnet.
    const result = await build({
      entryPoints: [path.join(backend, 'src/server.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
      packages: 'external',
      alias: { '@runquest/shared': path.join(backend, '../../packages/shared/src/index.ts') },
    });

    const inputs = Object.keys(result.metafile.inputs).map((p) => p.replaceAll('\\', '/'));
    expect(inputs.some((p) => p.endsWith('src/server.ts'))).toBe(true);
    expect(inputs.filter((p) => p.includes('test-utils') || p.includes('__tests__'))).toEqual([]);
    expect(result.outputFiles.map((f) => f.text).join('')).not.toMatch(/fakeStrava|installFakeStravaFetch/);
  });
});
