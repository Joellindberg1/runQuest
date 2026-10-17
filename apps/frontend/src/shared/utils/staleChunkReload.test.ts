import { describe, expect, it, vi } from 'vitest';
import { RELOAD_GUARD_MS, claimStaleChunkReload, installStaleChunkReload, isStaleChunkError, loadOptionalChunk } from './staleChunkReload';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

function fakeWindow() {
  let listener: ((event: Event) => void) | undefined;
  return {
    addEventListener: vi.fn((_type: string, fn: (event: Event) => void) => { listener = fn; }),
    location: { reload: vi.fn() },
    fire(payload?: unknown) {
      const event = new Event('vite:preloadError', { cancelable: true });
      Object.assign(event, { payload });
      listener?.(event);
      return event;
    },
  };
}

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://runquest.dev/assets/AdminPage-abc.js',
    'error loading dynamically imported module: https://runquest.dev/assets/AdminPage-abc.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/Index-abc.css',
    'Loading chunk 12 failed.',
  ])('recognises "%s" as a reload-after-deploy error', (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
    expect(isStaleChunkError(message)).toBe(true);
  });

  it('lets ordinary errors and non-errors through', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError({ code: 500 })).toBe(false);
  });
});

describe('claimStaleChunkReload', () => {
  it('tillåter första omladdningen och spärrar en andra inom fönstret', () => {
    const storage = memoryStorage();
    expect(claimStaleChunkReload(1_000_000, storage)).toBe(true);
    expect(claimStaleChunkReload(1_000_000 + RELOAD_GUARD_MS - 1, storage)).toBe(false);
  });

  it('tillåter en ny omladdning när fönstret har passerat (nästa deploy)', () => {
    const storage = memoryStorage();
    claimStaleChunkReload(1_000_000, storage);
    expect(claimStaleChunkReload(1_000_000 + RELOAD_GUARD_MS, storage)).toBe(true);
  });

  it('laddar inte om när spärren inte går att lagra (saknad, kastande eller tyst lagring) — ingen loop', () => {
    expect(claimStaleChunkReload(1_000_000, null)).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(claimStaleChunkReload(1_000_000, throwing)).toBe(false);
    const silent = { getItem: () => null, setItem: () => {} };
    expect(claimStaleChunkReload(1_000_000, silent)).toBe(false);
  });
});

describe('installStaleChunkReload', () => {
  it('laddar om sidan och stoppar felet vid första preloadError', () => {
    const win = fakeWindow();
    installStaleChunkReload(win, memoryStorage, () => 1_000_000);
    const event = win.fire();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a blocked error-reporting chunk does not reload the page', () => {
    const win = fakeWindow();
    installStaleChunkReload(win, memoryStorage, () => 1_000_000);

    const event = win.fire(new Error('Failed to fetch dynamically imported module: https://runquest.dev/assets/optional-k3j9x.js'));

    expect(win.location.reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('a blocked optional chunk in a browser that names no address does not reload either, but only while it loads', async () => {
    const win = fakeWindow();
    installStaleChunkReload(win, memoryStorage, () => 1_000_000);
    const safariError = new Error('Importing a module script failed.');

    let during: Event | undefined;
    await loadOptionalChunk(async () => { during = win.fire(safariError); });
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(during?.defaultPrevented).toBe(false);

    win.fire(safariError);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('an ordinary stale page chunk still reloads while an optional chunk loads', async () => {
    const win = fakeWindow();
    installStaleChunkReload(win, memoryStorage, () => 1_000_000);

    await loadOptionalChunk(async () => {
      win.fire(new Error('Failed to fetch dynamically imported module: https://runquest.dev/assets/AdminPage-abc.js'));
    });

    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('loadOptionalChunk passes the result and the failure through', async () => {
    await expect(loadOptionalChunk(async () => 7)).resolves.toBe(7);
    await expect(loadOptionalChunk(async () => { throw new Error('blocked'); })).rejects.toThrow('blocked');
  });

  it('släpper felet vidare (ingen loop) om omladdningen redan prövats', () => {
    const win = fakeWindow();
    const storage = memoryStorage();
    let t = 1_000_000;
    installStaleChunkReload(win, () => storage, () => t);
    win.fire();
    t += 1_000;
    const second = win.fire();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
