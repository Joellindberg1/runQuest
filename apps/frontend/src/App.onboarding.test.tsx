import React from 'react';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOnboardingQueue } from '@/features/onboarding/hooks/useOnboardingQueue';
import { Outlet } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';
import { useAuth } from '@/providers/authContext';
import { changelog } from '@/features/changelog/changelogData';
import { announcedNotes } from '@/features/changelog/changelogModel';

// SPA-inloggning utan reload: onboarding-statusen får inte ärvas från den utloggade prefetchen (cachad som "inget sett")
// eller från föregående användare på samma flik. Riktig AuthProvider, App-gate, useAppInit och OnboardingOrchestrator;
// bara backendApi, nätverket, touren/patch-modalen (markörer) och skalet/sidan bakom login är ersatta.
const api = vi.hoisted(() => {
  const state = { token: null as string | null };
  return {
    state,
    isAuthenticated: () => state.token !== null,
    getCurrentUser: () => null,
    getToken: () => state.token,
    login: vi.fn(),
    logout: vi.fn(() => { state.token = null; }),
    onUnauthorized: undefined as undefined | (() => void),
    getStravaStatus: async () => ({ success: true, data: { connected: false, expired: false } }),
  };
});

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/shared/services/levelService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/services/levelService')>();
  actual.frontendLevelService.refresh = () => Promise.resolve([]);
  return actual;
});
vi.mock('@/app-shell/AppShell', () => ({ AppShell: () => <div data-testid="shell"><Outlet /></div> }));
vi.mock('@/features/onboarding/components/OnboardingTour', () => ({
  OnboardingTour: () => <div data-testid="onboarding-tour" />,
}));
vi.mock('@/features/onboarding/components/PatchNotesModal', () => ({
  PatchNotesModal: ({ note }: { note: { slug: string } }) => <div data-testid="patch-notes">{note.slug}</div>,
}));
vi.mock('@/pages/BoardPage', () => ({
  default: function BoardStub() {
    const { logout } = useAuth();
    return <button onClick={logout}>Log out</button>;
  },
}));

import App from './App';
import { warmLanding, warmOnboarding } from '@/test/warmLazy';

const ALL_SLUGS = [
  'onboarding_v1',
  ...announcedNotes(changelog.releases).map((note) => note.slug),
  'tour_leaderboard_v2', 'tour_titles_v2', 'tour_duels_v2', 'tour_events_v2', 'tour_profile_v2', 'tour_news_v2',
];

// Servern svarar per token: användare A har sett allt, användare B är ny. Användare C har sett allt utom /news-turen, men har sett den gamla
// tour_news_v1 (raden finns kvar i databasen); användare D har sett allt utom den gamla v1.
const SEEN_BY_TOKEN: Record<string, string[]> = {
  'token-a': ALL_SLUGS,
  'token-b': [],
  'token-c': [...ALL_SLUGS.filter((slug) => slug !== 'tour_news_v2'), 'tour_news_v1'],
  'token-d': ALL_SLUGS,
};
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
  return { ok: true, json: async () => ({ seen: SEEN_BY_TOKEN[token] }) } as Response;
});
const statusCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/onboarding/status'));

const loginAs = (token: string) => {
  api.login.mockImplementation(async () => {
    api.state.token = token;
    return { success: true, user: { id: token, name: token, email: `${token}@example.com` } };
  });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: token } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
};

beforeEach(() => {
  setViewportWidth(390);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  api.state.token = null;
  api.login.mockReset();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeAll(async () => {
  await warmLanding();
  await warmOnboarding();
});

describe('onboarding efter SPA-inloggning', () => {
  it('utloggad: ingen status hämtas och ingenting visas', async () => {
    render(<App />);
    await screen.findByRole('link', { name: 'Sign in' });
    expect(statusCalls()).toHaveLength(0);
    expect(screen.queryByTestId('onboarding-tour')).toBeNull();
  });

  it('inloggning utan reload hämtar /onboarding/status och visar INTE touren när allt är sett', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    await screen.findByLabelText('Username');

    loginAs('token-a');
    await screen.findByRole('button', { name: 'Log out' });

    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    // Låt kön hinna räkna ut sitt nästa objekt; sett allt → inget visas.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('onboarding-tour')).toBeNull();
    expect(screen.queryByTestId('patch-notes')).toBeNull();
  });

  it('logout → inloggning som en annan användare läser om statusen och ärver inte föregående sett-lista', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    await screen.findByLabelText('Username');
    loginAs('token-a');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(window.location.pathname).not.toBe('/board'));
    expect(statusCalls()).toHaveLength(1);

    window.history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await screen.findByLabelText('Username');
    loginAs('token-b');

    expect(await screen.findByTestId('onboarding-tour')).toBeInTheDocument();
    expect(statusCalls()).toHaveLength(2);
  });
});

describe('onboarding-kön: /news-turen', () => {
  async function currentItemFor(token: string) {
    api.state.token = token;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useOnboardingQueue(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    return result.current.currentItem;
  }

  it('kön innehåller tour_news_v2 och inte tour_news_v1', async () => {
    // Osedd v2 är nästa post, även för den som redan sett v1 — slugen är bumpad, så alla ser turen igen.
    expect(await currentItemFor('token-c')).toBe('tour_news_v2');
    // v1 är ingen kö-post: den som sett allt utom v1 (token-d har aldrig sett den) har inget kvar.
    expect(await currentItemFor('token-d')).toBeNull();
  });
});
