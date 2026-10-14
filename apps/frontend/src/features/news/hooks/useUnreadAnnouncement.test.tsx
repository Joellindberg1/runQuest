import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { UNREAD_ANNOUNCE_MS, useUnreadAnnouncement } from './useUnreadAnnouncement';

// Regeln för vad som annonseras när oläst-räknaren ändras (ADR 011 addendum: polite, debouncad så att en svepning inte ger en tirad av tal).

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('useUnreadAnnouncement', () => {
  it('säger inget om startvärdet eller när räknaren inte ändras', () => {
    const { result, rerender } = renderHook(({ unread }) => useUnreadAnnouncement(unread), { initialProps: { unread: 4 } });
    advance(UNREAD_ANNOUNCE_MS * 2);
    expect(result.current).toBe('');
    rerender({ unread: 4 });
    advance(UNREAD_ANNOUNCE_MS * 2);
    expect(result.current).toBe('');
  });

  it('annonserar en minskning först när den stått still, och bara slutvärdet av en svepning', () => {
    const { result, rerender } = renderHook(({ unread }) => useUnreadAnnouncement(unread), { initialProps: { unread: 4 } });
    rerender({ unread: 3 });
    advance(UNREAD_ANNOUNCE_MS - 1);
    rerender({ unread: 2 });
    advance(UNREAD_ANNOUNCE_MS - 1);
    rerender({ unread: 1 });
    advance(UNREAD_ANNOUNCE_MS - 1);
    expect(result.current).toBe('');

    advance(1);
    expect(result.current).toBe('Pack news: 1 unread');
  });

  it('säger "All caught up" när räknaren når noll', () => {
    const { result, rerender } = renderHook(({ unread }) => useUnreadAnnouncement(unread), { initialProps: { unread: 1 } });
    rerender({ unread: 0 });
    advance(UNREAD_ANNOUNCE_MS);
    expect(result.current).toBe('Pack news: All caught up');
  });

  it('annonserar inte en ökning (nya nyheter), och en väntande minskning dras tillbaka', () => {
    const { result, rerender } = renderHook(({ unread }) => useUnreadAnnouncement(unread), { initialProps: { unread: 3 } });
    rerender({ unread: 2 });
    rerender({ unread: 5 });
    advance(UNREAD_ANNOUNCE_MS * 2);
    expect(result.current).toBe('');
  });

  it('en ökning tömmer regionen så att samma värde kan annonseras igen efter nästa minskning', () => {
    const { result, rerender } = renderHook(({ unread }) => useUnreadAnnouncement(unread), { initialProps: { unread: 3 } });
    rerender({ unread: 2 });
    advance(UNREAD_ANNOUNCE_MS);
    expect(result.current).toBe('Pack news: 2 unread');

    rerender({ unread: 3 });
    expect(result.current).toBe('');
    rerender({ unread: 2 });
    advance(UNREAD_ANNOUNCE_MS);
    expect(result.current).toBe('Pack news: 2 unread');
  });
});
