import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { PUBLIC_STATS_QUERY_KEY, usePublicStats } from './usePublicStats';

const wrapperFor = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const newClient = () => new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const okStats = (data: unknown = { runners: 6, challenges: 4, km: 4551 }) => jsonResponse({ success: true, data });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePublicStats', () => {
  it('hämtar tre tal från /public/stats utan inloggningshuvud', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okStats());
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(newClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ runners: 6, challenges: 4, km: 4551 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(new URL(url).pathname).toBe('/api/public/stats');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('är färsk lika länge som backendens cache, så en ny montering inom tiden inte hämtar igen', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(okStats()));
    vi.stubGlobal('fetch', fetchSpy);
    const client = newClient();
    const first = renderHook(() => usePublicStats(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => usePublicStats(), { wrapper: wrapperFor(client) });
    expect(second.result.current.data).toEqual({ runners: 6, challenges: 4, km: 4551 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('ett ogiltigt svar är ett fel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okStats({ runners: 'sex', challenges: 4, km: 4551 }))));
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it.each([
    ['negativt antal löpare', { runners: -1, challenges: 4, km: 4551 }],
    ['negativa km', { runners: 6, challenges: 4, km: -10 }],
    ['saknat fält', { runners: 6, challenges: 4 }],
    ['inte ändligt', { runners: 6, challenges: 4, km: null }],
  ])('avvisar ogiltiga tal: %s', async (_name, data) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okStats(data))));
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('hämtar inte om vid fönsterfokus eller återanslutning, inte ens när svaret har blivit inaktuellt', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(okStats()));
    vi.stubGlobal('fetch', fetchSpy);
    const client = newClient();
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Gör svaret inaktuellt utan att hämta; då är det bara refetchOnWindowFocus/Reconnect som skulle hämta igen.
    await client.invalidateQueries({ queryKey: PUBLIC_STATS_QUERY_KEY, refetchType: 'none' });
    expect(client.getQueryState(PUBLIC_STATS_QUERY_KEY)?.isInvalidated).toBe(true);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    focusManager.setFocused(undefined);
  });

  it('försöker inte igen vid 4xx', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ error: 'Not found' }, 404)));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('försöker en gång till vid 500 och ger sedan upp', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ error: 'Failed' }, 500)));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('ett nätverksfel blir ett fel, inte ett undantag ut ur hooken', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => usePublicStats(), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
