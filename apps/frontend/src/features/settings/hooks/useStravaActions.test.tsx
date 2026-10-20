import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { BADGE_QUERY_KEYS } from '@/features/badges/hooks/useBadgeQueries';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { STRAVA_QUERY_KEYS } from '@/shared/hooks/useStravaQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { track } from '@/shared/analytics/track';
import { useStravaActions } from './useStravaActions';

vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));

const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(), connectStrava: vi.fn(), syncStrava: vi.fn(), setStravaSyncPaused: vi.fn(), disconnectStrava: vi.fn(),
}));
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

describe('useStravaActions consent_required', () => {
  const HINT = /privacy text has been updated/i;
  const GENERIC = 'Could not connect Strava';

  it('shows the reload hint for the code consent_required, whatever the text says', async () => {
    api.connectStrava.mockResolvedValue({ success: false, error: 'Some other wording from a later server', code: 'consent_required' });
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await callback({ stravaCode: 'abc' });

    await waitFor(() => expect(result.current.error).toMatch(HINT));
  });

  it('shows the generic error for the old text without a code: the accepted downgrade against a backend from before step 1', async () => {
    // Medvetet (ADR 007 Addendum 2026-10-20 punkt 7): klienten grenar på koden, inte på texten. En backend före steg 1 ger bara texten, och då blir felet det generella.
    api.connectStrava.mockResolvedValue({ success: false, error: 'Consent required' });
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await callback({ stravaCode: 'abc' });

    await waitFor(() => expect(result.current.error).toBe(GENERIC));
  });
});

describe('useStravaActions web analytics', () => {
  const CODE = 'abc-athlete-code';

  beforeEach(() => {
    vi.mocked(track).mockClear();
    api.syncStrava.mockReset().mockResolvedValue({ success: true, data: { newRuns: 2 } });
    api.setStravaSyncPaused.mockReset().mockResolvedValue({ success: true });
    api.disconnectStrava.mockReset().mockResolvedValue({ success: true });
  });

  it('reports strava-connected, and nothing about the athlete or the code, once the server has accepted the connection', async () => {
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await callback({ stravaCode: CODE });

    await waitFor(() => expect(result.current.status).toBe('Strava connected. Your runs will start syncing.'));
    expect(track).toHaveBeenCalledExactlyOnceWith('strava-connected');
  });

  it('reports nothing when the server refuses the connection, throws, or the authorisation fails', async () => {
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    api.connectStrava.mockResolvedValue({ success: false, error: 'Consent required', code: 'consent_required' });
    await callback({ stravaCode: CODE });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    api.connectStrava.mockRejectedValue(new Error('offline'));
    await callback({ stravaCode: CODE });
    await callback({ error: 'access_denied' });

    expect(track).not.toHaveBeenCalled();
  });

  it('reports nothing for sync, pause, resume and disconnect, and nothing when only the Strava window is opened', async () => {
    const { result } = renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper });

    await act(async () => { await result.current.connect(true); });
    await act(async () => { await result.current.sync(); });
    await act(async () => { await result.current.pause(); });
    await act(async () => { await result.current.resume(); });
    await act(async () => { await result.current.disconnect(); });

    expect(track).not.toHaveBeenCalled();
  });
});

describe('useStravaActions pause, resume and disconnect', () => {
  let client: QueryClient;
  const clientWrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const mount = () => renderHook(() => useStravaActions({ clientId: '12345' }), { wrapper: clientWrapper });
  const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  const seed = (...keys: (readonly unknown[])[]) => keys.forEach((key) => client.setQueryData(key, { seeded: true }));

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.setStravaSyncPaused.mockReset().mockResolvedValue({ success: true, data: { sync_paused: true, paused_at: '2026-10-12T08:30:00+00:00' } });
    api.disconnectStrava.mockReset().mockResolvedValue({ success: true, message: 'Strava disconnected successfully' });
  });
  afterEach(() => vi.useRealTimers());

  it('pause puts paused true, confirms in the card status and refreshes the strava status', async () => {
    seed(STRAVA_QUERY_KEYS.status);
    const { result } = mount();

    let done = false;
    await act(async () => { done = await result.current.pause(); });

    expect(done).toBe(true);
    expect(api.setStravaSyncPaused).toHaveBeenCalledWith(true);
    expect(result.current.status).toMatch(/^Sync paused/);
    expect(result.current.connectionError).toBeNull();
    expect(invalidated(STRAVA_QUERY_KEYS.status)).toBe(true);
  });

  it('a failed pause reports it for the dialog, leaves the card status alone and refreshes nothing', async () => {
    api.setStravaSyncPaused.mockResolvedValue({ success: false, error: 'Rate limit' });
    seed(STRAVA_QUERY_KEYS.status);
    const { result } = mount();

    let done = true;
    await act(async () => { done = await result.current.pause(); });

    expect(done).toBe(false);
    expect(result.current.connectionError).toBe("Couldn't pause sync. Try again.");
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(invalidated(STRAVA_QUERY_KEYS.status)).toBe(false);
  });

  it('resume puts paused false, confirms that sync is back on and refreshes status and runs now and once more after the background sync had time', async () => {
    vi.useFakeTimers();
    seed(STRAVA_QUERY_KEYS.status, USERS_WITH_RUNS_QUERY_KEY);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = mount();

    await act(async () => { await result.current.resume(); });

    expect(api.setStravaSyncPaused).toHaveBeenCalledWith(false);
    expect(result.current.status).toBe('Sync is back on. New runs from the pause are on their way.');
    expect(invalidated(STRAVA_QUERY_KEYS.status)).toBe(true);
    expect(invalidated(USERS_WITH_RUNS_QUERY_KEY)).toBe(true);
    const usersCalls = () => spy.mock.calls.filter(([filters]) => filters?.queryKey === USERS_WITH_RUNS_QUERY_KEY).length;
    const before = usersCalls();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(usersCalls()).toBeGreaterThan(before);
  });

  it('a failed resume is an error in the card, since no dialog is open', async () => {
    api.setStravaSyncPaused.mockResolvedValue({ success: false, error: 'down' });
    const { result } = mount();

    await act(async () => { await result.current.resume(); });

    expect(result.current.error).toBe("Couldn't turn sync back on. Try again.");
    expect(result.current.connectionError).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('disconnect calls the endpoint, confirms in the card status and refreshes strava, users and runs, the board, titles, challenges, news and badges', async () => {
    const keys = [
      STRAVA_QUERY_KEYS.status, USERS_WITH_RUNS_QUERY_KEY, ['leaderboard', 'week'], ['titles', 'all'], ['challenges', 'mine'], NEWS_QUERY_KEYS.feedRoot, BADGE_QUERY_KEYS.root,
    ] as const;
    seed(...keys);
    const { result } = mount();

    let done = false;
    await act(async () => { done = await result.current.disconnect(); });

    expect(done).toBe(true);
    expect(api.disconnectStrava).toHaveBeenCalledTimes(1);
    expect(result.current.status).toMatch(/^Strava disconnected/);
    expect(keys.filter((key) => !invalidated(key))).toEqual([]);
  });

  it('a failed disconnect reports it for the dialog and refreshes nothing', async () => {
    api.disconnectStrava.mockResolvedValue({ success: false, error: 'Failed to disconnect Strava' });
    seed(STRAVA_QUERY_KEYS.status, USERS_WITH_RUNS_QUERY_KEY);
    const { result } = mount();

    let done = true;
    await act(async () => { done = await result.current.disconnect(); });

    expect(done).toBe(false);
    expect(result.current.connectionError).toBe("Couldn't disconnect. Try again.");
    expect(result.current.status).toBeNull();
    expect(invalidated(STRAVA_QUERY_KEYS.status)).toBe(false);
    expect(invalidated(USERS_WITH_RUNS_QUERY_KEY)).toBe(false);
  });

  it('a request that throws is a failure, not an unhandled rejection', async () => {
    api.disconnectStrava.mockRejectedValue(new Error('network'));
    const { result } = mount();

    await act(async () => { expect(await result.current.disconnect()).toBe(false); });

    expect(result.current.connectionError).toBe("Couldn't disconnect. Try again.");
  });

  it('reports which action is running while the request is in flight and none afterwards', async () => {
    let finish: (value: unknown) => void = () => {};
    api.disconnectStrava.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = mount();

    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => { pending = result.current.disconnect(); });
    expect(result.current.connectionBusy).toBe('disconnect');

    await act(async () => { finish({ success: true }); await pending; });
    expect(result.current.connectionBusy).toBeNull();
  });

  it('without a session it asks for one in the dialog and sends nothing', async () => {
    api.isAuthenticated.mockReturnValue(false);
    const { result } = mount();

    await act(async () => { expect(await result.current.pause()).toBe(false); });
    expect(result.current.connectionError).toBe('Authentication required');
    await act(async () => { expect(await result.current.disconnect()).toBe(false); });

    expect(api.setStravaSyncPaused).not.toHaveBeenCalled();
    expect(api.disconnectStrava).not.toHaveBeenCalled();
    expect(result.current.connectionBusy).toBeNull();
  });

  it('without a session a resume asks for one in the card, not in a dialog', async () => {
    api.isAuthenticated.mockReturnValue(false);
    const { result } = mount();

    await act(async () => { await result.current.resume(); });

    expect(result.current.error).toBe('Authentication required');
    expect(result.current.connectionError).toBeNull();
    expect(api.setStravaSyncPaused).not.toHaveBeenCalled();
  });

  it('a successful pause clears an older error in the card', async () => {
    api.syncStrava.mockResolvedValue({ success: false, error: 'Strava rate limit' });
    const { result } = mount();
    await act(async () => { await result.current.sync(); });
    expect(result.current.error).toBe('Strava rate limit');

    await act(async () => { await result.current.pause(); });

    expect(result.current.error).toBeNull();
    expect(result.current.status).toMatch(/^Sync paused/);
  });

  it('unmounting before the follow-up cancels it', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result, unmount } = mount();
    await act(async () => { await result.current.resume(); });
    // Run-kedjan har en egen fördröjd händelseomhämtning (runEffects); det är hookens EGEN uppföljning av strava och rundor som ska avbrytas.
    const followUps = () => spy.mock.calls.filter(([filters]) => filters?.queryKey === USERS_WITH_RUNS_QUERY_KEY || (filters?.queryKey as string[])?.[0] === 'strava').length;
    const atUnmount = followUps();

    unmount();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(followUps()).toBe(atUnmount);
  });

  it('clearing the dialog error removes it', async () => {
    api.setStravaSyncPaused.mockResolvedValue({ success: false });
    const { result } = mount();
    await act(async () => { await result.current.pause(); });
    expect(result.current.connectionError).not.toBeNull();

    act(() => result.current.clearConnectionError());

    expect(result.current.connectionError).toBeNull();
  });
});
