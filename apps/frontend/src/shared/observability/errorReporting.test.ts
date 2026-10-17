import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sink = vi.fn();
const startSentry = vi.fn((_options: { dsn: string; environment: string }) => sink);
let clientLoads = 0;

vi.mock('./sentryClient', () => {
  clientLoads += 1;
  return { startSentry };
});

async function freshModule() {
  vi.resetModules();
  return import('./errorReporting');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('VITE_SENTRY_DSN', '');
  sink.mockClear();
  startSentry.mockClear();
  clientLoads = 0;
});

describe('errorReporting without a DSN', () => {
  it('never loads the Sentry client and reports nothing', async () => {
    const { enableErrorReporting, reportError } = await freshModule();

    await enableErrorReporting({ VITE_SENTRY_DSN: undefined, MODE: 'production' });
    reportError(new Error('boom'));

    expect(clientLoads).toBe(0);
    expect(startSentry).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });

  it('treats a blank DSN as no DSN', async () => {
    const { enableErrorReporting } = await freshModule();

    await enableErrorReporting({ VITE_SENTRY_DSN: '   ', MODE: 'production' });

    expect(clientLoads).toBe(0);
  });
});

describe('errorReporting with a DSN', () => {
  const env = { VITE_SENTRY_DSN: 'https://key@example.invalid/1', VITE_SENTRY_ENVIRONMENT: 'staging', MODE: 'production' };

  beforeEach(() => {
    vi.stubEnv('VITE_SENTRY_DSN', env.VITE_SENTRY_DSN);
  });

  it('loads the client once, with environment from VITE_SENTRY_ENVIRONMENT', async () => {
    const { enableErrorReporting } = await freshModule();

    await enableErrorReporting(env);
    await enableErrorReporting(env);

    expect(startSentry).toHaveBeenCalledTimes(1);
    expect(startSentry).toHaveBeenCalledWith({ dsn: 'https://key@example.invalid/1', environment: 'staging' });
  });

  it('falls back to the build mode when no environment is set', async () => {
    const { enableErrorReporting } = await freshModule();

    await enableErrorReporting({ VITE_SENTRY_DSN: env.VITE_SENTRY_DSN, MODE: 'production' });

    expect(startSentry).toHaveBeenCalledWith({ dsn: env.VITE_SENTRY_DSN, environment: 'production' });
  });

  it('forwards reports once started', async () => {
    const { enableErrorReporting, reportError } = await freshModule();
    await enableErrorReporting(env);
    const error = new Error('boom');

    reportError(error, { where: 'test' });

    expect(sink).toHaveBeenCalledWith(error, { where: 'test' });
  });

  it('queues reports that happen before start and flushes them in order', async () => {
    const { enableErrorReporting, reportError } = await freshModule();
    const first = new Error('first');
    const second = new Error('second');

    reportError(first);
    reportError(second);
    expect(sink).not.toHaveBeenCalled();
    await enableErrorReporting(env);

    expect(sink.mock.calls.map((call) => call[0])).toEqual([first, second]);
  });

  it('keeps only the newest reports when the queue overflows', async () => {
    const { enableErrorReporting, reportError } = await freshModule();

    for (let index = 0; index < 100; index += 1) reportError(new Error(`e${index}`));
    await enableErrorReporting(env);

    expect(sink.mock.calls.length).toBeLessThan(100);
    expect((sink.mock.calls.at(-1)?.[0] as Error).message).toBe('e99');
  });

  it('does not report reload-after-deploy errors, before or after start', async () => {
    const { enableErrorReporting, reportError } = await freshModule();
    const stale = new Error('Failed to fetch dynamically imported module: https://runquest.dev/assets/A.js');

    reportError(stale);
    await enableErrorReporting(env);
    reportError(stale);

    expect(sink).not.toHaveBeenCalled();
  });

  it('does not report requests that got no response (backend down)', async () => {
    const { enableErrorReporting, reportError } = await freshModule();

    reportError(new TypeError('Failed to fetch'));
    await enableErrorReporting(env);
    reportError(new TypeError('Failed to fetch (api.runquest.dev)'));
    reportError(new TypeError('Load failed'));

    expect(sink).not.toHaveBeenCalled();
  });

  it('turns tracking off quietly when the chunk is blocked or missing', async () => {
    vi.resetModules();
    vi.doMock('./sentryClient', () => {
      throw new Error('Failed to fetch dynamically imported module: https://runquest.dev/assets/optional-k3j9x.js');
    });
    const { enableErrorReporting, reportError } = await import('./errorReporting');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(enableErrorReporting(env)).resolves.toBeUndefined();
    expect(() => reportError(new Error('later'))).not.toThrow();
    vi.doUnmock('./sentryClient');
  });

  it('swallows a failing client load and keeps the app running', async () => {
    const { enableErrorReporting, reportError } = await freshModule();
    startSentry.mockImplementationOnce(() => { throw new Error('init failed'); });

    await expect(enableErrorReporting(env)).resolves.toBeUndefined();
    expect(() => reportError(new Error('later'))).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
  });
});
