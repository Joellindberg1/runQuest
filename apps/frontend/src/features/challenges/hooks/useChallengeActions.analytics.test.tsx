import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { resetDefaultPageviewSender } from '@/shared/analytics/umamiPageviews';
import { useChallengeActions } from './useChallengeActions';

// Den riktiga track, hela vägen ner till sändaren, med en adressnormalisering som kastar: en lyckad handling får aldrig bli ett fel för att
// statistiken fallerar. Bara backendApi är ersatt; jsdom hämtar inga skript, så inget når Umami Cloud.
vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/shared/analytics/normalizePageUrl', () => ({
  normalizePageUrl: () => {
    throw new Error('normalisation broke');
  },
}));

const WEBSITE_ID = 'f69b618e-a134-4cd9-af69-d4479c418de8';

afterEach(() => {
  vi.unstubAllEnvs();
  resetDefaultPageviewSender();
  document.head.querySelectorAll('script[data-website-id]').forEach((script) => script.remove());
});

describe('a successful mutation when the web analytics fails', () => {
  it('still resolves and refreshes when the address normalisation throws while the accept is reported', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    resetFakeBackend();
    handlers.respondToChallenge = async () => ({ success: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useChallengeActions(), { wrapper });

    await expect(result.current.accept.mutateAsync('c1')).resolves.toMatchObject({ success: true });

    expect(invalidate).toHaveBeenCalled();
    expect(result.current.accept.isError).toBe(false);
  });
});
