/**
 * RUN-214: prod-loggern JSON-serialiserade Error och PostgrestError till `{}`
 * (message/stack är inte enumerable), så Railway-loggen visade aldrig varför något föll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadLogger(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  return (await import('../logger.js')).logger;
}

/** Den JSON-rad som prod-loggern skrev till given console-metod. */
function emitted(spy: ReturnType<typeof vi.spyOn>) {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0][0] as string);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('logger (production)', () => {
  it('logger serializes Error message and stack in production mode', async () => {
    const logger = await loadLogger('production');
    logger.error('x', new Error('boom'));

    const entry = emitted(errorSpy);
    expect(entry).toMatchObject({ level: 'error', message: 'x' });
    expect(entry.context.name).toBe('Error');
    expect(entry.context.message).toBe('boom');
    expect(entry.context.stack).toContain('Error: boom');
  });

  it('logger serializes PostgrestError code and details', async () => {
    const logger = await loadLogger('production');
    // supabase-js ger både klass-instanser (Error-subklass) och rena objekt, beroende på version.
    class PostgrestError extends Error {
      constructor(message: string, public details: string, public hint: string, public code: string) {
        super(message);
        this.name = 'PostgrestError';
      }
    }
    logger.error('class', new PostgrestError('duplicate key', 'Key (id)=(1) exists', 'try upsert', '23505'));
    logger.error('plain', { message: 'permission denied', details: 'no policy', hint: 'add one', code: '42501' });

    const [klass, plain] = errorSpy.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
    expect(klass.context).toMatchObject({
      name: 'PostgrestError', message: 'duplicate key', code: '23505', details: 'Key (id)=(1) exists', hint: 'try upsert',
    });
    expect(klass.context.stack).toContain('duplicate key');
    expect(plain.context).toMatchObject({ message: 'permission denied', code: '42501', details: 'no policy', hint: 'add one' });
  });

  it('serialiserar Error även nästlat i context och i flera argument', async () => {
    const logger = await loadLogger('production');
    logger.error('nested', { userId: 'u1', error: new Error('deep') });
    logger.error('many', 'ctx', new Error('second'));

    const [nested, many] = errorSpy.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
    expect(nested.context.userId).toBe('u1');
    expect(nested.context.error.message).toBe('deep');
    expect(many.context[0]).toBe('ctx');
    expect(many.context[1].message).toBe('second');
  });

  it('serialiserar Error.cause', async () => {
    const logger = await loadLogger('production');
    logger.error('x', new Error('outer', { cause: new Error('inner') }));
    expect(emitted(errorSpy).context.cause.message).toBe('inner');
  });

  it('kraschar inte på cirkulära referenser eller bigint', async () => {
    const logger = await loadLogger('production');
    const loop: Record<string, unknown> = { id: 1n };
    loop.self = loop;
    expect(() => logger.error('x', loop)).not.toThrow();

    const entry = emitted(errorSpy);
    expect(entry.context.self).toBe('[Circular]');
    expect(entry.context.id).toBe('1');
  });

  it('lämnar vanliga värden orörda och behåller radens form', async () => {
    const logger = await loadLogger('production');
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('hi', { a: 1, b: ['x'], c: null });
    logger.info('bare');

    const [withCtx, bare] = info.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
    expect(withCtx).toMatchObject({ level: 'info', message: 'hi', context: { a: 1, b: ['x'], c: null } });
    expect(typeof withCtx.timestamp).toBe('string');
    expect(bare.context).toBeUndefined();
  });

  it('debug är tyst i produktion', async () => {
    const logger = await loadLogger('production');
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.debug('quiet');
    expect(info).not.toHaveBeenCalled();
  });
});

describe('logger (development)', () => {
  it('skickar argumenten oförändrade till console', async () => {
    const logger = await loadLogger('development');
    const err = new Error('boom');
    logger.error('x', err);
    expect(errorSpy).toHaveBeenCalledWith('x', err);
  });
});

describe('logger error sink', () => {
  it('hands error lines (and only error lines) to the registered sink', async () => {
    const logger = await loadLogger('production');
    const { setErrorSink } = await import('../logger.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = vi.fn();
    setErrorSink(sink);

    const err = new Error('boom');
    logger.info('i');
    logger.warn('w');
    logger.error('e', err, 'more');

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith('e', [err, 'more']);
  });

  it('keeps logging when the sink throws, and when it is removed', async () => {
    const logger = await loadLogger('development');
    const { setErrorSink } = await import('../logger.js');
    setErrorSink(() => { throw new Error('sink broke'); });
    expect(() => logger.error('still logged')).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('still logged');

    setErrorSink(null);
    expect(() => logger.error('no sink')).not.toThrow();
  });
});
