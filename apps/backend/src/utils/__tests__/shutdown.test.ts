import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShutdown, exitAfterFlush } from '../shutdown.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('exitAfterFlush', () => {
  it('exits only after the flush has finished, with the given code', async () => {
    const order: string[] = [];
    let finishFlush: () => void = () => {};
    const flush = () => new Promise<void>((resolve) => { finishFlush = () => { order.push('flushed'); resolve(); }; });
    const exit = vi.fn((code: number) => { order.push(`exit ${code}`); });

    const done = exitAfterFlush(1, { flush, exit });
    expect(exit).not.toHaveBeenCalled();
    finishFlush();
    await done;
    expect(order).toEqual(['flushed', 'exit 1']);
  });

  it('still exits when the flush fails', async () => {
    const exit = vi.fn();
    await exitAfterFlush(1, { flush: () => Promise.reject(new Error('no network')), exit });
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('createShutdown (SIGTERM and SIGINT)', () => {
  function setup(closeSeen: { callback?: () => void } = {}) {
    const order: string[] = [];
    const deps = {
      closeServer: vi.fn((cb: () => void) => { order.push('closing'); closeSeen.callback = cb; }),
      flush: vi.fn(async () => { order.push('flushed'); }),
      exit: vi.fn((code: number) => { order.push(`exit ${code}`); }),
      log: vi.fn(),
      forceExitAfterMs: 10_000,
    };
    return { deps, order, closeSeen, shutdown: createShutdown(deps) };
  }

  it('closes the server, flushes, then exits 0', async () => {
    const { deps, order, closeSeen, shutdown } = setup();
    const done = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.exit).not.toHaveBeenCalled();
    closeSeen.callback?.();
    await done;
    expect(order).toEqual(['closing', 'flushed', 'exit 0']);
  });

  it('ignores a second signal while shutting down', async () => {
    const { deps, closeSeen, shutdown } = setup();
    const first = shutdown('SIGTERM');
    await shutdown('SIGINT');
    closeSeen.callback?.();
    await first;
    expect(deps.closeServer).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('forces exit 1 when open connections keep the server from closing', async () => {
    const { deps, shutdown } = setup();
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(deps.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});
