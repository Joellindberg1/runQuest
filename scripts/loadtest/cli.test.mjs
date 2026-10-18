// Kopplingstest av kommandoraderna: en nekad bas-URL stoppar körningen innan något händer, och den lokala provkörningen går hela vägen
// mot fejkservern. Barnprocesserna får en minimal miljö (inga riktiga tokens) och inget nätverk mot något annat än 127.0.0.1 förekommer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { startFakeServer } from './fakeServer.mjs';
import { runLocal } from './local.mjs';
import { executeLoadtest } from './run.mjs';

const RUN = fileURLToPath(new URL('./run.mjs', import.meta.url));
const USERS = JSON.stringify([{ login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' }]);

function cli(env) {
  return spawnSync(process.execPath, [RUN], { env: { PATH: process.env.PATH, ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }), ...env }, encoding: 'utf8', timeout: 20_000 });
}

describe('run.mjs', () => {
  it('refuses a production base URL with exit code 1 before any request is made', () => {
    const result = cli({ LOADTEST_USERS: USERS, LOADTEST_BASE_URL: 'https://backend.invalid' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Vägrar köra lasttestet/);
    assert.ok(!result.stderr.includes('FAKE_TEST_PASSWORD'));
  });

  it('refuses to run without users, naming the variable and nothing else', () => {
    const result = cli({ LOADTEST_BASE_URL: 'http://127.0.0.1:1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LOADTEST_USERS/);
  });

  it('refuses to run when CI is set', () => {
    const result = cli({ LOADTEST_USERS: USERS, LOADTEST_BASE_URL: 'http://127.0.0.1:1', CI: 'true' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CI/);
  });

  it('refuses --cleanup for a report with an unmarked key before it connects to anything', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'runquest-loadtest-test-')), 'report.json');
    const unmarked = { id: '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f', userIndex: 0, key: 'deadbeef-0000-4000-8000-000000000000' };
    writeFileSync(file, JSON.stringify({ createdRuns: [unmarked], cleanup: { skipped: 1, keptRuns: [], failedRuns: [] } }));
    const result = spawnSync(process.execPath, [RUN, '--cleanup', file], {
      env: { PATH: process.env.PATH, ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }), LOADTEST_USERS: USERS, LOADTEST_BASE_URL: 'http://127.0.0.1:1' },
      encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ingenting raderades/);
  });
});

describe('executeLoadtest', () => {
  const U1 = { login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' };
  const U2 = { login: 'fake-user-2@example.invalid', password: 'FAKE_TEST_PASSWORD_2_not_real' };
  let server;
  afterEach(async () => { await server?.close(); server = undefined; });

  async function execute({ serverUsers = [U1, U2], extraEnv = {}, ledger, abortAfterMs = 200 } = {}) {
    server = await startFakeServer({ users: serverUsers });
    const outDir = mkdtempSync(join(tmpdir(), 'runquest-loadtest-test-'));
    const config = loadConfig({
      LOADTEST_BASE_URL: server.url, LOADTEST_USERS: JSON.stringify([U1, U2]), LOADTEST_VUS: '2', LOADTEST_OUT_DIR: outDir,
      LOADTEST_THINK_MS: '20', ...extraEnv,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), abortAfterMs);
    const outcome = await executeLoadtest({ config, log: () => {}, ledger, signal: controller.signal });
    return { outcome, outDir };
  }

  it('writes a report with the failure and exits 1 when the setup login fails, without the password in it', async () => {
    const { outcome } = await execute({ serverUsers: [U1] });
    assert.equal(outcome.exitCode, 1);
    const text = readFileSync(outcome.outPath, 'utf8');
    assert.equal(JSON.parse(text).failure.includes('användare nr 2'), true);
    assert.ok(!text.includes('FAKE_TEST_PASSWORD'));
  });

  it('writes the report of an interrupted run, cleans up, and exits 3 so it never reads as a measurement', async () => {
    const { outcome } = await execute();
    const report = JSON.parse(readFileSync(outcome.outPath, 'utf8'));
    assert.equal(report.interrupted, true);
    assert.equal(report.measurement, false);
    assert.equal(outcome.exitCode, 3);
    assert.equal(server.state.runs.size, 0);
  });

  it('reserves the logins in the ledger before the first request and settles to the number actually made', async () => {
    const calls = [];
    const ledger = {
      entries: () => [],
      reserve: (baseUrl, count) => { calls.push(['reserve', count, server.state.requests.length]); return 'id-1'; },
      settle: (id, count) => calls.push(['settle', id, count]),
    };
    await execute({ ledger, extraEnv: { LOADTEST_LOGIN_BUDGET: '4' } });
    assert.deepEqual(calls[0], ['reserve', 2 + 4, 0]);
    assert.deepEqual(calls[1], ['settle', 'id-1', server.state.loginAttempts]);
  });

  it('refuses a run the ledger has no room for, before any request is made', async () => {
    const full = { entries: () => [{ id: 'x', at: Date.now(), count: 15, baseUrl: server.url }], reserve: () => 'id', settle: () => {} };
    await assert.rejects(execute({ ledger: full, abortAfterMs: 50 }), /Loggboken/);
    assert.deepEqual(server.state.requests, []);
  });

  it('runs anyway when the ledger check is switched off, but still records the logins it makes', async () => {
    const calls = [];
    const full = { entries: () => [{ id: 'x', at: Date.now(), count: 15, baseUrl: server.url }], reserve: () => calls.push('reserve'), settle: () => calls.push('settle') };
    const { outcome } = await execute({ ledger: full, extraEnv: { LOADTEST_IGNORE_LOGIN_LEDGER: '1' } });
    assert.equal(outcome.exitCode, 3);
    assert.ok(server.state.requests.length > 0);
    assert.deepEqual(calls, ['reserve', 'settle']);
  });

  it('settles the ledger even when the setup login fails', async () => {
    const calls = [];
    const ledger = { entries: () => [], reserve: () => 'id-2', settle: (id, count) => calls.push([id, count]) };
    await execute({ serverUsers: [U1], ledger });
    assert.deepEqual(calls, [['id-2', server.state.loginAttempts]]);
  });
});

describe('runLocal', () => {
  it('runs the whole chain against the fake server, writes a report file and leaves no runs behind', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'runquest-loadtest-test-'));
    const lines = [];
    const { evaluation, outPath } = await runLocal(
      { LOADTEST_DURATION_S: '5', LOADTEST_VUS: '4', LOADTEST_THINK_MS: '50', LOADTEST_LOCAL_LATENCY_MS: '5', LOADTEST_OUT_DIR: outDir },
      (line) => lines.push(line),
    );
    assert.equal(evaluation.passed, true);
    assert.ok(existsSync(outPath));
    assert.equal(readdirSync(outDir).length, 1);
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(report.summary.total.failed, 0);
    assert.match(lines.join('\n'), /0 Strava-träffar, 0 rundor kvar/);
    assert.ok(!JSON.stringify(report).includes('FAKE_LOCAL_PASSWORD'));
  });
});
