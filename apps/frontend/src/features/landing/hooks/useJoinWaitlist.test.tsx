import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { useJoinWaitlist } from './useJoinWaitlist';

vi.mock('@/shared/services/backendApi', () => ({ backendApi: { joinWaitlist: vi.fn() } }));

const joinWaitlist = vi.mocked(backendApi.joinWaitlist);

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  // Bara klockan fejkas: react-querys och testbibliotekets timers går som vanligt.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
  joinWaitlist.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useJoinWaitlist', () => {
  it('sends the email, the consent, the honeypot value and the milliseconds since the form mounted', async () => {
    joinWaitlist.mockResolvedValue({ status: 200 });
    const { result } = renderHook(() => useJoinWaitlist(), { wrapper });
    vi.setSystemTime(new Date('2026-10-13T08:00:05Z'));

    await act(async () => { await result.current.join({ email: 'anna@example.com', website: '' }); });

    expect(joinWaitlist).toHaveBeenCalledTimes(1);
    expect(joinWaitlist).toHaveBeenCalledWith({ email: 'anna@example.com', consent: true, website: '', elapsedMs: 5000 });
  });

  it('sends nothing until join is called', () => {
    renderHook(() => useJoinWaitlist(), { wrapper });
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'joined'],
    [400, 'invalid'],
    [429, 'rate-limited'],
    [413, 'failed'],
    [500, 'failed'],
  ] as const)('maps HTTP %i to %s', async (status, outcome) => {
    joinWaitlist.mockResolvedValue({ status });
    const { result } = renderHook(() => useJoinWaitlist(), { wrapper });
    let got: unknown;
    await act(async () => { got = await result.current.join({ email: 'anna@example.com', website: '' }); });
    expect(got).toBe(outcome);
  });

  it('maps a network error to failed', async () => {
    joinWaitlist.mockResolvedValue(null);
    const { result } = renderHook(() => useJoinWaitlist(), { wrapper });
    let got: unknown;
    await act(async () => { got = await result.current.join({ email: 'anna@example.com', website: '' }); });
    expect(got).toBe('failed');
  });

  it('never sends twice while a request is in flight', async () => {
    let finish: (value: { status: number }) => void = () => {};
    joinWaitlist.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useJoinWaitlist(), { wrapper });

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.join({ email: 'anna@example.com', website: '' });
      second = await result.current.join({ email: 'anna@example.com', website: '' });
    });
    expect(second).toBeNull();
    expect(joinWaitlist).toHaveBeenCalledTimes(1);

    await act(async () => { finish({ status: 200 }); await first; });
    expect(result.current.isPending).toBe(false);
  });
});
