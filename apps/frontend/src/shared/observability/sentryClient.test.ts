import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/react', () => sentry);

import { startSentry } from './sentryClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: { length: 1, key: () => 'runquest_token', getItem: () => 'stored-token-value' } });
  sentry.init.mockClear();
  sentry.captureException.mockClear();
});

describe('startSentry', () => {
  it('initialises with the DSN and environment, no default PII, no tracing and no replay', () => {
    startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging' });

    const [[options]] = sentry.init.mock.calls;
    expect(options).toMatchObject({ dsn: 'https://key@example.invalid/1', environment: 'staging' });
    expect(options.dataCollection).toEqual({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false });
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
    expect(options.integrations).toBeUndefined();
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
