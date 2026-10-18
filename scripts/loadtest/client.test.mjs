// Klienten: tillåtna rutter (Strava och allt annat nekas innan ett anrop görs), utfallsklassning och att token aldrig läcker.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALLOWED_ROUTES, RouteNotAllowed, createClient } from './client.mjs';

const BASE = 'http://127.0.0.1:4010';
const FAKE_TOKEN = 'FAKE_TEST_TOKEN_1_not_a_real_secret';
const RUN_ID = '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f';

function recordingFetch(respond = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return respond(url, init); };
  return { calls, fetchImpl };
}

describe('createClient allowed routes', () => {
  it('sends the four scenario routes plus cleanup and nothing else', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createClient({ baseUrl: BASE, fetchImpl });
    await client.request({ scenario: 'login', method: 'POST', path: '/api/auth/login', body: { name: 'a', password: 'b' } });
    await client.request({ scenario: 'leaderboard', method: 'GET', path: '/api/leaderboard/week', token: FAKE_TOKEN });
    await client.request({ scenario: 'news', method: 'GET', path: '/api/news?limit=20', token: FAKE_TOKEN });
    await client.request({ scenario: 'log-run', method: 'POST', path: '/api/runs', token: FAKE_TOKEN, body: {} });
    await client.request({ scenario: 'cleanup', method: 'DELETE', path: `/api/runs/${RUN_ID}`, token: FAKE_TOKEN });
    assert.equal(calls.length, 5);
    assert.equal(ALLOWED_ROUTES.length, 5);
  });

  it('never calls a Strava route, however it is spelled', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createClient({ baseUrl: BASE, fetchImpl });
    for (const path of [
      '/api/strava/status', '/api/strava/callback', '/api/strava/webhook', '/api/strava/sync', '/api/strava',
      '/api/Strava/status', '/api//strava/status', '/api/news/../strava/status', '/api/news/%2e%2e/strava/status',
    ]) {
      await assert.rejects(client.request({ scenario: 'news', method: 'GET', path, token: FAKE_TOKEN }), RouteNotAllowed, path);
    }
    assert.equal(calls.length, 0);
  });

  it('refuses a route with the wrong method, an absolute URL and a path that is not a path', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createClient({ baseUrl: BASE, fetchImpl });
    await assert.rejects(client.request({ scenario: 'x', method: 'DELETE', path: '/api/news' }), RouteNotAllowed);
    await assert.rejects(client.request({ scenario: 'x', method: 'GET', path: 'https://backend.invalid/api/news' }), RouteNotAllowed);
    await assert.rejects(client.request({ scenario: 'x', method: 'GET', path: '//backend.invalid/api/news' }), RouteNotAllowed);
    await assert.rejects(client.request({ scenario: 'x', method: 'PUT', path: `/api/runs/${RUN_ID}` }), RouteNotAllowed);
    await assert.rejects(client.request({ scenario: 'x', method: 'GET', path: '/api/admin/waitlist' }), RouteNotAllowed);
    assert.equal(calls.length, 0);
  });

  it('refuses to be built for a production base URL', () => {
    assert.throws(() => createClient({ baseUrl: 'https://backend.invalid', fetchImpl: async () => new Response('') }));
  });
});

describe('createClient requests', () => {
  it('sends the token as a bearer header, JSON bodies, and does not follow redirects', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createClient({ baseUrl: BASE, fetchImpl });
    await client.request({ scenario: 'log-run', method: 'POST', path: '/api/runs', token: FAKE_TOKEN, body: { distance: 1.01 }, headers: { 'Idempotency-Key': 'k' } });
    const { init, url } = calls[0];
    assert.equal(url, `${BASE}/api/runs`);
    assert.equal(init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
    assert.equal(init.headers['Idempotency-Key'], 'k');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.body, JSON.stringify({ distance: 1.01 }));
    assert.equal(init.redirect, 'manual');
  });

  it('classifies 2xx as ok, 429 as rate_limited, other statuses and thrown errors as failed', async () => {
    const statuses = [200, 201, 429, 401, 500, 302];
    let i = 0;
    const { fetchImpl } = recordingFetch(() => new Response('{}', { status: statuses[i++] }));
    const client = createClient({ baseUrl: BASE, fetchImpl });
    for (let n = 0; n < statuses.length; n++) await client.request({ scenario: 'news', method: 'GET', path: '/api/news' });
    assert.deepEqual(client.samples.map((s) => s.outcome), ['ok', 'ok', 'rate_limited', 'failed', 'failed', 'failed']);

    const broken = createClient({ baseUrl: BASE, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    const result = await broken.request({ scenario: 'news', method: 'GET', path: '/api/news' });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.status, null);
    assert.equal(broken.samples[0].status, null);
  });

  it('records the latency from the injected clock and returns parsed JSON', async () => {
    const times = [1000, 1250];
    const { fetchImpl } = recordingFetch(() => new Response('{"success":true}', { status: 200 }));
    const client = createClient({ baseUrl: BASE, fetchImpl, now: () => times.shift() });
    const result = await client.request({ scenario: 'news', method: 'GET', path: '/api/news' });
    assert.equal(result.ms, 250);
    assert.deepEqual(result.json, { success: true });
    assert.equal(client.samples[0].ms, 250);
  });

  it('keeps the token out of recorded samples and out of thrown errors', async () => {
    const { fetchImpl } = recordingFetch();
    const client = createClient({ baseUrl: BASE, fetchImpl });
    await client.request({ scenario: 'news', method: 'GET', path: '/api/news', token: FAKE_TOKEN });
    assert.ok(!JSON.stringify(client.samples).includes(FAKE_TOKEN));
    await assert.rejects(
      client.request({ scenario: 'news', method: 'GET', path: '/api/strava/status', token: FAKE_TOKEN }),
      (error) => !String(error.message).includes(FAKE_TOKEN),
    );
  });
});
