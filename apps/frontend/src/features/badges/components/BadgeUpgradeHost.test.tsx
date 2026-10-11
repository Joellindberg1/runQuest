import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { AppRoutes } from '@/routes';
import { ME } from '@/test/fakeBackend';
import { setViewportWidth } from '@/test/viewport';
import type { GroupBadges } from '../api';
import { BADGE_QUERY_KEYS } from '../hooks/useBadgeQueries';
import { BadgeUpgradeHost } from './BadgeUpgradeHost';

// Uppgraderingspopupens värd (RUN-132, ADR 009 beslut 5, Council 22): kön ur min samling, en popup per serie, "seen" vid avfärdande och väntan på
// onboarding-touren och "What's new". Nätverket (badges-API, onboarding-status) är ersatt; hooks, modell och dialog är de riktiga.

const api = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn(), markSeen: vi.fn() }));
vi.mock('../api', () => ({ badgesApi: api }));
const onboarding = vi.hoisted(() => ({ seen: [] as string[], fail: false }));
vi.mock('@/features/onboarding/onboardingApi', () => ({
  fetchOnboardingStatus: async () => { if (onboarding.fail) throw new Error('no status'); return [...onboarding.seen]; },
  markOnboardingSeen: async () => {},
}));
vi.mock('@/features/changelog/changelogData', () => ({
  changelog: { releases: [{ version: '9.9.9', type: 'patch', date: '1 January 2030', title: 'Test release', announce: true, changes: [] }] },
}));
// Routingtestet (nedan) behöver en fungerande bakgrund för Board; touren har egna tester.
vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

const PATCH_SLUG = 'patch_v9.9.9';
const SEEN_ALL_GLOBAL = ['onboarding_v1', PATCH_SLUG];
const [first, second, third] = BADGE_SERIES;

const item = (series: string, tier: number, seen: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: seen });
const mine = (...items: BadgeUserItem[]): BadgeUserResponse => ({ items, showcase: [] });
const group = (): GroupBadges => ({
  members: [],
  holders: Object.fromEntries(BADGE_SERIES.map((series) => [series.key, { '1': 4, '2': 4, '3': 4, '4': 4, '5': 4, '6': 4 }])),
  member_count: 6,
});

let queryClient: QueryClient;

function renderHost(entry = '/board') {
  setViewportWidth(390);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const auth: AuthContextType = { user: { id: ME.id, name: ME.name, email: 'joel@example.com' }, login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false };
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[entry]}><BadgeUpgradeHost /></MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}
const dialog = () => screen.queryByRole('dialog');
const eyebrow = () => document.querySelector('.rq-badge-popup__eyebrow')?.textContent;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getGroupBadges.mockResolvedValue(group());
  api.markSeen.mockResolvedValue({ seen: true });
  onboarding.seen = [...SEEN_ALL_GLOBAL];
  onboarding.fail = false;
  document.body.classList.remove('driver-active');
});

describe('BadgeUpgradeHost: kön ur min samling (T1)', () => {
  it('popup för serie med tier > seen_tier: earned (seen 0) med serienamn, kravtext och held-by ur gruppen', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 3, 0)));
    renderHost();

    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
    expect(eyebrow()).toBe('Badge earned');
    expect(screen.getByText(`Held by 4 of 6 in your pack`)).toBeInTheDocument();
    expect(api.getUserBadges).toHaveBeenCalledWith(ME.id);
  });

  it('evolved när seen_tier redan var 1 eller högre: nivåraden visar gamla → nya nivån', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 4, 2)));
    renderHost();

    await screen.findByRole('dialog');
    expect(eyebrow()).toBe('Badge evolved');
    expect(document.querySelector('.rq-badge-popup__tierline')?.textContent).toBe(`${TIER_NAMES[1]} → ${TIER_NAMES[3]}`);
  });

  it('tier == seen_tier → ingen popup (och gruppen hämtas inte i onödan)', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 3, 3), item(second.key, 1, 1)));
    renderHost();

    await waitFor(() => expect(api.getUserBadges).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(dialog()).toBeNull();
    expect(api.getGroupBadges).not.toHaveBeenCalled();
  });

  it('två serier → kö: "1 of 2" på första, "2 of 2" på andra; serieordningen följer BADGE_SERIES', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(second.key, 1, 0), item(first.key, 2, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    expect(eyebrow()).toBe('Badge earned · 1 of 2');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    await screen.findByRole('dialog', { name: second.name });
    expect(eyebrow()).toBe('Badge earned · 2 of 2');
    expect(screen.queryByRole('button', { name: 'Skip all' })).toBeNull();
  });

  it('en popup per serie (högsta nya tier), inte en per tier', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 2, 0), item(first.key, 5, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    expect(screen.getByText(TIER_NAMES[4], { selector: '.rq-chip' })).toBeInTheDocument();
    expect(eyebrow()).toBe('Badge earned');
  });

  it('held-by utelämnas när gruppen inte går att hämta, men popupen visas ändå', async () => {
    api.getGroupBadges.mockRejectedValue(new Error('group down'));
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name }, { timeout: 4000 }); // gruppens ett omförsök (useGroupBadges) tar ca 1 s
    expect(document.querySelector('.rq-badge-popup__held')).toBeNull();
  });

  it('visas inte på /, /login eller landningen: värden ligger i skalet, så utloggade vägar hämtar ingen badge-data och öppnar ingen popup', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 3, 0)));
    for (const path of ['/', '/login']) {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const auth: AuthContextType = { user: null, login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false };
      const { unmount } = render(
        <QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}>
          <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
        </AuthContext.Provider></QueryClientProvider>,
      );
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect({ path, dialog: dialog() }).toEqual({ path, dialog: null });
      unmount();
    }
    expect(api.getUserBadges).not.toHaveBeenCalled();
  });

  it('kontroll: inne i skalet (AppRoutes → /board, inloggad) visas samma popup', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 3, 0)));
    setViewportWidth(390);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const auth: AuthContextType = { user: { id: ME.id, name: ME.name, email: 'joel@example.com' }, login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false };
    render(
      <QueryClientProvider client={client}><AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/board']}><AppRoutes /></MemoryRouter>
      </AuthContext.Provider></QueryClientProvider>,
    );

    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
  });
});

describe('BadgeUpgradeHost: avfärdande (T4)', () => {
  it('avfärdande anropar POST /badges/seen med serien — Got it, ✕ och Escape', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0), item(second.key, 1, 0), item(third.key, 1, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(api.markSeen).toHaveBeenNthCalledWith(1, [first.key]));

    await screen.findByRole('dialog', { name: second.name });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(api.markSeen).toHaveBeenNthCalledWith(2, [second.key]));

    await screen.findByRole('dialog', { name: third.name });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Escape' });
    await waitFor(() => expect(api.markSeen).toHaveBeenNthCalledWith(3, [third.key]));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('Skip all markerar alla i kön och stänger', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0), item(second.key, 2, 1), item(third.key, 3, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));

    await waitFor(() => expect(api.markSeen).toHaveBeenCalledTimes(1));
    expect(api.markSeen).toHaveBeenCalledWith([first.key, second.key, third.key]);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('"Skip all" efter att första avfärdats markerar bara de som är kvar', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0), item(second.key, 1, 0), item(third.key, 1, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await screen.findByRole('dialog', { name: second.name });
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));

    await waitFor(() => expect(api.markSeen).toHaveBeenLastCalledWith([second.key, third.key]));
  });

  it('kön visar inte samma serie två gånger vid refetch mitt i kön (servern har ännu inte hunnit uppdatera seen_tier)', async () => {
    const stale = mine(item(first.key, 1, 0), item(second.key, 1, 0));
    api.getUserBadges.mockResolvedValue(stale);
    api.markSeen.mockImplementation(() => new Promise(() => {})); // POST:en är fortfarande på väg när omhämtningen landar
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await screen.findByRole('dialog', { name: second.name });

    const calls = api.getUserBadges.mock.calls.length;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: BADGE_QUERY_KEYS.user(ME.id) }); });
    expect(api.getUserBadges.mock.calls.length).toBeGreaterThan(calls);

    expect(screen.getByRole('dialog', { name: second.name })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: first.name })).toBeNull();
    expect(eyebrow()).toBe('Badge earned · 2 of 2');
  });

  it('"2 of 3" hoppar inte till "2 of 2" när kön krymper optimistiskt: antalet är det vid öppning', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0), item(second.key, 1, 0), item(third.key, 1, 0)));
    renderHost();

    await screen.findByRole('dialog', { name: first.name });
    expect(eyebrow()).toBe('Badge earned · 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await screen.findByRole('dialog', { name: second.name });
    await act(async () => { await Promise.resolve(); });
    expect(eyebrow()).toBe('Badge earned · 2 of 3');
  });

  it('en ny badge som kommer in efter att allt avfärdats öppnar en ny session', async () => {
    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0)));
    renderHost();
    await screen.findByRole('dialog', { name: first.name });
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(dialog()).toBeNull());

    api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 1), item(second.key, 2, 0)));
    await act(async () => { await queryClient.invalidateQueries({ queryKey: BADGE_QUERY_KEYS.user(ME.id) }); });

    await screen.findByRole('dialog', { name: second.name });
    expect(eyebrow()).toBe('Badge earned');
  });
});

describe('BadgeUpgradeHost: väntar på onboarding och changelog (T5, Council 22)', () => {
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const unseen = () => api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0)));

  it('öppnas inte medan onboarding-touren (onboarding_v1) återstår, och visas när den markerats sedd', async () => {
    unseen();
    onboarding.seen = [PATCH_SLUG];
    renderHost();

    await waitFor(() => expect(api.getGroupBadges).toHaveBeenCalled());
    await settle();
    expect(dialog()).toBeNull();

    onboarding.seen = SEEN_ALL_GLOBAL;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }); });
    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
  });

  it('öppnas inte medan changelog-popupen ("What\'s new") återstår, och visas när den stängts', async () => {
    unseen();
    onboarding.seen = ['onboarding_v1'];
    renderHost();

    await waitFor(() => expect(api.getGroupBadges).toHaveBeenCalled());
    await settle();
    expect(dialog()).toBeNull();

    onboarding.seen = SEEN_ALL_GLOBAL;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }); });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('öppnas inte medan onboarding-statusen laddas', async () => {
    unseen();
    onboarding.seen = [];
    renderHost();
    await settle();
    expect(dialog()).toBeNull();
  });

  it('en körande tour (driver.js sätter driver-active på <body>) döljer popupen och släpper tillbaka den när touren är klar', async () => {
    unseen();
    renderHost();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => { document.body.classList.add('driver-active'); });
    await waitFor(() => expect(dialog()).toBeNull());

    act(() => { document.body.classList.remove('driver-active'); });
    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
  });

  it('en tour som redan körs när värden monteras blockerar också', async () => {
    unseen();
    document.body.classList.add('driver-active');
    renderHost();

    await waitFor(() => expect(api.getGroupBadges).toHaveBeenCalled());
    await settle();
    expect(dialog()).toBeNull();
  });

  it('sidtourer (tour_*) väntar inte på något: en olästa sidtour blockerar inte popupen', async () => {
    unseen();
    onboarding.seen = SEEN_ALL_GLOBAL; // tour_leaderboard_v2 m.fl. är osedda
    renderHost();

    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
  });

  it('kan onboarding-statusen inte hämtas blockeras ingenting', async () => {
    unseen();
    onboarding.fail = true;
    renderHost();

    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
  });
});
