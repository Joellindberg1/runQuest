import { useContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthProvider';
import { AuthContext, type AuthContextType } from './authContext';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { levelUp, meta } from '@/features/news/news.fixture';

// Användarbundna cachar (Pack News med olästa) får inte ärvas av nästa användare på samma flik: login, logout och 401 rensar dem.
const api = vi.hoisted(() => ({
  isAuthenticated: () => false,
  getCurrentUser: () => null,
  login: vi.fn(),
  logout: vi.fn(),
  onUnauthorized: undefined as undefined | (() => void),
}));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/integrations/supabase/clientWithAuth', () => ({ supabase: { auth: { signOut: async () => undefined } } }));

const FEED = { items: [{ ...levelUp(1, 5), is_unread: true }], meta: meta({ unread_count: 1 }) };
const keys = [NEWS_QUERY_KEYS.feed(undefined), NEWS_QUERY_KEYS.feed('level_up')];

function setup() {
  const client = new QueryClient();
  const ctx: { current: AuthContextType | null } = { current: null };
  const Probe = () => { ctx.current = useContext(AuthContext) as AuthContextType; return null; };
  render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  const fill = () => keys.forEach((key) => client.setQueryData(key, FEED));
  const filled = () => keys.map((key) => client.getQueryData(key) !== undefined);
  return { client, ctx, fill, filled };
}

describe('AuthProvider rensar news-cachen', () => {
  it('login som en annan användare: inga ärvda olästa', async () => {
    const { ctx, fill, filled } = setup();
    await waitFor(() => expect(ctx.current).not.toBeNull());
    fill();
    api.login.mockResolvedValue({ success: true, user: { id: 'u2', name: 'Karl', email: 'k@x.se' } });
    await act(async () => { await ctx.current?.login('Karl', 'pw'); });
    expect(filled()).toEqual([false, false]);
  });

  it('logout rensar', async () => {
    const { ctx, fill, filled } = setup();
    await waitFor(() => expect(ctx.current).not.toBeNull());
    fill();
    await act(async () => { await ctx.current?.logout(); });
    expect(filled()).toEqual([false, false]);
  });

  it('401 (sessionen gick ut) rensar', async () => {
    const { fill, filled } = setup();
    await waitFor(() => expect(api.onUnauthorized).toBeTypeOf('function'));
    fill();
    act(() => api.onUnauthorized?.());
    expect(filled()).toEqual([false, false]);
  });

  it('misslyckad inloggning rör inte cachen', async () => {
    const { ctx, fill, filled } = setup();
    await waitFor(() => expect(ctx.current).not.toBeNull());
    fill();
    api.login.mockResolvedValue({ success: false, error: 'Wrong password' });
    await act(async () => { await ctx.current?.login('Karl', 'bad'); });
    expect(filled()).toEqual([true, true]);
  });
});
