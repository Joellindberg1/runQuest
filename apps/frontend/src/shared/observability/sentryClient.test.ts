import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn((options: Record<string, unknown>) => ({ name: 'BrowserTracing', options })),
  withStaticSpan: vi.fn(<T,>(callback: T) => callback),
  getCurrentScope: vi.fn(() => ({ setTransactionName: sentry.setTransactionName })),
  setTransactionName: vi.fn(),
}));

vi.mock('@sentry/react', () => sentry);

import { startSentry } from './sentryClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: { length: 1, key: () => 'runquest_token', getItem: () => 'stored-token-value' },
    location: { pathname: '/board' },
  });
  for (const mock of [sentry.init, sentry.captureException, sentry.browserTracingIntegration, sentry.withStaticSpan, sentry.setTransactionName]) mock.mockClear();
});

describe('startSentry', () => {
  it('initialises with the DSN and environment, no default PII and no replay', () => {
    startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging' });

    const [[options]] = sentry.init.mock.calls;
    expect(options).toMatchObject({ dsn: 'https://key@example.invalid/1', environment: 'staging' });
    expect(options.dataCollection).toEqual({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false });
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
  });

  it('reports under the release the source maps were uploaded for', () => {
    startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging', release: 'runquest@0.8.0+abcdef1' });

    expect(sentry.init.mock.calls[0]?.[0].release).toBe('runquest@0.8.0+abcdef1');
  });

  it('scrubs every event through beforeSend', () => {
    startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging' });
    const [[{ beforeSend }]] = sentry.init.mock.calls;

    const kept = beforeSend({ message: 'seen stored-token-value', user: { email: 'a@example.com' }, request: { url: 'https://runquest.dev/board?x=1' } });
    expect(kept.user).toBeUndefined();
    expect(kept.message).toBe('seen [Filtered]');
    expect(kept.request.url).toBe('https://runquest.dev/board');
    expect(beforeSend({ exception: { values: [{ value: 'Importing a module script failed.' }] } })).toBeNull();
  });

  it('returns a sink that captures an Error as it is, with the context as extra', () => {
    const report = startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging' });
    const error = new Error('boom');

    report(error, { componentStack: 'at Page' });

    expect(sentry.captureException).toHaveBeenCalledWith(error, { extra: { componentStack: 'at Page' } });
  });

  it('wraps a non-Error value in an Error so it gets a stack and a title', () => {
    const report = startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging' });

    report('plain string');

    const [captured, hint] = sentry.captureException.mock.calls[0] ?? [];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('plain string');
    expect(hint).toEqual({ extra: {} });
  });
});

describe('startSentry performance tracing', () => {
  const start = (options: { tracesSampleRate?: number; documentPath?: string } = {}) =>
    startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging', documentPath: '/board', ...options });
  const initOptions = () => sentry.init.mock.calls[0]?.[0];
  const tracingOptions = () => sentry.browserTracingIntegration.mock.calls[0]?.[0] as Record<string, unknown>;

  it('samples at most one page load in ten, and a lower rate stays lower', () => {
    start();
    expect(initOptions().tracesSampleRate).toBe(0.1);

    sentry.init.mockClear();
    start({ tracesSampleRate: 1 });
    expect(initOptions().tracesSampleRate).toBe(0.1);

    sentry.init.mockClear();
    start({ tracesSampleRate: 0 });
    expect(initOptions().tracesSampleRate).toBe(0);
  });

  it('never propagates trace headers and traces no request, navigation or resource', () => {
    start();

    expect(initOptions().tracePropagationTargets).toEqual([]);
    expect(tracingOptions()).toMatchObject({
      instrumentNavigation: false, instrumentBfcacheRestore: false, traceFetch: false, traceXHR: false, enableHTTPTimings: false,
      enableLongTask: false, enableLongAnimationFrame: false, enableInp: true, linkPreviousTrace: 'off',
    });
    expect(initOptions().integrations).toHaveLength(1);
  });

  it('names the page load after the route', () => {
    start();
    const { beforeStartSpan } = tracingOptions() as { beforeStartSpan: (span: { name: string; op: string }) => { name: string; op: string } };
    vi.stubGlobal('window', { localStorage: { length: 0 }, location: { pathname: '/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14' } });

    expect(beforeStartSpan({ name: '/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14', op: 'pageload' })).toEqual({ name: '/runner/:id', op: 'pageload' });
  });

  it('measures the page load only when the page was loaded on a logged-in page that is still open', () => {
    start({ documentPath: '/board' });
    expect(tracingOptions().instrumentPageLoad).toBe(true);

    sentry.browserTracingIntegration.mockClear();
    start({ documentPath: '/' });
    expect(tracingOptions().instrumentPageLoad).toBe(false);

    sentry.browserTracingIntegration.mockClear();
    start({ documentPath: '/profile' });
    expect(tracingOptions().instrumentPageLoad).toBe(false);

    sentry.browserTracingIntegration.mockClear();
    start({ documentPath: undefined });
    expect(tracingOptions().instrumentPageLoad).toBe(false);
  });

  it('runs every transaction and span through the scrubbers', () => {
    start();
    const { beforeSendTransaction, beforeSendSpan } = initOptions();

    const transaction = beforeSendTransaction({ transaction: '/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14', spans: [{ op: 'resource.script' }], user: { id: 'u1' } });
    expect(transaction.transaction).toBe('/runner/:id');
    expect(transaction.spans).toEqual([]);
    expect(transaction.user).toBeUndefined();

    expect(sentry.withStaticSpan).toHaveBeenCalledTimes(1);
    // Utan eget sidnamn får INP-spanen namnet på sidan som är öppen när den skickas (besökets sista sida).
    expect(beforeSendSpan({ op: 'ui.interaction.click', description: 'button[aria-label="Open Anna"]', data: { 'user.email': 'anna@example.com' } })).toEqual({
      op: 'ui.interaction.click', description: 'Interaction to next paint', data: { 'sentry.segment.name': '/board' },
    });
    expect(initOptions().traceLifecycle).toBe('static');
  });
});
