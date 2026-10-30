import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@runquest/types';
import type { BadgeUserItem, BadgeUserResponse, HeadToHeadResponse } from '@runquest/shared';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import type { GroupBadges } from '@/features/badges/api';
import { BADGE_QUERY_KEYS } from '@/features/badges/hooks/useBadgeQueries';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { setViewportWidth } from '@/test/viewport';
import { RunnerCard } from './RunnerCard';
import { RunnerPopup } from './RunnerPopup';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Badge-anropen styrs per test; resten av kortet går mot fakeBackend som i RunnerPage.test.
const badgesApi = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));

// Runner card med andras badges (RUN-130, omarbetad i RUN-152, spec F11): minis i hjältekortet, den kompakta BADGES-panelen (44 px-emblem med popover) i
// .rq-runner__lower bredvid Head to head, och att kortet i övrigt (Challenge, head-to-head) aldrig berörs av badge-laddning eller badge-fel.

const MOBILE = 390;
const DESKTOP = 1280;
// Queries gör ett snabbt omförsök (~1 s) före felläget.
const SLOW = { timeout: 4000 };

const KARL: User = {
  ...ME, id: 'u-karl', name: 'Karl Persson', total_xp: 5539, total_km: 46.2, current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 2, runs: [], challenge_counts: {},
};
const PACK = [ME, KARL];
const H2H: HeadToHeadResponse = { opponent: { id: KARL.id, name: KARL.name, profile_picture: null }, record: { wins: 2, draws: 0, losses: 1, total: 3 }, history: [], active: null };

const [speedster, milestoner, nightOwl, streakKeeper] = BADGE_SERIES;
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z' });
const KARL_BADGES: BadgeUserResponse = {
  items: [item(speedster.key, 5), item(milestoner.key, 3), item(nightOwl.key, 2), item(streakKeeper.key, 4)],
  showcase: [speedster.key, milestoner.key, nightOwl.key],
};
function groupOf(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= 6; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}

const auth: AuthContextType = {
  user: { id: ME.id, name: ME.name, email: 'joel@example.com', is_admin: false }, login: async () => ({ success: true }), logout: () => {}, loading: false, isAdmin: false,
};

const loggedOut: AuthContextType = { ...auth, user: null };

function renderCard(width = MOBILE, authValue: AuthContextType = auth, surface: 'page' | 'popup' = 'page') {
  setViewportWidth(width);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter>
          {surface === 'page' ? <RunnerCard user={KARL} allUsers={PACK} onBack={() => {}} /> : <RunnerPopup id={KARL.id} runner={KARL} users={PACK} failure={null} failed={false} onClose={() => {}} />}
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const badgesPanel = () => screen.getByRole('region', { name: 'Badges' });
const heroName = () => screen.findByRole('heading', { level: 1, name: 'Karl Persson' });
const nameOf = (tier: number, series: { name: string }) => `${TIER_NAMES[tier - 1]} ${series.name}`;
const emblemButtons = (panel: HTMLElement) => within(within(panel).getByRole('list', { name: 'Earned badges' })).getAllByRole('button');

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({ success: true, data: H2H });
  badgesApi.getUserBadges.mockReset();
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getUserBadges.mockResolvedValue(KARL_BADGES);
  badgesApi.getGroupBadges.mockResolvedValue(groupOf({ [speedster.key]: 1, [milestoner.key]: 5, [nightOwl.key]: 6, [streakKeeper.key]: 2 }));
});

describe('minis i hjältekortet (T1)', () => {
  it('de tre visade efter namnet som ETT img-element med en samlad etikett, i löparens ordning', async () => {
    const { container } = renderCard();
    await heroName();

    const minis = await screen.findByRole('img', { name: `Badges: ${TIER_NAMES[4]} ${speedster.name}, ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[1]} ${nightOwl.name}` });
    expect(minis).toHaveClass('rq-badge-minis');
    expect(minis.querySelectorAll('.rq-badge--sm[aria-hidden="true"]')).toHaveLength(3);
    // Namnet och minisen delar rad, men rubriken förblir bara namnet.
    expect(minis.parentElement).toBe(screen.getByRole('heading', { level: 1 }).parentElement);
    expect(container.querySelectorAll('.rq-badge-minis')).toHaveLength(1);
  });

  it('inga minis utan showcase — ingen platshållare — men panelen listar ändå serierna', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ ...KARL_BADGES, showcase: [] });
    const { container } = renderCard();
    await heroName();

    expect(await within(badgesPanel()).findByRole('list', { name: 'Earned badges' })).toBeInTheDocument();
    expect(container.querySelector('.rq-badge-minis')).toBeNull();
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
    expect(screen.queryByText('On display')).toBeNull();
  });

  it('Challenge-knappen är oförändrad: samma länk, fortfarande en sekundärknapp, ingen fylld guldknapp', async () => {
    const { container } = renderCard();
    await screen.findByRole('img', { name: /^Badges:/ });

    const link = screen.getByRole('link', { name: 'Challenge' });
    expect(link).toHaveAttribute('href', '/duels?send=1&opponent=u-karl');
    expect(link).toHaveClass('rq-btn--secondary');
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
  });
});

describe('BADGES-panelen (T1)', () => {
  it('hämtar den andra löparens samling (hens id) och visar den som emblemknappar: visade först, sedan högst nivå', async () => {
    renderCard();
    const panel = badgesPanel();
    await within(panel).findByRole('list', { name: 'Earned badges' });

    expect(badgesApi.getUserBadges).toHaveBeenCalledWith('u-karl');
    expect(emblemButtons(panel).map((button) => button.getAttribute('aria-label')))
      .toEqual([nameOf(5, speedster), nameOf(3, milestoner), nameOf(2, nightOwl), nameOf(4, streakKeeper)]);
    expect(screen.getByText(`4 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
    // Kompakt: bara emblemen i panelen — ingen chip, ingen "On display", ingen held-by före ett tryck.
    expect(within(panel).queryByText('On display')).toBeNull();
    expect(within(panel).queryByText(/held by/i)).toBeNull();
  });

  it('popovern: nivån, "On display" för en visad serie och held-by följer gruppens holders — göms när alla har nivån (X = N)', async () => {
    renderCard();
    const panel = badgesPanel();
    await within(panel).findByRole('list', { name: 'Earned badges' });

    fireEvent.click(within(panel).getByRole('button', { name: nameOf(5, speedster) }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(TIER_NAMES[4])).toHaveClass('rq-chip');
    expect(within(dialog).getByText('On display')).toBeInTheDocument();
    expect(within(dialog).getByText('Held by 1 of 6 in your pack')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Streak Keeper är inte visad (3 visade är de tre första) och hålls av 2 av 6.
    fireEvent.click(within(panel).getByRole('button', { name: nameOf(4, streakKeeper) }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('On display')).toBeNull();
    expect(within(dialog).getByText('Held by 2 of 6 in your pack')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Night Owl: 6 av 6 — held-by göms på andras kort.
    fireEvent.click(within(panel).getByRole('button', { name: nameOf(2, nightOwl) }));
    expect(within(await screen.findByRole('dialog')).queryByText(/held by/i)).toBeNull();
  });

  it('group-queryn felar: held-by utelämnas utan platshållare, emblemen och minisen visas', async () => {
    badgesApi.getGroupBadges.mockRejectedValue(new Error('boom'));
    const { container } = renderCard();

    const panel = badgesPanel();
    await within(panel).findByRole('list', { name: 'Earned badges' });
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());
    expect(emblemButtons(panel)).toHaveLength(4);
    fireEvent.click(within(panel).getByRole('button', { name: nameOf(5, speedster) }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/held by/i)).toBeNull();
    expect(dialog.querySelector('.rq-badge-detail__held')).toBeNull();
    expect(screen.getByRole('img', { name: /^Badges:/ })).toBeInTheDocument();
    expect(container.querySelector('.rq-badge-panel__row')).toBeNull();
  });
});

describe('ordningen: .rq-runner__lower (T2)', () => {
  const regionOrder = (container: HTMLElement) =>
    [...container.querySelectorAll('section[aria-label]')].map((section) => section.getAttribute('aria-label'));

  it.each([['mobil 390', MOBILE], ['desktop 1280', DESKTOP]])('%s: hjälte · Frodo · stats | titles · badges · head to head, och panelen renderas en gång', async (_name, width) => {
    const { container } = renderCard(width);
    await within(await screen.findByRole('region', { name: 'Badges' })).findByRole('list', { name: 'Earned badges' });
    await screen.findByRole('region', { name: 'Head to head' });

    // EN DOM-ordning för båda bredderna (ingen isDesktop-gren för panelen): samma sekvens i båda.
    expect(regionOrder(container)).toEqual(['Runner', "Frodo's journey", 'Runner stats', 'Titles', 'Badges', 'Head to head']);
    expect(screen.getAllByRole('region', { name: 'Badges' })).toHaveLength(1);
    expect(container.querySelectorAll('.rq-badge-panel')).toHaveLength(1);

    const lower = container.querySelector('.rq-runner__lower') as HTMLElement;
    expect([...lower.children]).toEqual([badgesPanel(), screen.getByRole('region', { name: 'Head to head' })]);
    // Under statflikar | titlar-raden, och panelen bor inte längre i sidokolumnen.
    expect(container.querySelector('.rq-runner__split')?.nextElementSibling).toBe(lower);
    expect(container.querySelector('.rq-runner__side')?.contains(badgesPanel())).toBe(false);
    expect(container.querySelector('.rq-runner__side')?.contains(screen.getByRole('region', { name: 'Titles' }))).toBe(true);
  });

  it('popupen (desktop-dialogen): hjälte över flikarna, en panel i taget och Badges-panelen renderas en gång', async () => {
    renderCard(DESKTOP, auth, 'popup');
    // Dialogen portas till body, utanför renderingens container.
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('Head to head: 2–0–1 to you');

    // Overview är startfliken: hjälten (med head to head i bannern) och Overview-växlingen. Inget av de andra flikarnas innehåll ritas.
    expect(regionOrder(dialog)).toEqual(['Runner']);
    expect(within(dialog).getByRole('group', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Head to head' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Badges' })).toBeNull();
    expect(dialog.querySelector('.rq-runner__lower')).toBeNull();

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Badges' }));
    await within(await screen.findByRole('region', { name: 'Badges' })).findByRole('list', { name: 'Earned badges' });
    expect(regionOrder(dialog)).toEqual(['Runner', 'Badges']);
    expect(screen.getAllByRole('region', { name: 'Badges' })).toHaveLength(1);
    expect(dialog.querySelectorAll('.rq-badge-panel')).toHaveLength(1);
    expect(screen.queryByText('Runner profile')).toBeNull();
  });

  it('utan inloggad (ingen head to head) står panelen ensam i .rq-runner__lower', async () => {
    const { container } = renderCard(DESKTOP, loggedOut);
    await within(await screen.findByRole('region', { name: 'Badges' })).findByRole('list', { name: 'Earned badges' });

    const lower = container.querySelector('.rq-runner__lower') as HTMLElement;
    expect([...lower.children]).toEqual([badgesPanel()]);
    expect(screen.queryByRole('region', { name: 'Head to head' })).toBeNull();
  });
});

describe('robusthet (T4)', () => {
  it('badge-fel → felkort med Retry i panelen (inte "No badges yet."), inga minis, kortet i övrigt oförändrat; Retry hämtar om', async () => {
    badgesApi.getUserBadges.mockRejectedValue(new Error('boom'));
    const { container } = renderCard();

    const panel = badgesPanel();
    expect(await within(panel).findByText("Couldn't load badges", undefined, SLOW)).toBeInTheDocument();
    expect(within(panel).queryByText('No badges yet.')).toBeNull();
    expect(await heroName()).toBeInTheDocument();
    expect(screen.getByText(/in the group · 0 runs$/)).toBeInTheDocument();
    expect(container.querySelector('.rq-badge-minis')).toBeNull();
    expect(screen.getByRole('link', { name: 'Challenge' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "Frodo's journey" })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Head to head' })).toBeInTheDocument();

    badgesApi.getUserBadges.mockResolvedValue(KARL_BADGES);
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await within(badgesPanel()).findByRole('list', { name: 'Earned badges' }, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Badges:/ })).toBeInTheDocument();
    expect(within(badgesPanel()).queryByText("Couldn't load badges")).toBeNull();
  });

  it('en löpare utan badges: samma tomläge, inga minis', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
    const { container } = renderCard();

    expect(await within(badgesPanel()).findByText('No badges yet.')).toBeInTheDocument();
    expect(container.querySelector('.rq-badge-minis')).toBeNull();
  });

  it('badge-fel stör inte Challenge/head-to-head: båda badge-anropen felar, resten fungerar', async () => {
    badgesApi.getUserBadges.mockRejectedValue(new Error('boom'));
    badgesApi.getGroupBadges.mockRejectedValue(new Error('boom'));
    renderCard();

    const h2h = await screen.findByRole('region', { name: 'Head to head' });
    expect(await within(h2h).findByText('you won', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Challenge' })).toHaveAttribute('href', '/duels?send=1&opponent=u-karl');
    await within(badgesPanel()).findByText("Couldn't load badges", undefined, SLOW);
    // Bara badge-panelen har ett felkort; titlar och head-to-head är opåverkade.
    expect(screen.getAllByText(/couldn't load/i)).toHaveLength(1);
    expect(screen.queryByText('No badges yet.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Challenge' })).toBeInTheDocument();
  });

  it('laddar badges: panelen visar laddaren, Challenge och head-to-head finns direkt', async () => {
    badgesApi.getUserBadges.mockReturnValue(new Promise(() => {}));
    renderCard();

    expect(await within(badgesPanel()).findByRole('status')).toHaveTextContent('Loading badges');
    expect(screen.getByRole('link', { name: 'Challenge' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Head to head' })).toBeInTheDocument();
    expect(screen.queryByText('No badges yet.')).toBeNull();
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
  });

  it('query-nycklarna är badge-hookarnas egna (ingen ny nyckel som kan krocka med Runner/Duels)', async () => {
    const { queryClient } = renderCard();
    await within(badgesPanel()).findByRole('list', { name: 'Earned badges' });

    const badgeKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey).filter((key) => key[0] === 'badges');
    expect(badgeKeys).toEqual(expect.arrayContaining([[...BADGE_QUERY_KEYS.user('u-karl')], [...BADGE_QUERY_KEYS.group]]));
    expect(badgeKeys).toHaveLength(2);
  });
});

// Emblem-popovern inuti profil-popupen (RunnerPopup äger sin Radix-dialog). Popovern portas till body, utanför dialogens innehåll —
// den får varken räknas som ett klick utanför (stänger dialogen) eller ta Escape från dialogen.
describe('emblem-popovern i profil-popupen', () => {
  function renderInDialog() {
    setViewportWidth(DESKTOP);
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <MemoryRouter>
            <RunnerPopup id={KARL.id} runner={KARL} users={PACK} failure={null} failed={false} onClose={() => onOpenChange(false)} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    return { onOpenChange };
  }
  const runnerDialog = () => screen.getByRole('dialog', { name: `Runner card: ${KARL.name}` });
  const popover = () => screen.queryByRole('dialog', { name: speedster.name });
  // Badges bor på sin flik i popupen.
  const openBadgesTab = async () => {
    fireEvent.click(await screen.findByRole('tab', { name: 'Badges' }));
    return screen.findByRole('region', { name: 'Badges' });
  };

  it('emblemet öppnar popovern; ett klick inuti den stänger inte Runner card-dialogen', async () => {
    const { onOpenChange } = renderInDialog();
    const panel = await openBadgesTab();
    await within(panel).findByRole('list', { name: 'Earned badges' });

    fireEvent.click(within(panel).getByRole('button', { name: nameOf(5, speedster) }));
    const detail = await screen.findByRole('dialog', { name: speedster.name });
    expect(runnerDialog()).toBeInTheDocument();
    // Popovern ligger utanför dialogens innehåll (Radix-portal), inte inuti det.
    expect(runnerDialog().contains(detail)).toBe(false);

    fireEvent.pointerDown(within(detail).getByRole('heading', { name: speedster.name }));
    fireEvent.click(within(detail).getByRole('heading', { name: speedster.name }));
    expect(popover()).toBeInTheDocument();
    expect(runnerDialog()).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('Escape stänger bara popovern: Runner card-dialogen står kvar', async () => {
    const { onOpenChange } = renderInDialog();
    const panel = await openBadgesTab();
    await within(panel).findByRole('list', { name: 'Earned badges' });

    fireEvent.click(within(panel).getByRole('button', { name: nameOf(5, speedster) }));
    const detail = await screen.findByRole('dialog', { name: speedster.name });

    fireEvent.keyDown(detail, { key: 'Escape' });
    await waitFor(() => expect(popover()).toBeNull());
    expect(runnerDialog()).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
