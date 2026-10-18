// Loggboken över inloggningar: backendens gräns är 20 per 15 minuter och IP, och den delas av alla körningar från samma dator.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { LEDGER_WINDOW_MS, LoginWindowBusy, assertLoginRoom, createFileLedger, loginsInWindow } from './loginLedger.mjs';
import { MAX_LOGINS_PER_RUN } from './config.mjs';

const HOST = 'http://staging.invalid';
const entry = (at, count, baseUrl = HOST) => ({ id: `e${at}`, at, count, baseUrl });

describe('loginsInWindow', () => {
  it('counts only entries for the same host that are younger than 15 minutes', () => {
    const now = 10 * LEDGER_WINDOW_MS;
    const entries = [
      entry(now - LEDGER_WINDOW_MS - 1, 9),
      entry(now - LEDGER_WINDOW_MS + 1, 4),
      entry(now - 1000, 3),
      entry(now - 1000, 7, 'http://other.invalid'),
    ];
    assert.equal(loginsInWindow(entries, HOST, now), 7);
  });
});

describe('assertLoginRoom', () => {
  const now = 10 * LEDGER_WINDOW_MS;

  it('passes while the window plus the new run stays within the cap', () => {
    assert.doesNotThrow(() => assertLoginRoom([entry(now - 1000, 5)], HOST, MAX_LOGINS_PER_RUN - 5, now));
  });

  it('refuses a second run inside the window and says how long to wait', () => {
    const entries = [entry(now - 60_000, 12)];
    assert.throws(() => assertLoginRoom(entries, HOST, 5, now), (error) => error instanceof LoginWindowBusy && /14 minut/.test(error.message));
  });

  it('lets a run through after the window has passed, and when the check is forced', () => {
    assert.doesNotThrow(() => assertLoginRoom([entry(now - LEDGER_WINDOW_MS - 1, 15)], HOST, 15, now));
    assert.doesNotThrow(() => assertLoginRoom([entry(now - 1000, 15)], HOST, 15, now, { force: true }));
  });
});

describe('createFileLedger', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'runquest-ledger-test-'));

  it('is empty when there is no file, and keeps reservations between instances', () => {
    const path = join(dir(), 'login-ledger.json');
    const first = createFileLedger(path, () => 1000);
    assert.deepEqual(first.entries(), []);
    first.reserve(HOST, 7);
    const second = createFileLedger(path, () => 2000);
    assert.equal(loginsInWindow(second.entries(), HOST, 2000), 7);
  });

  it('settles a reservation to the number of logins actually made', () => {
    const path = join(dir(), 'login-ledger.json');
    const ledger = createFileLedger(path, () => 1000);
    const id = ledger.reserve(HOST, 12);
    ledger.settle(id, 4);
    assert.equal(loginsInWindow(ledger.entries(), HOST, 1000), 4);
  });

  it('drops entries older than the window when it writes, and stores no logins or passwords', () => {
    const path = join(dir(), 'login-ledger.json');
    let clock = 0;
    const ledger = createFileLedger(path, () => clock);
    ledger.reserve(HOST, 3);
    clock = LEDGER_WINDOW_MS * 2;
    ledger.reserve(HOST, 2);
    const text = readFileSync(path, 'utf8');
    assert.equal(JSON.parse(text).entries.length, 1);
    assert.ok(!/password|login"|@/.test(text));
  });

  it('refuses a corrupt file instead of guessing that the window is empty', () => {
    const path = join(dir(), 'login-ledger.json');
    writeFileSync(path, '{not json');
    assert.throws(() => createFileLedger(path, () => 0).entries(), /login-ledger/);
  });
});
