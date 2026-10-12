import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { User } from '@runquest/types';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '@/features/badges/api';
import { TOUR_PROFILE_V2 } from '@/features/onboarding/featureTourSteps';
import { paths } from '@/paths';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { ProfileScreen } from './ProfileScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Badge-anropen styrs per test; resten av profilen går mot fakeBackend som i ProfilePage.test.
const badgesApi = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Badge-sammanfattningen i profilen (RUN-151, spec v2 F10): placering (mobil efter MY TITLES, desktop efter statflikarna), hjältekortet utan minis på mobil, länken till /badges
// och att ett badgefel eller en lång laddning aldrig rör resten av profilen. Datahämtningen bor i ProfileScreen.

const MOBILE = 390;
const DESKTOP = 1280;
// Queries gör ett snabbt omförsök (~1 s) före felläget.
const SLOW = { timeout: 4000 };

const [milestoner, earthTrotter, climber, streakKeeper] = BADGE_SERIES;
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
const MY_BADGES: BadgeUserResponse = {
  items: [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER)],
  showcase: [streakKeeper.key, milestoner.key, climber.key],
};
function groupOf(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}

const mine: User = { ...ME, total_km: 942.7, current_streak: 4, longest_streak: 44, wins: 11, losses: 6, runs: [] };

const summary = () => screen.getByRole('region', { name: 'Badges' });
const heroName = () => screen.findByRole('heading', { level: 1, name: 'Joel Lindberg' });
const anchor = (name: string) => document.querySelector(`[data-tour="${name}"]`) as HTMLElement;
const heroMinis = () => document.querySelector('.rq-profile-hero')?.querySelector('[role="img"][aria-label^="Badges:"]') ?? null;
const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [mine, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  badgesApi.getUserBadges.mockReset();
  badgesApi.getGroupBadges.mockReset();
  badgesApi.saveShowcase.mockReset();
  badgesApi.getUserBadges.mockResolvedValue(MY_BADGES);
  badgesApi.getGroupBadges.mockResolvedValue(groupOf({ [milestoner.key]: 5, [streakKeeper.key]: 1 }));
});

describe('Profile — badge-sammanfattningen (F10)', () => {
  it('visar min samling kompakt: räknare, emblem i nivåordning, låsta-rad och ingen väljare', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const section = await screen.findByRole('region', { name: 'Badges' });
    expect(badgesApi.getUserBadges).toHaveBeenCalledWith(ME.id);

    expect(within(section).getByRole('heading', { name: `Badges · 4 of ${BADGE_SERIES.length} series` })).toBeInTheDocument();
    const earned = await within(section).findByRole('list', { name: 'Earned badges' });
    expect(within(earned).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      `${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}`,
      `${TIER_NAMES[2]} ${milestoner.name}`,
      `${TIER_NAMES[1]} ${earthTrotter.name}`,
      `${TIER_NAMES[0]} ${climber.name}`,
    ]);
    expect(within(section).getByText(`Locked · ${BADGE_SERIES.length - 4} left`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit/i })).toBeNull();
    expect(screen.queryByRole('region', { name: 'ON DISPLAY' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Badge series' })).toBeNull();
  });

  it('"All badges →" leder till /badges (mobil och desktop)', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const { unmount } = renderWithApp(<ProfileScreen />, { width });
      await heroName();
      await within(await screen.findByRole('region', { name: 'Badges' })).findByRole('list', { name: 'Earned badges' });
      fireEvent.click(within(summary()).getByRole('link', { name: 'All badges' }));
      expect(screen.getByTestId('location')).toHaveTextContent(paths.badges);
      unmount();
    }
  });

  it('ett tryck på ett emblem öppnar detaljerna (nivå och krav)', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const earned = await within(await screen.findByRole('region', { name: 'Badges' })).findByRole('list', { name: 'Earned badges' });
    const trigger = within(earned).getByRole('button', { name: `${TIER_NAMES[2]} ${milestoner.name}` });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: milestoner.name });
    expect(within(dialog).getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
  });
});

describe('Profile — placering (F10.1)', () => {
  it('mobil: hjälte · Frodo · statflikar · MY TITLES · BADGES · RUN HISTORY, utan kortyta', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    await screen.findByRole('list', { name: 'Earned badges' });
    const order = [anchor('profile-hero'), anchor('profile-journey'), anchor('profile-stats'), anchor('profile-titles'), summary(), anchor('profile-history')];
    for (let index = 1; index < order.length; index += 1) expect(follows(order[index - 1], order[index]), `${index}`).toBe(true);
    expect(summary().parentElement).toHaveClass('rq-profile__side');
    expect(summary().previousElementSibling).toBe(anchor('profile-titles'));
    expect(summary().nextElementSibling).toBe(anchor('profile-history'));
    expect(summary()).not.toHaveClass('rq-card');
  });

  it('desktop: sist i huvudkolumnen direkt efter statflikarna, i ett kort; MY TITLES och RUN HISTORY ligger kvar i sidokolumnen', async () => {
    renderWithApp(<ProfileScreen />, { width: DESKTOP });
    await heroName();
    await screen.findByRole('list', { name: 'Earned badges' });
    expect(summary().parentElement).toHaveClass('rq-profile__main');
    expect(summary().previousElementSibling).toBe(anchor('profile-stats'));
    expect(summary().nextElementSibling).toBeNull();
    expect(summary()).toHaveClass('rq-card');
    expect(anchor('profile-titles').parentElement).toHaveClass('rq-profile__side');
    expect(anchor('profile-history').parentElement).toHaveClass('rq-profile__side');
  });

  it('bara en sammanfattning åt gången (mobil och desktop)', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const { unmount } = renderWithApp(<ProfileScreen />, { width });
      await heroName();
      await screen.findByRole('list', { name: 'Earned badges' });
      expect(screen.getAllByRole('region', { name: 'Badges' })).toHaveLength(1);
      unmount();
    }
  });

  it('profilturens ankare finns kvar på mobil och desktop', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const { unmount } = renderWithApp(<ProfileScreen />, { width });
      await heroName();
      await screen.findByRole('list', { name: 'Earned badges' });
      for (const step of TOUR_PROFILE_V2) if (step.element) expect(document.querySelector(step.element), `${width} ${step.element}`).not.toBeNull();
      unmount();
    }
  });
});

describe('Profile — hjältekortets minis (F10.6, Q8)', () => {
  it('mobil: bara <h1> med namnet — inget minis-omslag, inga minis, ingen reservhöjd', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    const name = await heroName();
    await screen.findByRole('list', { name: 'Earned badges' });
    expect(heroMinis()).toBeNull();
    expect(document.querySelector('.rq-profile-hero .rq-badge-nameline')).toBeNull();
    expect(document.querySelector('.rq-profile-hero .rq-badge')).toBeNull();
    expect(name.parentElement).toHaveClass('rq-profile-hero__who');
  });

  it('desktop: namnet följt av tre sm-minis i användarens ordning', async () => {
    renderWithApp(<ProfileScreen />, { width: DESKTOP });
    const name = await heroName();
    const minis = await within(document.querySelector('.rq-profile-hero') as HTMLElement).findByRole('img', { name: /^Badges:/ });
    expect(name.nextElementSibling).toBe(minis);
    expect(name.parentElement).toHaveClass('rq-badge-nameline');
    expect(minis.querySelectorAll('.rq-badge--sm')).toHaveLength(3);
    expect(minis).toHaveAttribute('aria-label', `Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[0]} ${climber.name}`);
  });

  it('desktop utan valda badges: inga minis och ingen platshållare', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ ...MY_BADGES, showcase: [] });
    renderWithApp(<ProfileScreen />, { width: DESKTOP });
    await heroName();
    await screen.findByRole('list', { name: 'Earned badges' });
    expect(heroMinis()).toBeNull();
    expect(document.querySelector('.rq-profile-hero .rq-badge')).toBeNull();
  });
});

describe('Profile — badge-lägen (F10.5)', () => {
  it('skelett medan samlingen laddas — resten av profilen är redan där', async () => {
    badgesApi.getUserBadges.mockReturnValue(new Promise(() => {}));
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    expect(within(summary()).getByRole('status')).toHaveTextContent('Loading badges');
    expect(summary().querySelectorAll('.rq-badge-skel__shape--cp')).toHaveLength(5);
    expect(anchor('profile-journey')).not.toBeNull();
  });

  it('tomt läge: streckad ruta och alla åtta låsta', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    expect(await within(summary()).findByText('No badges yet. Log a run to start collecting.')).toBeInTheDocument();
    expect(within(summary()).getByText(`Locked · ${BADGE_SERIES.length} left`)).toBeInTheDocument();
    expect(summary().querySelectorAll('.rq-badge[data-tier="locked"]')).toHaveLength(BADGE_SERIES.length);
  });

  it('badge-fel lämnar resten av profilen orörd, Retry hämtar om', async () => {
    badgesApi.getUserBadges.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(MY_BADGES);
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    // Felkortet kommer efter ett snabbt omförsök.
    const alert = await screen.findByRole('heading', { name: "Couldn't load your badges" }, SLOW);
    const errorCard = alert.closest('[role="alert"]') as HTMLElement;
    expect(within(errorCard).getByText('Your runs are safe.')).toBeInTheDocument();
    expect(summary()).toContainElement(errorCard);
    // Resten av profilen: hjälte, Frodo, statflikar, titlar och historik står kvar.
    expect(screen.getByRole('heading', { level: 1, name: 'Joel Lindberg' })).toBeInTheDocument();
    for (const name of ['profile-hero', 'profile-journey', 'profile-stats', 'profile-titles', 'profile-history']) expect(anchor(name), name).not.toBeNull();
    expect(screen.queryByRole('heading', { name: "Couldn't load your profile" })).toBeNull();

    const calls = badgesApi.getUserBadges.mock.calls.length;
    fireEvent.click(within(errorCard).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Earned badges' })).toBeInTheDocument();
    expect(badgesApi.getUserBadges.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole('heading', { name: "Couldn't load your badges" })).toBeNull();
  });

  it('gruppens badges felar: sammanfattningen visas ändå, bara held-by utelämnas i popovern', async () => {
    badgesApi.getGroupBadges.mockRejectedValue(new Error('boom'));
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const earned = await screen.findByRole('list', { name: 'Earned badges' });
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());
    fireEvent.click(within(earned).getByRole('button', { name: `${TIER_NAMES[2]} ${milestoner.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/in your pack|Only you hold/)).toBeNull();
  });
});
