import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { track } from '@/shared/analytics/track';
import { useChallengeActions } from './useChallengeActions';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));

function setup() {
  resetFakeBackend();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useChallengeActions(), { wrapper }), invalidate };
}
const keys = (invalidate: ReturnType<typeof vi.spyOn>) => invalidate.mock.calls.map(([filters]: unknown[]) => (filters as { queryKey: unknown }).queryKey);

describe('utmaningsmutationerna uppdaterar Pack News direkt (klockan väntar inte på nästa poll)', () => {
  it.each([
    ['send', 'sendChallenge', (a: ReturnType<typeof useChallengeActions>) => a.send.mutateAsync({ tokenId: 't1', opponentId: 'u2' })],
    ['accept', 'respondToChallenge', (a: ReturnType<typeof useChallengeActions>) => a.accept.mutateAsync('c1')],
    ['decline', 'respondToChallenge', (a: ReturnType<typeof useChallengeActions>) => a.decline.mutateAsync('c1')],
    ['withdraw', 'withdrawChallenge', (a: ReturnType<typeof useChallengeActions>) => a.withdraw.mutateAsync('c1')],
  ])('%s invaliderar news-flödena (och fortfarande utmaningarna)', async (_name, method, run) => {
    const { result, invalidate } = setup();
    handlers[method] = async () => ({ success: true });
    await run(result.current);
    expect(keys(invalidate)).toEqual(expect.arrayContaining([NEWS_QUERY_KEYS.feedRoot, ['challenges']]));
  });

  it('ett misslyckat anrop invaliderar ingenting', async () => {
    const { result, invalidate } = setup();
    handlers.sendChallenge = async () => ({ success: false, error: 'No token' });
    await expect(result.current.send.mutateAsync({ tokenId: 't1', opponentId: 'u2' })).rejects.toThrow('No token');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('utmaningsmutationerna: webbanalys', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('reports challenge-accepted, and nothing about the challenge, when an accept has gone through', async () => {
    const { result } = setup();
    handlers.respondToChallenge = async () => ({ success: true });
    await result.current.accept.mutateAsync('c1');
    expect(track).toHaveBeenCalledExactlyOnceWith('challenge-accepted');
  });

  it('reports nothing when the accept fails', async () => {
    const { result } = setup();
    handlers.respondToChallenge = async () => ({ success: false, error: 'Too late' });
    await expect(result.current.accept.mutateAsync('c1')).rejects.toThrow('Too late');
    expect(track).not.toHaveBeenCalled();
  });

  it('reports nothing for send, decline and withdraw', async () => {
    const { result } = setup();
    handlers.sendChallenge = async () => ({ success: true });
    handlers.respondToChallenge = async () => ({ success: true });
    handlers.withdrawChallenge = async () => ({ success: true });
    await result.current.send.mutateAsync({ tokenId: 't1', opponentId: 'u2' });
    await result.current.decline.mutateAsync('c1');
    await result.current.withdraw.mutateAsync('c1');
    expect(track).not.toHaveBeenCalled();
  });
});

describe('a send that got no answer or no connection', () => {
  const send = (actions: ReturnType<typeof useChallengeActions>) => actions.send.mutateAsync({ tokenId: 't1', opponentId: 'u2' });
  const messageOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (failure) {
      return failure instanceof Error ? failure.message : String(failure);
    }
    return 'resolved';
  };

  it('rejects with the honest text when the send timed out, and fetches the challenges again so that a send that did go through shows', async () => {
    const { result, invalidate } = setup();
    handlers.sendChallenge = async () => ({ success: false, error: 'This operation was aborted', reason: 'timeout' });

    expect(await messageOf(send(result.current))).toMatch(/couldn.t confirm that your challenge was sent.*check your sent challenges/i);

    await waitFor(() => expect(keys(invalidate)).toEqual(expect.arrayContaining([['challenges'], NEWS_QUERY_KEYS.feedRoot])));
  });

  it('rejects with a human text instead of "Failed to fetch" when there was no connection, and fetches nothing again', async () => {
    const { result, invalidate } = setup();
    handlers.sendChallenge = async () => ({ success: false, error: 'Failed to fetch', reason: 'network' });

    const message = await messageOf(send(result.current));

    expect(message).toMatch(/couldn.t reach RunQuest/i);
    expect(message).not.toContain('Failed to fetch');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('keeps the server own text for a send the server answered', async () => {
    const { result } = setup();
    handlers.sendChallenge = async () => ({ success: false, error: 'Opponent already has an active or pending challenge' });

    expect(await messageOf(send(result.current))).toBe('Opponent already has an active or pending challenge');
  });
});
