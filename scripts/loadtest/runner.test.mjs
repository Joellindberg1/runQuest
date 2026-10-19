// Lasttestets körlogik prövad mot en lokal fejkserver (127.0.0.1): budgetar, märkning, städning och att Strava aldrig anropas.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ALLOWED_ROUTES, createClient } from './client.mjs';
import { startFakeServer } from './fakeServer.mjs';
import { CleanupRefused, RUN_DISTANCE_KM, RUN_KEY_PREFIX, SetupFailed, cleanupFromReport, runLoadtest } from './runner.mjs';
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

describe('markers', () => {
  it('uses the literal key prefix and distance that docs/loadtest.md and its SQL fallback depend on', () => {
    assert.equal(RUN_KEY_PREFIX, '10ad7e57');
    assert.equal(RUN_DISTANCE_KM, 1.01);
  });
});

describe('cleanupFromReport', () => {
  const usersFor = () => USERS.map((user, index) => ({ index, ...user, token: null }));
  /** Rapporten som den ser ut när den läses tillbaka från filen. */
  const asFile = (result) => JSON.parse(JSON.stringify({ createdRuns: result.createdRuns, cleanup: result.cleanup }));
  const runWithKey = (key, userIndex = 0, id = '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f') => ({ id, userIndex, key });
  const reportOf = (...runs) => ({ createdRuns: runs, cleanup: { skipped: runs.length, keptRuns: [], failedRuns: [] } });

  async function refuse(report) {
    server = await startFakeServer({ users: USERS });
    const client = createClient({ baseUrl: server.url });
    await assert.rejects(cleanupFromReport({ client, users: usersFor(), report }), CleanupRefused);
    assert.deepEqual(server.state.requests, []);
  }

  it('deletes the runs a kept run left behind, after logging their owners in again', async () => {
    const kept = await run({}, { keepRuns: true });
    assert.ok(server.state.runs.size > 0);
    const client = createClient({ baseUrl: server.url });
    const outcome = await cleanupFromReport({ client, users: usersFor(), report: asFile(kept.result) });
    assert.equal(outcome.deleted, kept.result.createdRuns.length);
    assert.equal(server.state.runs.size, 0);
  });

  it('takes the runs a finished run reported as kept or failed, and leaves the ones it already deleted alone', async () => {
    const locked = await run({ lockAllRuns: true });
    const report = asFile(locked.result);
    assert.ok(report.cleanup.keptRuns.length > 0);
    for (const run of server.state.runs.values()) run.locked = false;
    const client = createClient({ baseUrl: server.url });
    const outcome = await cleanupFromReport({ client, users: usersFor(), report });
    assert.equal(outcome.deleted, report.cleanup.keptRuns.length);

    const finished = await cleanupFromReport({ client, users: usersFor(), report: { createdRuns: report.createdRuns, cleanup: { skipped: 0, keptRuns: [], failedRuns: [] } } });
    assert.equal(finished.deleted, 0);
  });

  it('refuses a run whose key does not carry the loadtest prefix, before a single request is made', async () => {
    await refuse(reportOf(runWithKey('deadbeef-0000-4000-8000-000000000000')));
    await server.close();
    await refuse(reportOf(runWithKey(undefined)));
    await server.close();
    await refuse(reportOf(runWithKey('10ad7e57')));
  });

  it('refuses the whole report when only one of its runs is unmarked', async () => {
    await refuse(reportOf(runWithKey('10ad7e57-0000-4000-8000-000000000000'), runWithKey('deadbeef-0000-4000-8000-000000000000', 0, '1b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f')));
  });

  it('refuses a user index outside the user list, a non-integer one and a run id that is not a uuid', async () => {
    const key = '10ad7e57-0000-4000-8000-000000000000';
    await refuse(reportOf(runWithKey(key, 2)));
    await server.close();
    await refuse(reportOf(runWithKey(key, -1)));
    await server.close();
    await refuse(reportOf(runWithKey(key, 0.5)));
    await server.close();
    await refuse(reportOf(runWithKey(key, '0')));
    await server.close();
    await refuse(reportOf(runWithKey(key, 0, '../strava/status')));
  });

  it('refuses a report that is not an object with the expected lists', async () => {
    await refuse(null);
    await server.close();
    await refuse({ createdRuns: 'nope' });
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

  it('does not list keys of requests the server rejected without creating anything (400, 401, 429), only ones that may have written', async () => {
    for (const status of [400, 401, 429]) {
      const { result } = await run({ rejectRunsWith: status }, {}, { weights: { 'log-run': 1, news: 1 } });
      assert.equal(result.createdRuns.length, 0, `status ${status}`);
      assert.deepEqual(result.unresolvedKeys, [], `status ${status}`);
      await server.close();
    }
  });

  it('keeps going to cleanup and still returns a result when a virtual user throws', async () => {
    server = await startFakeServer({ users: USERS });
    const real = createClient({ baseUrl: server.url });
    let created = 0;
    const client = {
      samples: real.samples,
      request: async (args) => {
        const result = await real.request(args);
        if (args.scenario === 'log-run' && result.outcome === 'ok') created++;
        if (args.scenario === 'news' && created >= 2) throw new Error('boom');
        return result;
      },
    };
    const result = await runLoadtest({ client, options: options({ runBudget: 3, durationMs: 3000 }), log: () => {}, random: seeded(7), weights: { 'log-run': 1, news: 1 } });
    assert.equal(result.failure, 'boom');
    assert.ok(result.createdRuns.length >= 2);
    assert.equal(result.cleanup.deleted, result.createdRuns.length);
    assert.equal(server.state.runs.size, 0);
    assert.ok(result.summary.elapsedSeconds < 3);
  });

  it('stops early on an abort signal, cleans up what it created and marks the result as interrupted', async () => {
    server = await startFakeServer({ users: USERS });
    const client = createClient({ baseUrl: server.url });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250);
    const result = await runLoadtest({
      client, options: options({ durationMs: 20_000, runBudget: 4 }), log: () => {}, random: seeded(7), signal: controller.signal, weights: { 'log-run': 1, news: 1 },
    });
    assert.equal(result.interrupted, true);
    assert.ok(result.summary.elapsedSeconds < 5);
    assert.ok(result.createdRuns.length > 0);
    assert.equal(result.cleanup.deleted, result.createdRuns.length);
    assert.equal(server.state.runs.size, 0);
  });

  it('is not marked interrupted or failed on a normal run', async () => {
    const { result } = await run();
    assert.equal(result.interrupted, false);
    assert.equal(result.failure, null);
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
