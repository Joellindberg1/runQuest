// Lasttestets körlogik prövad mot en lokal fejkserver (127.0.0.1): budgetar, märkning, städning och att Strava aldrig anropas.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ALLOWED_ROUTES, createClient } from './client.mjs';
import { startFakeServer } from './fakeServer.mjs';
import { RUN_DISTANCE_KM, RUN_KEY_PREFIX, SetupFailed, cleanupRuns, loginForCleanup, runLoadtest } from './runner.mjs';
import { newRunKey } from './scenarios.mjs';

// Fast frö: scenarieurvalet blir detsamma varje körning, så proven är inte beroende av slumpen.
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = [
  { login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' },
  { login: 'fake-user-2@example.invalid', password: 'FAKE_TEST_PASSWORD_2_not_real' },
];

const options = (extra = {}) => ({
  users: USERS, vus: 4, durationMs: 400, thinkMs: 5, loginBudget: 3, runBudget: 6, keepRuns: false, ...extra,
});

let server;
afterEach(async () => { await server?.close(); server = undefined; });

async function run(serverOptions = {}, runOptions = {}, extra = {}) {
  server = await startFakeServer({ users: USERS, ...serverOptions });
  const client = createClient({ baseUrl: server.url });
  const result = await runLoadtest({ client, options: options(runOptions), log: () => {}, random: seeded(7), ...extra });
  return { result, client };
}

describe('newRunKey', () => {
  it('is a valid uuid v4 that starts with the loadtest prefix and differs between calls', () => {
    const keys = Array.from({ length: 50 }, () => newRunKey());
    for (const key of keys) {
      assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.ok(key.startsWith(`${RUN_KEY_PREFIX}-`));
    }
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('cleanupRuns', () => {
  it('deletes runs left by an earlier run after logging in the owners again', async () => {
    const kept = await run({}, { keepRuns: true });
    assert.ok(server.state.runs.size > 0);
    const client = createClient({ baseUrl: server.url });
    const users = USERS.map((user, index) => ({ index, ...user, token: null }));
    await loginForCleanup({ client, users, createdRuns: kept.result.createdRuns });
    const outcome = await cleanupRuns({ client, users, createdRuns: kept.result.createdRuns });
    assert.equal(outcome.deleted, kept.result.createdRuns.length);
    assert.equal(server.state.runs.size, 0);
  });
});

describe('runLoadtest', () => {
  it('exercises login, leaderboard, news and log-run without a single failed request', async () => {
    const { result } = await run();
    for (const name of ['login', 'leaderboard', 'news', 'log-run']) {
      assert.ok(result.summary.scenarios[name]?.count > 0, `${name} was never run`);
    }
    assert.equal(result.summary.total.failed, 0);
    assert.equal(result.summary.total.rateLimited, 0);
  });

  it('only ever requests the allowed routes and never touches Strava', async () => {
    await run();
    assert.ok(server.state.requests.length > 0);
    for (const { method, path } of server.state.requests) {
      assert.ok(ALLOWED_ROUTES.some((route) => route.method === method && route.pattern.test(path)), `${method} ${path}`);
    }
    assert.equal(server.state.stravaHits, 0);
  });

  it('stays within the login budget plus one login per user', async () => {
    await run({}, { loginBudget: 3 }, { weights: { login: 1, news: 1 } });
    assert.equal(server.state.loginAttempts, USERS.length + 3);
  });

  it('stops logging in after the first 429 so it never keeps hammering a limiter', async () => {
    const { result } = await run({ loginLimit: USERS.length }, { vus: 1, loginBudget: 12, runBudget: 0, durationMs: 600 }, { weights: { login: 1 } });
    assert.equal(result.summary.scenarios.login.rateLimited, 1);
    assert.equal(server.state.loginAttempts, USERS.length + 1);
  });

  it('marks every run it creates with the loadtest key prefix and a fixed distance, and stays within the run budget', async () => {
    const { result } = await run({}, { keepRuns: true, runBudget: 5 }, { weights: { 'log-run': 1, news: 1 } });
    const runs = [...server.state.runs.values()];
    assert.equal(runs.length, 5);
    for (const created of runs) {
      assert.ok(created.client_request_id.startsWith(`${RUN_KEY_PREFIX}-`));
      assert.equal(created.distance, RUN_DISTANCE_KM);
    }
    assert.equal(result.createdRuns.length, runs.length);
  });

  it('deletes the runs it created when the run ends, and keeps them when asked to', async () => {
    const cleaned = await run();
    assert.ok(cleaned.result.cleanup.deleted > 0);
    assert.equal(server.state.runs.size, 0);
    await server.close();

    const kept = await run({}, { keepRuns: true });
    assert.equal(kept.result.cleanup.deleted, 0);
    assert.ok(server.state.runs.size > 0);
  });

  it('reports runs it could not delete (event-qualified, 409) as kept instead of failing, and still lists them', async () => {
    const { result } = await run({ lockAllRuns: true });
    assert.ok(result.cleanup.kept > 0);
    assert.equal(result.cleanup.deleted, 0);
    assert.equal(result.createdRuns.length, result.cleanup.kept);
  });

  it('lists the idempotency keys of runs whose response carried no run id, so they can be found by key later', async () => {
    const { result } = await run({ failRuns: true });
    assert.equal(result.createdRuns.length, 0);
    assert.ok(result.unresolvedKeys.length > 0);
    assert.ok(result.unresolvedKeys.every((key) => key.startsWith(`${RUN_KEY_PREFIX}-`)));
  });

  it('keeps cleanup traffic out of the target figures', async () => {
    const { result } = await run();
    assert.ok(result.summary.scenarios.cleanup.count > 0);
    const counted = Object.entries(result.summary.scenarios).filter(([name]) => name !== 'cleanup').reduce((n, [, s]) => n + s.count, 0);
    assert.equal(result.summary.total.count, counted);
  });

  it('writes no tokens or passwords into the result', async () => {
    const { result } = await run();
    const text = JSON.stringify(result);
    assert.ok(!text.includes('token-user'));
    assert.ok(!text.includes('FAKE_TEST_PASSWORD'));
    assert.ok(!text.includes('example.invalid'));
  });

  it('aborts before any load when a user cannot log in, without echoing the password', async () => {
    server = await startFakeServer({ users: [USERS[0]] });
    const client = createClient({ baseUrl: server.url });
    await assert.rejects(
      runLoadtest({ client, options: options(), log: () => {}, random: seeded(7) }),
      (error) => error instanceof SetupFailed && !error.message.includes('FAKE_TEST_PASSWORD') && !error.message.includes('example.invalid'),
    );
    assert.equal(server.state.requests.filter((r) => r.path !== '/api/auth/login').length, 0);
  });
});
