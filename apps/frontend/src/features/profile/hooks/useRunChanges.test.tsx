import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { EVENTS_QUERY_KEYS } from '@/features/events/hooks/useEventsQueries';
import { LOG_QUERY_KEYS } from '@/features/log/hooks/useLogQueries';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { EVENT_FOLLOW_UP_MS } from '@/features/runs/runEffects';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { run } from '../profile.fixture';
import { useDeleteRun, useUpdateRun } from './useRunChanges';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const original = run({ id: 'r1', date: '2026-10-02', distance: 8 });

function setup<T>(useHook: () => T) {
  resetFakeBackend();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(useHook, { wrapper }), invalidate };
}

const invalidatedKeys = (invalidate: ReturnType<typeof vi.spyOn>): unknown[] => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

// Samma kedja som useCreateRun (Log): users-with-runs, leaderboard, öppna event, titlar (båda rötterna), utmaningar, head-to-head, gruppens historik.
const CHAIN = [USERS_WITH_RUNS_QUERY_KEY, ['leaderboard'], EVENTS_QUERY_KEYS.open, ['titles'], ['multiple-user-titles'], ['challenges'], HEAD_TO_HEAD_ROOT, LOG_QUERY_KEYS.history, NEWS_QUERY_KEYS.feedRoot];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUpdateRun — PUT /runs/:id', () => {
  it('skickar datum och distans, och en lyckad ändring invaliderar HELA kedjan (inte bara users-with-runs)', async () => {
    const calls: unknown[][] = [];
    const { result, invalidate } = setup(() => useUpdateRun());
    handlers.updateRun = async (...args: unknown[]) => {
      calls.push(args);
      return { success: true, data: { ...original, distance: 9, xp_gained: 61 } };
    };

    const updated = await result.current.mutateAsync({ run: original, update: { date: '2026-10-02', distance: 9 } });

    expect(calls).toEqual([['r1', { date: '2026-10-02', distance: 9 }]]);
    expect(updated).toMatchObject({ id: 'r1', distance: 9, xp_gained: 61 });
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(CHAIN));
    const eventCall = invalidate.mock.calls.find(([filters]) => (filters as { queryKey: unknown }).queryKey === EVENTS_QUERY_KEYS.open);
    expect(eventCall?.[0]).toMatchObject({ exact: true });
  });

  it('en andra omhämtning av öppna event efter en kort stund — eventkvalificeringen körs i bakgrunden på servern', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const followUps: Array<() => void> = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === EVENT_FOLLOW_UP_MS) {
        followUps.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof setTimeout);

    const { result, invalidate } = setup(() => useUpdateRun());
    handlers.updateRun = async () => ({ success: true, data: original });
    await result.current.mutateAsync({ run: original, update: { date: '2026-10-02', distance: 8 } });
    await waitFor(() => expect(followUps).toHaveLength(1));

    const before = invalidatedKeys(invalidate).filter((key) => key === EVENTS_QUERY_KEYS.open).length;
    followUps[0]();
    expect(invalidatedKeys(invalidate).filter((key) => key === EVENTS_QUERY_KEYS.open)).toHaveLength(before + 1);
  });

  it('saknas den uppdaterade rundan i svaret faller resultatet tillbaka på det som skickades', async () => {
    const { result } = setup(() => useUpdateRun());
    handlers.updateRun = async () => ({ success: true });
    const updated = await result.current.mutateAsync({ run: original, update: { date: '2026-10-01', distance: 9.5 } });
    expect(updated).toMatchObject({ id: 'r1', date: '2026-10-01', distance: 9.5 });
  });

  it('ett misslyckat anrop invaliderar ingenting och kastar serverns meddelande', async () => {
    const { result, invalidate } = setup(() => useUpdateRun());
    handlers.updateRun = async () => ({ success: false, error: 'Runs can only be logged from 1 June 2025' });
    await expect(result.current.mutateAsync({ run: original, update: { date: '2024-01-01', distance: 8 } })).rejects.toThrow('Runs can only be logged from 1 June 2025');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useDeleteRun — DELETE /runs/:id', () => {
  it('raderar rundan och invaliderar samma kedja', async () => {
    const calls: unknown[][] = [];
    const { result, invalidate } = setup(() => useDeleteRun());
    handlers.deleteRun = async (...args: unknown[]) => {
      calls.push(args);
      return { success: true };
    };

    await result.current.mutateAsync(original);

    expect(calls).toEqual([['r1']]);
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(CHAIN));
  });

  it('ett misslyckat anrop invaliderar ingenting och kastar serverns meddelande', async () => {
    const { result, invalidate } = setup(() => useDeleteRun());
    handlers.deleteRun = async () => ({ success: false, error: 'Run not found' });
    await expect(result.current.mutateAsync(original)).rejects.toThrow('Run not found');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
