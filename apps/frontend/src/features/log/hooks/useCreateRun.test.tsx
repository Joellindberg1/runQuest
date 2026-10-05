import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { EVENTS_QUERY_KEYS } from '@/features/events/hooks/useEventsQueries';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { EVENT_FOLLOW_UP_MS, useCreateRun } from './useCreateRun';
import { LOG_QUERY_KEYS } from './useLogQueries';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const submission = { date: '2026-10-04', distance: 8, isTreadmill: false };

function setup() {
  resetFakeBackend();
  handlers.createRun = async () => ({ success: true, data: { id: 'new', xp_gained: 44, multiplier: 1.1, streak_day: 5, distance: 8 } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useCreateRun(), { wrapper }), invalidate };
}

const invalidatedKeys = (invalidate: ReturnType<typeof vi.spyOn>): unknown[] => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCreateRun — vad en lyckad runda invaliderar', () => {
  it('användarna, leaderboard, öppna event, titlar (båda rötterna), utmaningar, head-to-head och gruppens historik', async () => {
    const { result, invalidate } = setup();
    await result.current.mutateAsync(submission);

    const keys = invalidatedKeys(invalidate);
    expect(keys).toEqual(
      expect.arrayContaining([USERS_WITH_RUNS_QUERY_KEY, ['leaderboard'], EVENTS_QUERY_KEYS.open, ['titles'], ['multiple-user-titles'], ['challenges'], HEAD_TO_HEAD_ROOT, LOG_QUERY_KEYS.history]),
    );
    // Öppna-listan invalideras exakt: historiken (['events','history',…]) och facit rörs inte av en vanlig runda.
    const eventCall = invalidate.mock.calls.find(([filters]) => (filters as { queryKey: unknown }).queryKey === EVENTS_QUERY_KEYS.open);
    expect(eventCall?.[0]).toMatchObject({ exact: true });
  });

  it('en andra omhämtning av öppna event efter en kort stund — eventkvalificeringen körs i bakgrunden på servern', async () => {
    const original = globalThis.setTimeout;
    const followUps: Array<() => void> = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === EVENT_FOLLOW_UP_MS) {
        followUps.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return original(fn, ms, ...rest);
    }) as typeof setTimeout);

    const { result, invalidate } = setup();
    await result.current.mutateAsync(submission);
    await waitFor(() => expect(followUps).toHaveLength(1));

    const before = invalidatedKeys(invalidate).filter((key) => key === EVENTS_QUERY_KEYS.open).length;
    followUps[0]();
    expect(invalidatedKeys(invalidate).filter((key) => key === EVENTS_QUERY_KEYS.open)).toHaveLength(before + 1);
  });

  it('ett misslyckat anrop invaliderar ingenting och kastar serverns meddelande', async () => {
    const { result, invalidate } = setup();
    handlers.createRun = async () => ({ success: false, error: 'Distance must be at least 1.0 km' });

    await expect(result.current.mutateAsync(submission)).rejects.toThrow('Distance must be at least 1.0 km');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
