import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { useRunnerTitles } from './useRunnerQueries';

// Kopplingstest mot den riktiga klienten: 404 från /titles/user/:id (löparen är i en annan grupp) ger tom titellista utan felkort
// och utan omförsök. Regeln om vad 404 betyder ligger i backendApi.titles.test.ts.

const auth: AuthContextType = {
  user: { id: 'u-me', name: 'Me', email: 'me@example.com' },
  login: async () => ({ success: true }),
  logout: () => {},
  loading: false,
  isAdmin: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('runquest_token', 'tok');
  fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ success: false, error: 'User not found' }) } as Response);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe('useRunnerTitles', () => {
  it('en löpare utanför gruppen (404) ger en tom lista, inget fel och inga omförsök', async () => {
    const { result } = renderHook(() => useRunnerTitles('u-elsewhere'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
