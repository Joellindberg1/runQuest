// Kopplingstest av kommandoraderna: en nekad bas-URL stoppar körningen innan något händer, och den lokala provkörningen går hela vägen
// mot fejkservern. Barnprocesserna får en minimal miljö (inga riktiga tokens) och inget nätverk mot något annat än 127.0.0.1 förekommer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runLocal } from './local.mjs';

const RUN = fileURLToPath(new URL('./run.mjs', import.meta.url));
const USERS = JSON.stringify([{ login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' }]);

function cli(env) {
  return spawnSync(process.execPath, [RUN], { env: { PATH: process.env.PATH, ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }), ...env }, encoding: 'utf8', timeout: 20_000 });
}

describe('run.mjs', () => {
  it('refuses a production base URL with exit code 1 before any request is made', () => {
    const result = cli({ LOADTEST_USERS: USERS, LOADTEST_BASE_URL: 'https://api.runquest.dev' });
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
