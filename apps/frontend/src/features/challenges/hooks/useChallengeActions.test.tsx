import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { useChallengeActions } from './useChallengeActions';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

function setup() {
  resetFakeBackend();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useChallengeActions(), { wrapper }), invalidate };
}
const keys = (invalidate: ReturnType<typeof vi.spyOn>) => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

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
