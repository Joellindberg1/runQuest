import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleLeaderboardEntry, UserTitleEntry } from '@runquest/shared';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { invalidateAfterRunChange } from '@/features/runs/runEffects';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { useRunnerTitleRows } from './useRunnerTitleRows';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// The rows of the title panel need two answers: the runner's titles and the title board (type, unit and holder of each title).

const auth: AuthContextType = {
  user: { id: ME.id, name: ME.name, email: 'me@example.com' },
  login: async () => ({ success: true }),
  logout: () => {},
  loading: false,
  isAdmin: false,
};

const TITLES: UserTitleEntry[] = [
  { title_id: 't-long', title_name: 'The Longest Run', title_description: '', position: 1, value: 32.8, earned_at: '', is_current_holder: true, status: 'holder' },
];
const board = (): TitleLeaderboardEntry[] => [
  {
    id: 't-long', name: 'The Longest Run', description: '', unlock_requirement: 0, metric_key: 'longestRun',
    holder: { user_id: OTHER.id, user_name: OTHER.name, value: 32.8, earned_at: '' }, runners_up: [],
  },
];

const calls = { titles: 0, board: 0 };
let client: QueryClient;

beforeEach(() => {
  resetFakeBackend();
  calls.titles = 0;
  calls.board = 0;
  handlers.getUserTitles = () => {
    calls.titles += 1;
    return { success: true, data: TITLES };
  };
  handlers.getTitleLeaderboard = () => {
    calls.board += 1;
    return { success: true, data: board() };
  };
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe('useRunnerTitleRows', () => {
  it('gives the rows with type and unit once both the titles and the title board have answered', async () => {
    const { result } = renderHook(() => useRunnerTitleRows(ME), { wrapper });

    expect(result.current.rows).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.rows).not.toBeNull());

    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.rows?.held).toEqual([{ id: 't-long', name: 'The Longest Run', value: '32.8 km', category: 'distance' }]);
  });

  it('fails, with no rows, when the title board fails, and Retry reads both again', async () => {
    let boardFails = true;
    handlers.getTitleLeaderboard = () => {
      calls.board += 1;
      return boardFails ? { success: false, error: 'boom' } : { success: true, data: board() };
    };
    const { result } = renderHook(() => useRunnerTitleRows(ME), { wrapper });

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.rows).toBeNull();

    boardFails = false;
    const before = { ...calls };
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).not.toBeNull());

    expect(result.current.failed).toBe(false);
    expect(calls.board).toBe(before.board + 1);
    expect(calls.titles).toBe(before.titles + 1);
  });

  it('is retrying while only the title board is read again, with the rows it already had', async () => {
    // A query without data goes back to "pending" while it is read again, so the error card is only drawn through a retry when an earlier answer is kept:
    // the title board answers, and the next read (after a run) fails.
    const { result } = renderHook(() => useRunnerTitleRows(ME), { wrapper });
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    let boardRead: 'fail' | 'held' = 'fail';
    let releaseBoard: () => void = () => {};
    handlers.getTitleLeaderboard = () => {
      calls.board += 1;
      return boardRead === 'fail'
        ? { success: false, error: 'boom' }
        : new Promise((resolve) => {
            releaseBoard = () => resolve({ success: true, data: board() });
          });
    };
    await act(() => invalidateAfterRunChange(client));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.rows).not.toBeNull();
    expect(result.current.retrying).toBe(false);

    boardRead = 'held';
    const titleReadsBefore = calls.titles;
    act(() => result.current.retry());
    // The runner's titles answer at once, so the title board is the only read still going.
    await waitFor(() => expect(calls.titles).toBe(titleReadsBefore + 1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(result.current.retrying).toBe(true);

    await act(async () => releaseBoard());
    await waitFor(() => expect(result.current.retrying).toBe(false));
    expect(result.current.failed).toBe(false);
  });

  it('is read again when a run changes the titles', async () => {
    const { result } = renderHook(() => useRunnerTitleRows(ME), { wrapper });
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    expect(calls).toEqual({ titles: 1, board: 1 });

    await act(() => invalidateAfterRunChange(client));

    await waitFor(() => expect(calls).toEqual({ titles: 2, board: 2 }));
  });
});
