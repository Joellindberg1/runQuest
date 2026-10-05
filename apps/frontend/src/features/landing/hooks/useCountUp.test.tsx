import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { COUNT_UP_MS } from '../landingModel';
import { useCountUp } from './useCountUp';

const stubReducedMotion = (reduced: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && /prefers-reduced-motion/.test(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCountUp', () => {
  it('startar på 0, går uppåt och landar på exakt 1 efter uppräkningens längd — och står sedan still', () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useCountUp());
    expect(result.current).toBe(0);

    act(() => { vi.advanceTimersByTime(COUNT_UP_MS / 2); });
    expect(result.current).toBeGreaterThan(0.5);
    expect(result.current).toBeLessThan(1);

    act(() => { vi.advanceTimersByTime(COUNT_UP_MS); });
    expect(result.current).toBe(1);

    // Ingen ny bildruta schemaläggs efter slutet: inget mer att köra.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('med reducerad rörelse visas slutvärdet direkt, utan animation', () => {
    stubReducedMotion(true);
    const { result } = renderHook(() => useCountUp());
    expect(result.current).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('avmontering avbryter pågående bildruta (inget läckande anrop)', () => {
    stubReducedMotion(false);
    const { unmount } = renderHook(() => useCountUp());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('utan matchMedia (äldre miljö) räknas det upp som vanligt i stället för att krascha', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useCountUp());
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50); });
    expect(result.current).toBe(1);
  });
});
