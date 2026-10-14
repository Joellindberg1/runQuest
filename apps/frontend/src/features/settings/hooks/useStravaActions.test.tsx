import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { useStravaActions } from './useStravaActions';

const api = vi.hoisted(() => ({ isAuthenticated: vi.fn(), connectStrava: vi.fn(), syncStrava: vi.fn() }));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

const CONSENT_KEY = 'rq.strava.consent';

let open: ReturnType<typeof vi.fn>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const callback = (data: Record<string, unknown>) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin }));
  });

beforeEach(() => {
  sessionStorage.clear();
  api.isAuthenticated.mockReset().mockReturnValue(true);
  api.connectStrava.mockReset().mockResolvedValue({ success: true });
  open = vi.fn().mockReturnValue({});
  window.open = open as unknown as typeof window.open;
});
afterEach(() => sessionStorage.clear());

describe('useStravaActions connect', () => {
  it('without consent stores nothing and opens no window', async () => {
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await act(async () => { await result.current.connect(false); });

    expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('with consent stores the version and opens the Strava window', async () => {
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await act(async () => { await result.current.connect(true); });

    expect(sessionStorage.getItem(CONSENT_KEY)).toBe(STRAVA_CONSENT_VERSION);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('stores nothing when Strava is not configured, since no window opens', async () => {
    const { result } = renderHook(() => useStravaActions({ clientId: null }), { wrapper });

    await act(async () => { await result.current.connect(true); });

    expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Strava is not configured on the server');
  });
});

describe('useStravaActions callback', () => {
  it('consumes the remembered consent even when the user is no longer signed in', async () => {
    api.isAuthenticated.mockReturnValue(false);
    sessionStorage.setItem(CONSENT_KEY, STRAVA_CONSENT_VERSION);
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await callback({ stravaCode: 'abc' });

    await waitFor(() => expect(result.current.error).toBe('Authentication required'));
    expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(api.connectStrava).not.toHaveBeenCalled();
  });
});
