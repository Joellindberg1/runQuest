import { useContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { AuthProvider } from './AuthProvider';
import { AuthContext, type AuthContextType } from './authContext';
import { BADGE_QUERY_KEYS } from '@/features/badges/hooks/useBadgeQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { ONBOARDING_QUERY_KEY } from '@/features/onboarding/hooks/useOnboarding';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { LEVELS_QUERY_KEY } from '@/shared/hooks/useLevelRequirements';

// Förra användarens data (badges, grupp, users-with-runs, ...) får aldrig synas för nästa inloggning på samma flik:
// logout och 401 rensar HELA query-cachen, inte en lista av kända nycklar (en ny feature kan annars glömmas bort).
const api = vi.hoisted(() => ({
  isAuthenticated: () => false,
  getCurrentUser: () => null,
  login: vi.fn(),
  logout: vi.fn(),
  onUnauthorized: undefined as undefined | (() => void),
}));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));

const KEYS: QueryKey[] = [
  BADGE_QUERY_KEYS.group,
  BADGE_QUERY_KEYS.user('u1'),
  USERS_WITH_RUNS_QUERY_KEY,
  ONBOARDING_QUERY_KEY,
  NEWS_QUERY_KEYS.feed(undefined),
  LEVELS_QUERY_KEY,
  ['en-helt-ny-feature', 'u1'],
];

function setup() {
  const client = new QueryClient();
  const ctx: { current: AuthContextType | null } = { current: null };
  const Probe = () => { ctx.current = useContext(AuthContext) as AuthContextType; return null; };
  render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  const fill = () => KEYS.forEach((key) => client.setQueryData(key, { owner: 'u1' }));
  const remaining = () => KEYS.filter((key) => client.getQueryData(key) !== undefined);
  return { client, ctx, fill, remaining };
}

describe('AuthProvider rensar hela query-cachen', () => {
  it('logout rensar badge- och gruppcachar (och allt annat)', async () => {
    const { ctx, fill, remaining } = setup();
    await waitFor(() => expect(ctx.current).not.toBeNull());
    fill();
    expect(remaining()).toHaveLength(KEYS.length);
    await act(async () => { await ctx.current?.logout(); });
    expect(remaining()).toEqual([]);
  });

  it('401 rensar cachen', async () => {
    const { fill, remaining } = setup();
    await waitFor(() => expect(api.onUnauthorized).toBeTypeOf('function'));
    fill();
    act(() => api.onUnauthorized?.());
    expect(remaining()).toEqual([]);
  });

  it('inloggning som annan användare hämtar om i stället för att visa förra användarens data', async () => {
    const client = new QueryClient();
    const ctx: { current: AuthContextType | null } = { current: null };
    const fetchGroup = vi.fn(async () => ({ owner: 'u2' }));
    const Group = () => {
      ctx.current = useContext(AuthContext) as AuthContextType;
      const { data } = useQuery({ queryKey: BADGE_QUERY_KEYS.group, queryFn: fetchGroup, retry: false, staleTime: Infinity });
      return <span data-testid="owner">{data?.owner ?? 'none'}</span>;
    };
    client.setQueryData(BADGE_QUERY_KEYS.group, { owner: 'u1' });
    const view = render(<QueryClientProvider client={client}><AuthProvider><Group /></AuthProvider></QueryClientProvider>);
    expect(view.getByTestId('owner').textContent).toBe('u1');
    expect(fetchGroup).not.toHaveBeenCalled();

    // Nästa användare loggar in i samma flik: u1:s grupp är borta och u2:s hämtas.
    await act(async () => { await ctx.current?.logout(); });
    api.login.mockResolvedValue({ success: true, user: { id: 'u2', name: 'Karl', email: 'k@x.se' } });
    await act(async () => { await ctx.current?.login('Karl', 'pw'); });
    await waitFor(() => expect(view.getByTestId('owner').textContent).toBe('u2'));
    expect(fetchGroup).toHaveBeenCalledTimes(1);
  });

  it('401 → rensa → omhämtning som själv får 401 ger ingen loop', async () => {
    const client = new QueryClient();
    const queryFn = vi.fn(async () => { api.onUnauthorized?.(); throw new Error('401'); });
    const Group = () => { useQuery({ queryKey: BADGE_QUERY_KEYS.group, queryFn, retry: false }); return null; };
    render(<QueryClientProvider client={client}><AuthProvider><Group /></AuthProvider></QueryClientProvider>);
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('misslyckad inloggning rör inte cachen', async () => {
    const { ctx, fill, remaining } = setup();
    await waitFor(() => expect(ctx.current).not.toBeNull());
    fill();
    api.login.mockResolvedValue({ success: false, error: 'Wrong password' });
    await act(async () => { await ctx.current?.login('Karl', 'bad'); });
    expect(remaining()).toHaveLength(KEYS.length);
  });
});
