// Konfiguration ur miljövariabler. Inloggningsuppgifter kommer bara därifrån och får aldrig skrivas ut i ett felmeddelande.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseUrlRefused, STAGING_BACKEND_URL } from './guard.mjs';
import { MAX_LOGINS_PER_RUN, loadConfig } from './config.mjs';
import { TARGETS } from './targets.mjs';

const USERS = JSON.stringify([
  { login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' },
  { login: 'fake-user-2@example.invalid', password: 'FAKE_TEST_PASSWORD_2_not_real' },
]);
const env = (extra = {}) => ({ LOADTEST_USERS: USERS, ...extra });

describe('loadConfig', () => {
  it('defaults to the staging backend and the target numbers', () => {
    const config = loadConfig(env());
    assert.equal(config.baseUrl, STAGING_BACKEND_URL);
    assert.equal(config.vus, TARGETS.concurrentUsers);
    assert.equal(config.durationSeconds, TARGETS.durationSeconds);
    assert.equal(config.users.length, 2);
  });

  it('refuses a production base URL before anything else is read', () => {
    assert.throws(() => loadConfig({ LOADTEST_BASE_URL: 'https://api.runquest.dev' }), BaseUrlRefused);
  });

  it('requires users and reads them as login/password pairs', () => {
    assert.throws(() => loadConfig({}), /LOADTEST_USERS/);
    assert.throws(() => loadConfig(env({ LOADTEST_USERS: '[]' })), /LOADTEST_USERS/);
    assert.throws(() => loadConfig(env({ LOADTEST_USERS: '[{"login":"a"}]' })), /LOADTEST_USERS/);
    assert.throws(() => loadConfig(env({ LOADTEST_USERS: '{"login":"a","password":"b"}' })), /LOADTEST_USERS/);
  });

  it('never echoes passwords from a malformed LOADTEST_USERS', () => {
    for (const bad of ['{"password": "FAKE_TEST_PASSWORD_leak', '[{"login":"a","password":"FAKE_TEST_PASSWORD_leak","extra":']) {
      try {
        loadConfig(env({ LOADTEST_USERS: bad }));
        assert.fail('should throw');
      } catch (error) {
        assert.ok(!String(error.message).includes('FAKE_TEST_PASSWORD_leak'));
      }
    }
  });

  it('keeps the login attempts of one run under the backend limit of 20 per 15 minutes', () => {
    assert.ok(MAX_LOGINS_PER_RUN < 20);
    assert.equal(loadConfig(env({ LOADTEST_LOGIN_BUDGET: '5' })).loginBudget, 5);
    assert.throws(() => loadConfig(env({ LOADTEST_LOGIN_BUDGET: String(MAX_LOGINS_PER_RUN) })), /LOADTEST_LOGIN_BUDGET/);
  });

  it('rejects numbers outside their bounds and non-numbers', () => {
    assert.throws(() => loadConfig(env({ LOADTEST_VUS: '0' })), /LOADTEST_VUS/);
    assert.throws(() => loadConfig(env({ LOADTEST_VUS: '500' })), /LOADTEST_VUS/);
    assert.throws(() => loadConfig(env({ LOADTEST_DURATION_S: 'abc' })), /LOADTEST_DURATION_S/);
    assert.throws(() => loadConfig(env({ LOADTEST_RUN_BUDGET: '-1' })), /LOADTEST_RUN_BUDGET/);
  });

  it('keeps created runs only when asked to', () => {
    assert.equal(loadConfig(env()).keepRuns, false);
    assert.equal(loadConfig(env({ LOADTEST_KEEP_RUNS: '1' })).keepRuns, true);
  });
});
