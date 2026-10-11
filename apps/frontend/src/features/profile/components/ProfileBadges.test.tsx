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
const badgesApi = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn() }));
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
  badgesApi.saveShowcase.mockReset();
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
    // Den enda knappen i kortet är Edit (RUN-129); väljaren är stängd tills den trycks.
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Edit']);
    expect(screen.queryByRole('region', { name: 'ON DISPLAY' })).toBeNull();
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

// Väljaren (RUN-129, spec F3, Council 16-18): ingången är Edit/Edit display i ON DISPLAY-remsan; panelen är densamma på mobil och desktop men ritas på ETT ställe:
// mobil direkt ovanför BADGES-kortet (där Edit sitter), desktop överst i sidokolumnen (340 px, ovanför TITLES).
describe('Profile — väljaren för visade badges', () => {
  const picker = () => screen.getByRole('region', { name: 'ON DISPLAY' });
  const pickerOrNull = () => screen.queryByRole('region', { name: 'ON DISPLAY' });
  const toggleOf = (name: string) => within(picker()).getByRole('button', { name: new RegExp(`^${name}:`) });
  const openPicker = async (label: string) => {
    renderWithApp(<ProfileScreen />, { width: label === 'Edit' ? MOBILE : DESKTOP });
    await heroName();
    fireEvent.click(await screen.findByRole('button', { name: label }));
  };

  it('mobil: Edit öppnar väljaren direkt ovanför BADGES-kortet, fokus hamnar i väljaren och Close återför fokus till Edit', async () => {
    await openPicker('Edit');
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit).toHaveAttribute('aria-expanded', 'true');
    expect(picker()).toHaveFocus();
    expect(edit.getAttribute('aria-controls')).toBe(picker().id);
    expect((document.querySelector('.rq-profile-hero') as HTMLElement).nextElementSibling).toBe(picker());
    expect(picker().nextElementSibling).toBe(badgesCard());
    expect(document.querySelector('.rq-profile__side')?.contains(picker())).toBe(false);

    fireEvent.click(within(picker()).getByRole('button', { name: 'Close' }));
    expect(pickerOrNull()).toBeNull();
    expect(edit).toHaveFocus();
    expect(edit).toHaveAttribute('aria-expanded', 'false');
  });

  it('desktop: "Edit display" öppnar SAMMA väljare överst i sidokolumnen (före TITLES), Esc stänger och fokus går tillbaka', async () => {
    await openPicker('Edit display');
    const side = document.querySelector('.rq-profile__side') as HTMLElement;
    expect(side.firstElementChild).toBe(picker());
    expect(document.querySelector('.rq-profile__main')?.contains(picker())).toBe(false);
    expect(picker()).toHaveFocus();
    expect(within(picker()).getAllByRole('listitem').length).toBeGreaterThan(BADGE_SERIES.length);

    fireEvent.keyDown(toggleOf(milestoner.name), { key: 'Escape' });
    expect(pickerOrNull()).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit display' })).toHaveFocus();
  });

  it('Edit på en öppen väljare stänger den (växlare)', async () => {
    await openPicker('Edit');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(pickerOrNull()).toBeNull();
  });

  it('väljaren startar på det sparade valet i min ordning', async () => {
    await openPicker('Edit');
    const slots = within(within(picker()).getByRole('list', { name: 'Badges on display' })).getAllByRole('listitem');
    expect(slots.map((slot) => slot.querySelector('.rq-badge-slot__name')?.textContent)).toEqual([streakKeeper.name, milestoner.name, climber.name]);
  });

  it('inget valt: remsan visar uppmaningen + Edit (ingen platshållare), och väljaren öppnas med tre tomma platser', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ ...MY_BADGES, showcase: [] });
    await openPicker('Edit');
    expect(within(badgesCard()).getByText('Pick up to 3 badges to show on the Board.')).toBeInTheDocument();
    expect(within(picker()).getAllByText('Empty slot')).toHaveLength(3);
  });

  it('spara: PUT med vald ordning, och remsan, hjältekortet och Board-cachen följer med (gruppen invalideras)', async () => {
    let server: BadgeUserResponse = MY_BADGES;
    badgesApi.getUserBadges.mockImplementation(async () => server);
    badgesApi.saveShowcase.mockImplementation(async (series: string[]) => {
      server = { ...server, showcase: series };
      return { showcase: series };
    });
    await openPicker('Edit');
    const groupCalls = badgesApi.getGroupBadges.mock.calls.length;
    fireEvent.click(within(picker()).getByRole('button', { name: `Remove ${streakKeeper.name} from display` }));
    fireEvent.click(toggleOf(earthTrotter.name));
    fireEvent.click(within(picker()).getByRole('button', { name: 'SAVE DISPLAY' }));

    expect(await within(picker()).findByText('Saved — your Board card is updated.')).toBeInTheDocument();
    expect(badgesApi.saveShowcase).toHaveBeenCalledWith([milestoner.key, climber.key, earthTrotter.key]);
    const expected = `Badges: ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[0]} ${climber.name}, ${TIER_NAMES[1]} ${earthTrotter.name}`;
    // Hjältekortet och ON DISPLAY-remsan visar det nya valet.
    expect(within(document.querySelector('.rq-profile-hero') as HTMLElement).getByRole('img', { name: expected })).toBeInTheDocument();
    expect(within(badgesCard()).getByRole('img', { name: expected })).toBeInTheDocument();
    await waitFor(() => expect(badgesApi.getGroupBadges.mock.calls.length).toBeGreaterThan(groupCalls));
  });

  it('fel vid spara: röd alert, utkastet står kvar och remsan visar fortfarande det sparade valet', async () => {
    badgesApi.saveShowcase.mockRejectedValue(new Error('boom'));
    await openPicker('Edit');
    fireEvent.click(within(picker()).getByRole('button', { name: `Remove ${streakKeeper.name} from display` }));
    fireEvent.click(within(picker()).getByRole('button', { name: 'SAVE DISPLAY' }));
    expect(await within(picker()).findByRole('alert')).toHaveTextContent('Could not save. Your pick is still here — try again.');
    const slots = within(within(picker()).getByRole('list', { name: 'Badges on display' })).getAllByRole('listitem');
    expect(slots.map((slot) => slot.querySelector('.rq-badge-slot__name')?.textContent)).toEqual([milestoner.name, climber.name, undefined]);
    await waitFor(() => {
      expect(within(badgesCard()).getByRole('img', { name: `Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[0]} ${climber.name}` })).toBeInTheDocument();
    });
  });

  it('profilturens ankare finns kvar med väljaren öppen', async () => {
    await openPicker('Edit display');
    for (const step of TOUR_PROFILE_V2) if (step.element) expect(document.querySelector(step.element), step.element).not.toBeNull();
  });
});
