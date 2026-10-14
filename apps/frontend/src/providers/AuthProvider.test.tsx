import { useContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { AuthProvider } from './AuthProvider';
import { AuthContext, type AuthContextType } from './authContext';
import { BADGE_QUERY_KEYS } from '@/features/badges/hooks/useBadgeQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { ONBOARDING_QUERY_KEY } from '@/features/onboarding/hooks/useOnboarding';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { LEVELS_QUERY_KEY } from '@/shared/hooks/useLevelRequirements';
import { USER_SETTINGS_QUERY_KEY } from '@/features/settings/hooks/useUserSettings';

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

  it('401 → rensa → ingen omhämtning: en aktiv query som får 401 hämtas inte om (resetQueries/invalidateQueries skulle loopa)', async () => {
    const client = new QueryClient();
    const ctx: { current: AuthContextType | null } = { current: null };
    // Svarar 401 varje gång: backendApi anropar onUnauthorized när svaret är 401.
    const queryFn = vi.fn(async () => { api.onUnauthorized?.(); throw new Error('401'); });
    const Group = () => { useQuery({ queryKey: BADGE_QUERY_KEYS.group, queryFn, retry: false }); return null; };
    // Som riktiga appen: de skyddade sidorna (observatörerna) finns bara medan user finns.
    const Gate = () => {
      ctx.current = useContext(AuthContext) as AuthContextType;
      return ctx.current.user ? <Group /> : null;
    };
    render(<QueryClientProvider client={client}><AuthProvider><Gate /></AuthProvider></QueryClientProvider>);
    await waitFor(() => expect(ctx.current).not.toBeNull());
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Karl', email: 'k@x.se' } });
    await act(async () => { await ctx.current?.login('Karl', 'pw'); });

    await waitFor(() => expect(ctx.current?.user).toBeNull()); // 401:an loggade ut användaren
    await new Promise((resolve) => setTimeout(resolve, 100));
    // clear() startar ingen omhämtning själv; observatören som hinner rendera om innan sidan avmonteras kan högst göra ett enda försök till.
    // resetQueries() gav 469 anrop (stack overflow), invalidateQueries() lämnar en query kvar i cachen.
    const calls = queryFn.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(queryFn).toHaveBeenCalledTimes(calls);
    expect(client.getQueryCache().findAll()).toHaveLength(0);
  });

  it('login, logout och 401 rensar inställningscachen', async () => {
    // Inställningarna (och vad som är avstängt) tillhör en användare: nästa inloggning på samma flik får aldrig se dem.
    const settings = { values: { 'notify.title_others': false }, customised: ['notify.title_others'] };
    const scenarios: Array<[string, (ctx: { current: AuthContextType | null }) => Promise<void>]> = [
      ['login', async (ctx) => {
        api.login.mockResolvedValue({ success: true, user: { id: 'u2', name: 'Karl', email: 'k@x.se' } });
        await act(async () => { await ctx.current?.login('Karl', 'pw'); });
      }],
      ['logout', async (ctx) => { await act(async () => { await ctx.current?.logout(); }); }],
      ['401', async () => { act(() => api.onUnauthorized?.()); }],
    ];
    for (const [name, trigger] of scenarios) {
      const { client, ctx } = setup();
      await waitFor(() => expect(ctx.current).not.toBeNull());
      await waitFor(() => expect(api.onUnauthorized).toBeTypeOf('function'));
      client.setQueryData(USER_SETTINGS_QUERY_KEY, settings);
      expect({ name, before: client.getQueryData(USER_SETTINGS_QUERY_KEY) }).toEqual({ name, before: settings });
      await trigger(ctx);
      expect({ name, after: client.getQueryData(USER_SETTINGS_QUERY_KEY) }).toEqual({ name, after: undefined });
      cleanup();
    }
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
