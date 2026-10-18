/**
 * The check of the token key when the process starts (ADR 013 decision 9, owner decision Ö5): a key that is missing, malformed or not
 * accepted in the environment is a KRITISKT line that becomes a fatal Sentry event, once, and the process goes on (only the Strava
 * track is off, through checkSealingReady). Keys are generated per run: nothing here is a real key. No network, Sentry is faked.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';
import { CriticalAlert } from '../../utils/criticalAlert.js';
import { logger } from '../../utils/logger.js';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV } from '../../utils/secretBox.js';
import { reportTokenKeyAtStartup } from '../tokenKeyStartup.js';

const newKey = () => randomBytes(32).toString('base64');
const entry = (kid: string) => `${kid}:${newKey()}`;

function configure(env: { node?: string; sentry?: string; active?: string; retired?: string }) {
  vi.stubEnv('NODE_ENV', env.node ?? 'production');
  vi.stubEnv('SENTRY_ENVIRONMENT', env.sentry ?? '');
  vi.stubEnv(ACTIVE_KEY_ENV, env.active ?? '');
  vi.stubEnv(RETIRED_KEYS_ENV, env.retired ?? '');
}

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(logger, 'info').mockImplementation(() => {});
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  error = vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const text = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((call) => String(call[0])).join('\n');
const alertOf = (call: unknown[]) => call.find((arg): arg is CriticalAlert => arg instanceof CriticalAlert);

describe('the token key check at startup', () => {
  it('production without a key logs one KRITISKT line with the token_key source and says that only Strava is off', () => {
    configure({ active: '' });

    const result = reportTokenKeyAtStartup();

    expect(result).toEqual({ ok: false, problem: 'key_missing' });
    expect(error).toHaveBeenCalledTimes(1);
    const call = error.mock.calls[0];
    expect(String(call[0]).startsWith('🚨 KRITISKT: Strava-tokenkryptering')).toBe(true);
    expect(String(call[0])).toContain('TOKEN_ENCRYPTION_KEY');
    expect(String(call[0])).toContain('Strava-synken är avstängd');
    expect(String(call[0])).toContain('resten av appen fungerar');
    expect(alertOf(call)?.source).toBe('token_key');
  });

  it('production with a malformed key logs a KRITISKT line that names the problem and never the value', () => {
    const garbage = 'SECRETGARBAGEvalue0123456789';
    for (const active of [`prod-1:${garbage}`, garbage, `prod-1:${newKey()}:extra`]) {
      error.mockClear();
      configure({ active });

      expect(reportTokenKeyAtStartup(), active).toEqual({ ok: false, problem: 'key_invalid' });

      expect(error).toHaveBeenCalledTimes(1);
      expect(text(error)).toContain('ogiltig');
      expect(text(error)).not.toContain(garbage);
      expect(text(error)).not.toContain(active.split(':')[1] ?? active);
      expect(alertOf(error.mock.calls[0])?.source).toBe('token_key');
    }
  });

  it('production with a key id the environment does not accept logs a KRITISKT line that names the id and the prefix, never the key', () => {
    const testKey = entry('test-1');
    configure({ active: testKey });

    const result = reportTokenKeyAtStartup();

    expect(result).toMatchObject({ ok: false, problem: 'kid_not_allowed' });
    expect(error).toHaveBeenCalledTimes(1);
    const line = text(error);
    expect(line.startsWith('🚨 KRITISKT')).toBe(true);
    expect(line).toContain('test-1');
    expect(line).toContain('"prod-"');
    expect(line).toContain('SENTRY_ENVIRONMENT som inte är staging'); // the prefix follows from it, so the line says what to check
    expect(line).not.toContain(testKey.split(':')[1]);
    expect(alertOf(error.mock.calls[0])?.source).toBe('token_key');
  });

  it('a retired key with the wrong prefix is named too', () => {
    configure({ active: entry('prod-2'), retired: `${entry('prod-1')},${entry('test-1')}` });

    reportTokenKeyAtStartup();

    expect(text(error)).toContain('test-1');
    expect(text(error)).not.toContain('prod-1');
  });

  it('staging names the stg- prefix', () => {
    configure({ sentry: 'staging', active: entry('prod-1') });

    reportTokenKeyAtStartup();

    expect(text(error)).toContain('"stg-"');
    expect(text(error)).toContain('SENTRY_ENVIRONMENT=staging');
  });

  it('a usable key logs one info line with the key ids and no alarm', () => {
    const active = entry('prod-2');
    const retired = entry('prod-1');
    configure({ active, retired });

    const result = reportTokenKeyAtStartup();

    expect(result).toMatchObject({ ok: true });
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const line = text(info);
    expect(line).toContain('prod-2');
    expect(line).toContain('1 retired');
    for (const material of [active.split(':')[1], retired.split(':')[1], active.split(':')[1].slice(0, 8)]) expect(line).not.toContain(material);
  });

  it('outside production a missing key is a plain warning that the Strava track is off, not an alarm', () => {
    for (const node of ['development', 'test']) {
      warn.mockClear();
      configure({ node, active: '' });

      expect(reportTokenKeyAtStartup(), node).toEqual({ ok: false, problem: 'key_missing' });

      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(text(warn)).not.toContain('KRITISK');
      expect(text(warn)).toContain('TOKEN_ENCRYPTION_KEY');
    }
  });

  it('outside production any key id is fine, the open test key included', () => {
    configure({ node: 'development', active: entry('test-1') });

    expect(reportTokenKeyAtStartup()).toMatchObject({ ok: true });
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the token key alarm in sentry', () => {
  let sentry: FakeSentry;
  beforeEach(() => {
    vi.restoreAllMocks(); // the real logger, so that the error sink reaches Sentry
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
    sentry = startFakeSentry();
  });
  afterEach(async () => {
    await sentry.stop();
  });

  it('a missing key becomes one fatal event tagged alert=critical and source=token_key', async () => {
    configure({ active: '' });

    reportTokenKeyAtStartup();
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('fatal');
    expect(sent[0].tags).toMatchObject({ alert: 'critical', source: 'token_key' });
    expect(sent[0].message).toContain('KRITISKT');
  });

  it('a refused key id becomes a fatal event whose text has the key id and none of the key', async () => {
    const testKey = entry('test-1');
    configure({ active: testKey });

    reportTokenKeyAtStartup();
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].tags).toMatchObject({ alert: 'critical', source: 'token_key' });
    const rendered = JSON.stringify(sent[0]);
    expect(rendered).toContain('test-1');
    expect(rendered).not.toContain(testKey.split(':')[1]);
  });

  it('a usable key sends nothing', async () => {
    configure({ active: entry('prod-1') });

    reportTokenKeyAtStartup();

    expect(await sentry.flush()).toHaveLength(0);
  });
});
