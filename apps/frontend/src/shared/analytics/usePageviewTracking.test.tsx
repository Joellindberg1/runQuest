import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { usePageviewTracking, PAGEVIEW_SETTLE_MS } from './usePageviewTracking';

// Kopplingen mellan routern och sändaren: normaliseringen och laddaren har egna tester. Sändaren är en spion, inget nätverk.
const send = vi.fn<(url: string) => void>();
const sender = { send };

let go: (to: string, options?: { replace?: boolean }) => void = () => {};
const Probe: React.FC<{ paused?: boolean }> = ({ paused }) => {
  usePageviewTracking({ sender, paused });
  const navigate = useNavigate();
  go = (to, options) => navigate(to, options);
  return null;
};
const tree = (initial: string, paused = false) => <MemoryRouter initialEntries={[initial]}><Probe paused={paused} /></MemoryRouter>;
const mount = (initial: string, paused = false) => render(tree(initial, paused));
const settle = () => act(() => { vi.advanceTimersByTime(PAGEVIEW_SETTLE_MS); });

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('page view tracking', () => {
  it('sends the first page once the address has settled, in its normalized form', () => {
    mount('/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14?from=board');
    expect(send).not.toHaveBeenCalled();
    settle();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('/runner/:id');
  });

  it('sends one page view per page the user moves to', () => {
    mount('/board');
    settle();
    act(() => go('/duels'));
    settle();
    act(() => go('/runner/abc'));
    settle();
    expect(send.mock.calls.map(([url]) => url)).toEqual(['/board', '/duels', '/runner/:id']);
  });

  it('does not count a redirect as a page view: only the page the user lands on', () => {
    mount('/board');
    act(() => go('/login?next=%2Fboard', { replace: true }));
    settle();
    expect(send.mock.calls.map(([url]) => url)).toEqual(['/login']);
  });

  it('does not send again when only the query string changes', () => {
    mount('/duels');
    settle();
    act(() => go('/duels?send=1&opponent=3f2b8c1e'));
    settle();
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps utm_ parameters on the landing page and sends nothing else from the query', () => {
    mount('/?utm_source=newsletter&ref=anna');
    settle();
    expect(send).toHaveBeenCalledWith('/?utm_source=newsletter');
  });

  it('counts no page while the app is still deciding what to show, then counts the page it ends up on', () => {
    const { rerender } = mount('/board', true);
    settle();
    expect(send).not.toHaveBeenCalled();
    rerender(tree('/board', false));
    settle();
    expect(send.mock.calls.map(([url]) => url)).toEqual(['/board']);
  });

  it('sends nothing after the app is unmounted before the address settles', () => {
    const { unmount } = mount('/board');
    unmount();
    settle();
    expect(send).not.toHaveBeenCalled();
  });
});
