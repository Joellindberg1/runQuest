import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BADGE_SERIES } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { ME } from '@/test/fakeBackend';
import { setViewportWidth } from '@/test/viewport';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import type { GroupBadges } from '../api';
import { BadgeUpgradeHost } from './BadgeUpgradeHost';
import { DISMISS_GUARD_MS } from './BadgeUpgradeDialog';

// RUN-155: uppgraderingspopupen fick synas ca 0,7 s innan en osedd sidtour tog över. Här körs den RIKTIGA FeatureTour tillsammans med värden (nätverket och
// driver.js är ersatta; driver.js sätter driver-active på <body> när touren startar, som i appen), så glappet mellan "touren ska starta" och "touren körs" täcks.

const api = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn(), markSeen: vi.fn() }));
vi.mock('../api', () => ({ badgesApi: api }));
const onboarding = vi.hoisted(() => ({ seen: [] as string[] }));
vi.mock('@/features/onboarding/onboardingApi', () => ({
  fetchOnboardingStatus: async () => [...onboarding.seen],
  markOnboardingSeen: async () => {},
}));
vi.mock('@/features/changelog/changelogData', () => ({ changelog: { releases: [] } }));
const tour = vi.hoisted(() => ({ finish: null as null | (() => void) }));
vi.mock('driver.js', () => ({
  driver: (config: { onDestroyStarted: () => void }) => {
    tour.finish = () => config.onDestroyStarted();
    return {
      drive: () => { document.body.classList.add('driver-active'); },
      destroy: () => { document.body.classList.remove('driver-active'); },
    };
  },
}));

const [first] = BADGE_SERIES;
// Tourens fördröjning styrs av falska timers (se beforeEach): testet flyttar klockan själv och hänger inte på verklig tid under last.
const TOUR_DELAY_MS = 10_000;
const item = (series: string, tier: number, seen: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: seen });
const mine = (...items: BadgeUserItem[]): BadgeUserResponse => ({ items, showcase: [] });
const group = (): GroupBadges => ({
  members: [],
  holders: Object.fromEntries(BADGE_SERIES.map((series) => [series.key, { '1': 4, '2': 4, '3': 4, '4': 4, '5': 4, '6': 4 }])),
  member_count: 6,
});
const dialog = () => screen.queryByRole('dialog');
// Flyttar den falska klockan och släpper fram väntande löften (hämtningar, renderingar) några varv, så "popupen syns inte" prövas efter att en felaktig popup hunnit synas.
const advance = async (ms: number) => {
  await act(async () => { vi.advanceTimersByTime(ms); });
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};

function renderPage() {
  setViewportWidth(390);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity }, mutations: { retry: false } } });
  const auth: AuthContextType = { user: { id: ME.id, name: ME.name, email: 'joel@example.com' }, login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false };
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <BadgeUpgradeHost />
          <FeatureTour slug="tour_test_page" steps={[{ title: 'Page', description: 'A page tour' }]} delayMs={TOUR_DELAY_MS} />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // shouldAdvanceTime låter React Query och waitFor gå vidare i verklig takt; tourens fördröjning flyttas däremot bara med advance().
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
  for (const fn of Object.values(api)) fn.mockReset();
  api.getUserBadges.mockResolvedValue(mine(item(first.key, 1, 0)));
  api.getGroupBadges.mockResolvedValue(group());
  api.markSeen.mockResolvedValue({ seen: true });
  // Alla globala poster är sedda; sidtouren (tour_test_page) är det inte.
  onboarding.seen = ['onboarding_v1'];
  tour.finish = null;
  document.body.classList.remove('driver-active');
});
afterEach(() => { vi.useRealTimers(); });

describe('BadgeUpgradeHost: osedd sidtour (RUN-155)', () => {
  it('popupen syns aldrig medan sidtouren väntar på sin start eller körs, och visas när touren är klar', async () => {
    renderPage();

    // Före tourens start (fördröjningen): gruppen har hunnit hämtas, men popupen får inte glimta förbi.
    await waitFor(() => expect(api.getGroupBadges).toHaveBeenCalled());
    await advance(TOUR_DELAY_MS / 2);
    expect(document.body.classList.contains('driver-active')).toBe(false);
    expect(dialog()).toBeNull();

    // Touren körs.
    await advance(TOUR_DELAY_MS);
    expect(document.body.classList.contains('driver-active')).toBe(true);
    expect(dialog()).toBeNull();

    // Klar: popupen kommer, och avfärdandet markerar serien som sedd.
    act(() => { tour.finish?.(); });
    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
    expect(api.markSeen).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + DISMISS_GUARD_MS + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(api.markSeen).toHaveBeenCalledWith([first.key]));
  });

  it('en redan sedd sidtour blockerar inte: popupen visas direkt', async () => {
    onboarding.seen = ['onboarding_v1', 'tour_test_page'];
    renderPage();

    expect(await screen.findByRole('dialog', { name: first.name })).toBeInTheDocument();
  });
});
