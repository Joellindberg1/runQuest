import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sink = vi.fn();
const startSentry = vi.fn((_options: { dsn: string; environment: string; release?: string; tracesSampleRate?: number; documentPath?: string }) => sink);
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
    expect(startSentry).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://key@example.invalid/1', environment: 'staging' }));
  });

  it('passes the release baked into the build on to the client, and none when it is blank', async () => {
    const { enableErrorReporting } = await freshModule();

    await enableErrorReporting({ ...env, VITE_SENTRY_RELEASE: 'runquest@0.8.0+abcdef1' });

    expect(startSentry).toHaveBeenCalledWith(expect.objectContaining({ dsn: env.VITE_SENTRY_DSN, environment: 'staging', release: 'runquest@0.8.0+abcdef1' }));

    const second = await freshModule();
    startSentry.mockClear();
    await second.enableErrorReporting({ ...env, VITE_SENTRY_RELEASE: '  ' });

    expect(startSentry.mock.calls[0]?.[0].release).toBeUndefined();
  });

  it('falls back to the build mode when no environment is set', async () => {
    const { enableErrorReporting } = await freshModule();

    await enableErrorReporting({ VITE_SENTRY_DSN: env.VITE_SENTRY_DSN, MODE: 'production' });

    expect(startSentry).toHaveBeenCalledWith(expect.objectContaining({ dsn: env.VITE_SENTRY_DSN, environment: 'production' }));
  });

  it('asks for at most a tenth of the page loads to be measured, and lets the environment lower it', async () => {
    const { enableErrorReporting } = await freshModule();
    await enableErrorReporting(env);
    expect(startSentry.mock.calls[0]?.[0].tracesSampleRate).toBe(0.1);

    startSentry.mockClear();
    const { enableErrorReporting: again } = await freshModule();
    await again({ ...env, VITE_SENTRY_TRACES_SAMPLE_RATE: '1' });
    expect(startSentry.mock.calls[0]?.[0].tracesSampleRate).toBe(0.1);

    startSentry.mockClear();
    const { enableErrorReporting: lowered } = await freshModule();
    await lowered({ ...env, VITE_SENTRY_TRACES_SAMPLE_RATE: '0' });
    expect(startSentry.mock.calls[0]?.[0].tracesSampleRate).toBe(0);
  });

  it('tells the client which page the document was loaded on, as it was before any later navigation', async () => {
    const location = { pathname: '/board' };
    vi.stubGlobal('window', { location });
    try {
      const { enableErrorReporting } = await freshModule();
      location.pathname = '/profile';
      await enableErrorReporting(env);

      expect(startSentry.mock.calls[0]?.[0].documentPath).toBe('/board');
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('a stale chunk reload sends no error report', async () => {
    const { enableErrorReporting, reportError } = await freshModule();
    const { installStaleChunkReload } = await import('@/shared/utils/staleChunkReload');
    let listener: ((event: Event) => void) | undefined;
    const reload = vi.fn();
    const stored = new Map<string, string>();
    installStaleChunkReload(
      { addEventListener: (_type, fn) => { listener = fn; }, location: { reload } },
      () => ({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } }),
      () => 1_000_000,
    );
    await enableErrorReporting(env);

    const event = new Event('vite:preloadError', { cancelable: true });
    Object.assign(event, { payload: new Error('Failed to fetch dynamically imported module: https://runquest.dev/assets/SettingsPage-abc.js') });
    listener?.(event);
    // Vite sväljer importfelet och React.lazy får undefined: det följdfelet ska inte heller rapporteras.
    reportError(new TypeError("Cannot read properties of undefined (reading 'default')"));

    expect(reload).toHaveBeenCalledTimes(1);
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
