import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { User } from '@runquest/types';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES, requirementText } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '@/features/badges/api';
import { TOUR_PROFILE_V2 } from '@/features/onboarding/featureTourSteps';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { ProfileScreen } from './ProfileScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Badge-anropen styrs per test; resten av profilen går mot fakeBackend som i ProfilePage.test.
const badgesApi = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Samlingen i profilen (RUN-128, spec F2, F8): BADGES-kortet under hjältekortet, minis i hjältekortets namnrad, och att ett badgefel eller en lång laddning aldrig
// rör resten av profilen. Datahämtningen bor i ProfileScreen.

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

const badgesCard = () => screen.getByRole('region', { name: 'Badges' });
const heroName = () => screen.findByRole('heading', { level: 1, name: 'Joel Lindberg' });

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [mine, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  badgesApi.getUserBadges.mockReset();
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getUserBadges.mockResolvedValue(MY_BADGES);
  badgesApi.getGroupBadges.mockResolvedValue(groupOf({ [milestoner.key]: 5, [streakKeeper.key]: 1 }));
});

describe('Profile — BADGES-kortet', () => {
  it('visar min samling: åtta kort i serielistans ordning, räknare, held-by och ON DISPLAY i min ordning', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const card = await screen.findByRole('region', { name: 'Badges' });
    expect(badgesApi.getUserBadges).toHaveBeenCalledWith(ME.id);

    expect(await within(card).findByRole('list', { name: 'Badge series' })).toBeInTheDocument();
    const cards = within(card).getAllByRole('listitem');
    expect(cards.map((entry) => within(entry).getByRole('heading').textContent)).toEqual(BADGE_SERIES.map((series) => series.name));
    expect(within(card).getByText(`4 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
    expect(within(card).getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
    expect(within(card).getByText('Only you hold this in your pack')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: `Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[0]} ${climber.name}` })).toBeInTheDocument();
    // En låst serie visar kravet för tier 1.
    const locked = BADGE_SERIES[5];
    expect(within(card).getByText(`Unlock: ${TIER_NAMES[0]} — ${requirementText(locked, 1)}`)).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('kortet ligger direkt under hjältekortet (mobil och desktop), före Frodo-kortet', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const { unmount } = renderWithApp(<ProfileScreen />, { width });
      await heroName();
      await screen.findByRole('list', { name: 'Badge series' });
      const hero = document.querySelector('.rq-profile-hero') as HTMLElement;
      expect(hero.nextElementSibling).toBe(badgesCard());
      expect(badgesCard().nextElementSibling).toBe(document.querySelector('[data-tour="profile-journey"]'));
      unmount();
    }
  });

  it('desktop: namnen på de valda i remsan', async () => {
    renderWithApp(<ProfileScreen />, { width: DESKTOP });
    await heroName();
    expect(await screen.findByText(`${streakKeeper.name} · ${milestoner.name} · ${climber.name}`)).toBeInTheDocument();
  });

  it('hjältekortet: namnet som rubrik följt av tre sm-minis (BadgeMinis), inga minis medan inget är valt', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    const name = await heroName();
    const minis = await within(document.querySelector('.rq-profile-hero') as HTMLElement).findByRole('img', { name: /^Badges:/ });
    expect(name.nextElementSibling).toBe(minis);
    expect(minis.querySelectorAll('.rq-badge--sm')).toHaveLength(3);
    expect(minis).toHaveAttribute('aria-label', `Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[0]} ${climber.name}`);
  });

  it('inga valda badges: ingen mini-grupp i hjältekortet och ingen platshållare', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ ...MY_BADGES, showcase: [] });
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    await screen.findByRole('list', { name: 'Badge series' });
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
    expect(document.querySelector('.rq-profile-hero .rq-badge')).toBeNull();
  });

  it('profilturens ankare finns kvar (inga ankare flyttade eller borta)', async () => {
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    await screen.findByRole('list', { name: 'Badge series' });
    for (const step of TOUR_PROFILE_V2) if (step.element) expect(document.querySelector(step.element), step.element).not.toBeNull();
  });
});

describe('Profile — badge-lägen (F8)', () => {
  it('skeleton medan samlingen laddas — resten av profilen är redan där', async () => {
    badgesApi.getUserBadges.mockReturnValue(new Promise(() => {}));
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const card = badgesCard();
    expect(within(card).getByRole('status')).toHaveTextContent('Loading badges');
    expect(card.querySelectorAll('.rq-badge-skel')).toHaveLength(3);
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
    expect(document.querySelector('[data-tour="profile-journey"]')).not.toBeNull();
  });

  it('tomt läge utan badges: "No badges yet", uppmaningen och åtta låsta minis', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const card = badgesCard();
    expect(await within(card).findByRole('heading', { name: /^no badges yet$/i })).toBeInTheDocument();
    expect(within(card).getByText('Log a run to start collecting.')).toBeInTheDocument();
    expect(card.querySelectorAll('.rq-badge[data-tier="locked"]')).toHaveLength(BADGE_SERIES.length);
    expect(within(card).queryByRole('list', { name: 'Badge series' })).toBeNull();
  });

  it('badge-fel lämnar resten av profilen orörd, Retry hämtar om', async () => {
    badgesApi.getUserBadges.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(MY_BADGES);
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    // Felkortet kommer efter ett snabbt omförsök.
    const alert = await screen.findByRole('heading', { name: "Couldn't load your badges" }, SLOW);
    const errorCard = alert.closest('section') as HTMLElement;
    expect(within(errorCard).getByText('Your runs are safe.')).toBeInTheDocument();
    // Resten av profilen: hjälte, Frodo, statflikar, titlar och historik står kvar — och ingen mini-grupp.
    expect(screen.getByRole('heading', { level: 1, name: 'Joel Lindberg' })).toBeInTheDocument();
    for (const anchor of ['profile-hero', 'profile-journey', 'profile-stats', 'profile-titles', 'profile-history']) {
      expect(document.querySelector(`[data-tour="${anchor}"]`), anchor).not.toBeNull();
    }
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: "Couldn't load your profile" })).toBeNull();

    const calls = badgesApi.getUserBadges.mock.calls.length;
    fireEvent.click(within(errorCard).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Badge series' })).toBeInTheDocument();
    expect(badgesApi.getUserBadges.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole('heading', { name: "Couldn't load your badges" })).toBeNull();
  });

  it('gruppens badges felar: samlingen visas ändå, bara held-by utelämnas', async () => {
    badgesApi.getGroupBadges.mockRejectedValue(new Error('boom'));
    renderWithApp(<ProfileScreen />, { width: MOBILE });
    await heroName();
    const list = await screen.findByRole('list', { name: 'Badge series' });
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());
    expect(within(list).queryByText(/Held by|Only you hold/)).toBeNull();
    expect(within(list).getByText(requirementText(milestoner, 3))).toBeInTheDocument();
  });
});
