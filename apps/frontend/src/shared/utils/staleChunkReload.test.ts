import { describe, expect, it, vi } from 'vitest';
import { RELOAD_GUARD_MS, claimStaleChunkReload, installStaleChunkReload } from './staleChunkReload';

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
    fire() {
      const event = new Event('vite:preloadError', { cancelable: true });
      listener?.(event);
      return event;
    },
  };
}

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

  it('laddar om även när sessionStorage saknas eller kastar', () => {
    expect(claimStaleChunkReload(1_000_000, null)).toBe(true);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(claimStaleChunkReload(1_000_000, throwing)).toBe(true);
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
