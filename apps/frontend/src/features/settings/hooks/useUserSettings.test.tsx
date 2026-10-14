import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolveSettings } from '@runquest/shared';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { ME, levelUp, meta, newsServer } from '@/features/news/news.fixture';
import { USER_SETTINGS_QUERY_KEY, useUserSettings } from './useUserSettings';

const api = vi.hoisted(() => ({ getSettings: vi.fn(), putSettings: vi.fn(), getNews: vi.fn(), markNewsRead: vi.fn() }));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

const OTHERS = 'notify.title_others';
const EVENTS = 'notify.event_open';
const DEFAULTS = resolveSettings({}, 'user');

let queryClient: QueryClient;
let loggedIn: boolean;
const auth = (): AuthContextType => ({
  user: loggedIn ? { id: ME.id, name: ME.name, email: 'joel@example.com' } : null,
  login: vi.fn(),
  logout: vi.fn(),
  loading: false,
  isAdmin: false,
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthContext.Provider value={auth()}>{children}</AuthContext.Provider>
  </QueryClientProvider>
);

function serve(server = newsServer([])) {
  api.getSettings.mockImplementation(server.getSettings);
  api.putSettings.mockImplementation(server.putSettings);
  return server;
}

/** Håller PUT-svaret tills testet släpper det, så att det optimistiska läget går att se. */
function holdPut(server: ReturnType<typeof newsServer>) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  api.putSettings.mockImplementation(async (values: Record<string, never>) => {
    await gate;
    return server.putSettings(values);
  });
  return release;
}

beforeEach(() => {
  loggedIn = true;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe('useUserSettings', () => {
  it('laddar värden och växlar optimistiskt', async () => {
    const news = serve();
    news.server.settings = { [OTHERS]: false };
    const { result } = renderHook(() => useUserSettings(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.values[OTHERS]).toBe(false);
    expect(result.current.values[EVENTS]).toBe(true);
    expect(result.current.customised).toEqual([OTHERS]);
    expect(queryClient.getQueryData(USER_SETTINGS_QUERY_KEY)).toBeDefined();

    const release = holdPut(news);
    act(() => result.current.toggle(EVENTS));
    // Svaret är inte här än men reglaget har redan bytt läge.
    await waitFor(() => expect(result.current.values[EVENTS]).toBe(false));
    expect(result.current.customised).toContain(EVENTS);
    expect(news.server.settingsCalls).toEqual([]);

    await act(async () => { release(); });
    // Serverns hela tillstånd skrivs in i cachen när svaret kommit.
    await waitFor(() => expect(news.server.settingsCalls).toEqual([{ [EVENTS]: false }]));
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(result.current.values).toEqual({ ...DEFAULTS, [OTHERS]: false, [EVENTS]: false });
    expect(result.current.customised).toEqual([OTHERS, EVENTS]);
    expect(result.current.error).toBeNull();
  });

  it('ett misslyckat PUT återställer nyckeln och exponerar felet', async () => {
    const news = serve();
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    news.server.failNext = 'Failed to save settings';
    act(() => result.current.setValue(OTHERS, false));
    await waitFor(() => expect(result.current.error).toBe('Failed to save settings'));
    expect(result.current.values[OTHERS]).toBe(true);
    expect(result.current.customised).toEqual([]);

    // Nästa ändring tar bort det gamla felet.
    act(() => result.current.setValue(OTHERS, false));
    await waitFor(() => expect(result.current.values[OTHERS]).toBe(false));
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('ett fel läser om tillståndet i stället för att lita på återställningen (ett 500 kan ha skrivit ändå)', async () => {
    const news = serve();
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const getsBefore = news.server.settingsGets;

    // PUT:en skrev men återläsningen föll: servern har det nya värdet fast svaret är ett fel.
    news.server.failPutAfterWrite = true;
    act(() => result.current.setValue(OTHERS, false));
    await waitFor(() => expect(result.current.error).toBe('Failed to save settings'));
    // Omläsningen visar sanningen i stället för den lokalt återställda gissningen.
    await waitFor(() => expect(news.server.settingsGets).toBe(getsBefore + 1));
    await waitFor(() => expect(result.current.values[OTHERS]).toBe(false));
    expect(result.current.customised).toEqual([OTHERS]);
  });

  it('två snabba ändringar skickas i ordning och slutvärdet är det sista valet', async () => {
    const news = serve();
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const release = holdPut(news);
    act(() => {
      result.current.setValue(OTHERS, false);
      result.current.setValue(OTHERS, true);
    });
    // Båda valen syns direkt, men den andra skrivningen väntar in den första (annars kunde de landa omkastade).
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledTimes(1));
    expect(result.current.values[OTHERS]).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(api.putSettings).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(news.server.settingsCalls).toHaveLength(2));
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(news.server.settingsCalls).toEqual([{ [OTHERS]: false }, { [OTHERS]: true }]);
    expect(news.server.settings[OTHERS]).toBe(true);
    expect(result.current.values[OTHERS]).toBe(true);
  });

  it('efter lyckad skrivning invalideras nyhetsflödet', async () => {
    const news = serve();
    queryClient.setQueryData(NEWS_QUERY_KEYS.feed(undefined), { items: [levelUp(1, 5)], meta: meta() });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['news', 'feed'] });

    act(() => result.current.toggle(OTHERS));
    await waitFor(() => expect(news.server.settingsCalls).toHaveLength(1));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['news', 'feed'] }));
    expect(queryClient.getQueryState(NEWS_QUERY_KEYS.feed(undefined))?.isInvalidated).toBe(true);
  });

  it('ett laddningsfel ger defaults och blockerar inte', async () => {
    const news = serve();
    // Hämtningen får ett omförsök, så felet måste gälla båda anropen.
    api.getSettings.mockResolvedValue({ success: false, error: 'Failed to fetch settings' });
    const { result } = renderHook(() => useUserSettings(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.values).toEqual(DEFAULTS);
    expect(result.current.customised).toEqual([]);

    // Reglagen fungerar ändå: skrivningen går igenom och serverns tillstånd tar över.
    act(() => result.current.toggle(OTHERS));
    await waitFor(() => expect(result.current.values[OTHERS]).toBe(false));
    await waitFor(() => expect(news.server.settings[OTHERS]).toBe(false));
  });

  it('utloggad: ingen hämtning görs', async () => {
    loggedIn = false;
    serve();
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.getSettings).not.toHaveBeenCalled();
    expect(result.current.values).toEqual(DEFAULTS);
    expect(result.current.isLoading).toBe(false);
  });
});
