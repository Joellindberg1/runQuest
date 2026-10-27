import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PositionHistoryResponse } from '@runquest/shared';
import { invalidateAfterRunChange } from '@/features/runs/runEffects';

const auth = vi.hoisted(() => ({ user: { id: 'u-me' } as { id: string } | null }));
const api = vi.hoisted(() => ({ getPositionHistory: vi.fn() }));
vi.mock('@/providers/authContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

import { POSITION_QUERY_KEY, usePositionHistory } from './usePositionHistory';

// Tre veckor, inte åtta: servern beskär förledande veckor utan närvarande, och hooken får aldrig anta ett fast antal.
const history = (): PositionHistoryResponse => ({
  as_of: '2026-10-27',
  weeks: [
    { start: '2026-10-12', end: '2026-10-18', iso_week: 42, iso_year: 2026, is_current_week: false },
    { start: '2026-10-19', end: '2026-10-25', iso_week: 43, iso_year: 2026, is_current_week: false },
    { start: '2026-10-26', end: '2026-11-01', iso_week: 44, iso_year: 2026, is_current_week: true },
  ],
  runners: [
    { user_id: 'u-me', name: 'Me', profile_picture: null, member_since: '2026-01-01', positions: [2, 1, 1] },
    { user_id: 'u-karl', name: 'Karl', profile_picture: null, member_since: '2026-01-01', positions: [1, 2, 2] },
  ],
});
const ok = (data = history()) => ({ success: true, data });

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  auth.user = { id: 'u-me' };
  api.getPositionHistory.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePositionHistory', () => {
  it('fetches the requested number of weeks and returns the response as it is, however many weeks came back', async () => {
    api.getPositionHistory.mockResolvedValue(ok());
    const { result } = renderHook(() => usePositionHistory(8), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.getPositionHistory).toHaveBeenCalledWith(8);
    expect(result.current.data?.weeks).toHaveLength(3);
    expect(queryClient.getQueryData(['leaderboard', 'positions', 8])).toEqual(history());
  });

  it('lets the profile pick its own row out of the shared response', async () => {
    api.getPositionHistory.mockResolvedValue(ok());
    const { result } = renderHook(() => usePositionHistory(8), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.runners.find((runner) => runner.user_id === 'u-me')?.positions).toEqual([2, 1, 1]);
  });

  it('Leaderboard and profile share one request and one cache entry', async () => {
    api.getPositionHistory.mockResolvedValue(ok());
    const board = renderHook(() => usePositionHistory(8), { wrapper });
    const profile = renderHook(() => usePositionHistory(8), { wrapper });

    await waitFor(() => expect(board.result.current.isSuccess && profile.result.current.isSuccess).toBe(true));

    expect(api.getPositionHistory).toHaveBeenCalledTimes(1);
    expect(profile.result.current.data).toBe(board.result.current.data);
  });

  it('a different number of weeks is a different cache entry', async () => {
    api.getPositionHistory.mockImplementation((weeks: number) => Promise.resolve(ok({ ...history(), as_of: `weeks-${weeks}` })));
    const eight = renderHook(() => usePositionHistory(8), { wrapper });
    const twelve = renderHook(() => usePositionHistory(12), { wrapper });

    await waitFor(() => expect(eight.result.current.isSuccess && twelve.result.current.isSuccess).toBe(true));

    expect(eight.result.current.data?.as_of).toBe('weeks-8');
    expect(twelve.result.current.data?.as_of).toBe('weeks-12');
    expect(POSITION_QUERY_KEY(12)).toEqual(['leaderboard', 'positions', 12]);
  });

  it('fetches nothing until it is enabled, and nothing while signed out', async () => {
    api.getPositionHistory.mockResolvedValue(ok());
    const { result, rerender } = renderHook(({ enabled }) => usePositionHistory(8, enabled), { wrapper, initialProps: { enabled: false } });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(api.getPositionHistory).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getPositionHistory).toHaveBeenCalledTimes(1);

    auth.user = null;
    const signedOut = renderHook(() => usePositionHistory(26), { wrapper });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(signedOut.result.current.fetchStatus).toBe('idle');
    expect(api.getPositionHistory).toHaveBeenCalledTimes(1);
  });

  it('stays fresh for 60 seconds and is fetched again after that', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    api.getPositionHistory.mockResolvedValue(ok());
    const first = renderHook(() => usePositionHistory(8), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    vi.setSystemTime(Date.now() + 59_000);
    const soon = renderHook(() => usePositionHistory(8), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(api.getPositionHistory).toHaveBeenCalledTimes(1);
    soon.unmount();

    vi.setSystemTime(Date.now() + 2_000);
    renderHook(() => usePositionHistory(8), { wrapper });
    await waitFor(() => expect(api.getPositionHistory).toHaveBeenCalledTimes(2));
  });

  it('a failed response is an error the screen can show and retry', async () => {
    api.getPositionHistory.mockResolvedValue({ success: false, error: 'Boom' });
    const { result } = renderHook(() => usePositionHistory(8), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Boom');
    expect(result.current.data).toBeUndefined();

    api.getPositionHistory.mockResolvedValue(ok());
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
  });

  it('logging a run invalidates the positions query', async () => {
    api.getPositionHistory.mockResolvedValue(ok());
    const { result } = renderHook(() => usePositionHistory(8), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getPositionHistory).toHaveBeenCalledTimes(1);

    await act(async () => { await invalidateAfterRunChange(queryClient); });

    await waitFor(() => expect(api.getPositionHistory).toHaveBeenCalledTimes(2));
  });
});
