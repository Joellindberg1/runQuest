import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER, TIER_NAMES, requirementText } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import { renderWithApp } from '@/test/renderApp';
import { useAuth } from '@/providers/authContext';
import { useGroupBadges, useUserBadges } from '../hooks/useBadgeQueries';
import type { GroupBadges } from '../api';
import { BadgesScreen } from './BadgesScreen';

// /badges (RUN-150, spec F9, F9.8, F9.12): sidhuvud, ON DISPLAY-remsan, rutnätet med liggande kort och sparflödet i alla lägen. Badge-anropen styrs per test;
// serienamn och texter räknas ur shared.

const api = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn() }));
vi.mock('../api', () => ({ badgesApi: api }));

const MOBILE = 390;
const DESKTOP = 1440;
// Queries gör ett snabbt omförsök (~1 s) före felläget.
const SLOW = { timeout: 4000 };
const LIMIT_TEXT = `${MAX_SHOWCASE} of ${MAX_SHOWCASE} on display — remove one first.`;

const [milestoner, earthTrotter, climber, streakKeeper, earlyBird, nightOwl, speedster, precisionist] = BADGE_SERIES;
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
const OWNED = [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER), item(earlyBird.key, 4)];
const MINE = (showcase: string[]): BadgeUserResponse => ({ items: OWNED, showcase });

function groupOf(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}
// Även låsta serier har tal i rutnätet: de får ändå aldrig visas (Council 1).
const GROUP = groupOf({ [milestoner.key]: 5, [earthTrotter.key]: 6, [climber.key]: 4, [streakKeeper.key]: 1, [earlyBird.key]: 3, [nightOwl.key]: 2 });

function renderScreen(width = MOBILE) {
  return renderWithApp(<BadgesScreen />, { entry: '/badges', width });
}
const grid = () => screen.findByRole('list', { name: 'Badge series' });
const cardOf = (series: { name: string }) => {
  const heading = screen.getByRole('heading', { level: 3, name: series.name });
  return heading.closest('li') as HTMLElement;
};
const toggleOf = (series: { name: string }) => screen.getByRole('button', { name: new RegExp(`^${series.name}:`) });
const saveButton = () => screen.getByRole('button', { name: /^(SAVE DISPLAY|SAVING…|SAVED)$/ });
const stripMinis = () => within(screen.getByRole('group', { name: 'On display' })).queryByRole('img');

beforeEach(() => {
  api.getUserBadges.mockReset();
  api.getGroupBadges.mockReset();
  api.saveShowcase.mockReset();
  api.getUserBadges.mockResolvedValue(MINE([streakKeeper.key]));
  api.getGroupBadges.mockResolvedValue(GROUP);
  api.saveShowcase.mockImplementation(async (series: string[]) => ({ showcase: series }));
});

describe('BadgesScreen — sidhuvud (F9.2)', () => {
  it('mobil: h1, räknaren "N of 8 series unlocked" under rubriken och en tillbaka-länk med glyf + etikett till /profile', async () => {
    renderScreen(MOBILE);
    await grid();
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toHaveClass('rq-badges__title');
    expect(screen.getByText(`${OWNED.length} of ${BADGE_SERIES.length} series unlocked`)).toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'Back to profile' });
    expect(back).toHaveAttribute('href', '/profile');
    expect(back.querySelector('[aria-hidden="true"]')).toHaveTextContent('‹');
    // Mobilen har inte desktopens ingress.
    expect(screen.queryByText(/Anyone can hold a badge/)).toBeNull();
  });

  it('tillbaka-länken navigerar till /profile', async () => {
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(screen.getByRole('link', { name: 'Back to profile' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/profile'));
  });

  it('desktop: ingen tillbaka-länk, ingressen och räknaren i sidhuvudet', async () => {
    renderScreen(DESKTOP);
    await grid();
    expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
    expect(screen.getByText('Eight series, six tiers. Anyone can hold a badge — you see your best tier per series.')).toBeInTheDocument();
    expect(screen.getByText(`${OWNED.length} of ${BADGE_SERIES.length} series unlocked`)).toHaveClass('rq-badges__count--aside');
  });

  it('"Eight"/"six" i den RENDERADE ingressen motsvarar BADGE_SERIES.length och MAX_TIER (så copyn inte driftar)', async () => {
    // Oberoende ordlista: ett antal utan ord här fäller testet och kräver ett medvetet copy-beslut.
    const WORDS: Record<number, string> = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
    renderScreen(DESKTOP);
    await grid();
    const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    const lead = document.querySelector('.rq-badges__lead') as HTMLElement;
    expect(lead.textContent).toMatch(new RegExp(`^${capitalised(WORDS[BADGE_SERIES.length])} series, ${WORDS[MAX_TIER]} tiers\\. `));
  });

  it('en sida med ett enda h1, en h2 före rutnätet och ett h3 per serie: hierarkin h1 → h2 → h3 (ingen nivå hoppas över)', async () => {
    renderScreen(DESKTOP);
    const list = await grid();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h2 = screen.getByRole('heading', { level: 2, name: 'Your badges' });
    expect(h2).toHaveClass('sr-only');
    expect(h2.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(BADGE_SERIES.length);
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)));
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it('tomläget: h1 → h2 ("No badges yet") → h3 utan extra "Your badges"', async () => {
    api.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
    renderScreen(DESKTOP);
    await screen.findByRole('heading', { level: 2, name: 'No badges yet' });
    expect(screen.queryByRole('heading', { name: 'Your badges' })).toBeNull();
  });
});

describe('BadgesScreen — rutnätet (F9.4, F9.5)', () => {
  it('en <ul aria-label="Badge series"> med åtta liggande kort i BADGE_SERIES-ordning, låsta också', async () => {
    renderScreen(DESKTOP);
    const list = await grid();
    expect(list).toHaveClass('rq-badge-page-grid');
    const cards = within(list).getAllByRole('listitem');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual(BADGE_SERIES.map((series) => series.name));
    for (const card of cards) expect(card).toHaveClass('rq-badge-card--landscape');
    expect(cardOf(nightOwl)).toHaveAttribute('data-state', 'locked');
  });

  it('held-by "in your pack" på intjänade kort — och ingen global siffra någonstans (T3)', async () => {
    renderScreen(MOBILE);
    await grid();
    expect(within(cardOf(milestoner)).getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
    expect(within(cardOf(streakKeeper)).getByText('Only you hold this in your pack')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/globally|has it|%|in pack\b/i);
  });

  it('låst kort: ingen held-by, flavor eller Next även när gruppen har tal för serien (F9.12)', async () => {
    renderScreen(MOBILE);
    await grid();
    const locked = cardOf(nightOwl);
    expect(locked).toHaveAttribute('data-state', 'locked');
    expect(within(locked).queryByText(/Held by|Only you hold/)).toBeNull();
    expect(locked.querySelector('.rq-badge-card__flavor, .rq-badge-card__held')).toBeNull();
    expect(within(locked).getByText(`Unlock: ${TIER_NAMES[0]} — ${requirementText(nightOwl, 1)}`)).toBeInTheDocument();
    expect(within(locked).queryByText(/^Next:/)).toBeNull();
  });

  it('intjänat kort: kravraden börjar inte med ett nivånamn och flavor står i en egen <p> (F9.12)', async () => {
    renderScreen(MOBILE);
    await grid();
    const card = cardOf(milestoner);
    const req = within(card).getByText(requirementText(milestoner, 3));
    expect(req.textContent?.startsWith(TIER_NAMES[2])).toBe(false);
    const flavor = card.querySelector('.rq-badge-card__flavor') as HTMLElement;
    expect(flavor.tagName).toBe('P');
    expect(flavor).not.toBe(req);
  });

  it('gruppen felar: held-by utelämnas på alla kort, allt annat är oförändrat (F9.8)', async () => {
    api.getGroupBadges.mockRejectedValue(new Error('group down'));
    renderScreen(MOBILE);
    await grid();
    await waitFor(() => expect(api.getGroupBadges).toHaveBeenCalled());
    // Gruppfelet kommer efter ett omförsök (~1 s): vänta tills det är avgjort, utan att kortens övriga innehåll försvinner.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.queryByText(/Held by|Only you hold/)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(BADGE_SERIES.length);
    expect(within(cardOf(milestoner)).getByText(requirementText(milestoner, 3))).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'On display' })).toBeInTheDocument();
  });
});

describe('BadgesScreen — växlarna och utkastet (F9.6, F9.7)', () => {
  it('utkastet startar på det sparade valet: remsans minis och kortens knappar följer sparad ordning', async () => {
    api.getUserBadges.mockResolvedValue(MINE([streakKeeper.key, milestoner.key]));
    renderScreen(MOBILE);
    await grid();
    expect(stripMinis()).toHaveAccessibleName(`Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[2]} ${milestoner.name}`);
    expect(toggleOf(streakKeeper)).toHaveTextContent('On display — 1');
    expect(toggleOf(milestoner)).toHaveTextContent('On display — 2');
    expect(toggleOf(climber)).toHaveTextContent('Show');
    expect(cardOf(streakKeeper)).toHaveAttribute('data-display', 'true');
    expect(cardOf(climber)).not.toHaveAttribute('data-display');
  });

  it('ett klick på Show lägger serien sist i utkastet (platsnummer, remsan, aria-pressed) och SAVE DISPLAY blir tryckbar', async () => {
    renderScreen(MOBILE);
    await grid();
    expect(saveButton()).toHaveTextContent('SAVED');
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggleOf(climber));
    expect(toggleOf(climber)).toHaveAttribute('aria-pressed', 'true');
    expect(toggleOf(climber)).toHaveTextContent('On display — 2');
    expect(stripMinis()).toHaveAccessibleName(`Badges: ${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}, ${TIER_NAMES[0]} ${climber.name}`);
    expect(saveButton()).toHaveTextContent('SAVE DISPLAY');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');
  });

  it('växlaren behåller fokus vid växling (elementet avmonteras inte)', async () => {
    renderScreen(MOBILE);
    await grid();
    toggleOf(climber).focus();
    const before = toggleOf(climber);
    fireEvent.click(toggleOf(climber));
    expect(toggleOf(climber)).toBe(before);
    expect(before).toHaveFocus();
    fireEvent.click(toggleOf(climber));
    expect(toggleOf(climber)).toHaveFocus();
  });

  it('ingen omsortering: borttagen och tillagd igen hamnar sist; platsnumren följer ordningen', async () => {
    api.getUserBadges.mockResolvedValue(MINE([streakKeeper.key, milestoner.key]));
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(toggleOf(streakKeeper));
    fireEvent.click(toggleOf(streakKeeper));
    expect(toggleOf(milestoner)).toHaveTextContent('On display — 1');
    expect(toggleOf(streakKeeper)).toHaveTextContent('On display — 2');
  });

  it('ändringar läses upp i en aria-live-region', async () => {
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(toggleOf(climber));
    expect(screen.getByText(`${climber.name} added to display, position 2.`).closest('[aria-live="polite"]')).not.toBeNull();
    fireEvent.click(toggleOf(climber));
    expect(screen.getByText(`${climber.name} removed from display.`)).toBeInTheDocument();
  });

  describe('3 av 3 (L3, Council 17)', () => {
    beforeEach(() => {
      api.getUserBadges.mockResolvedValue(MINE([streakKeeper.key, earlyBird.key, milestoner.key]));
    });

    it('den synliga meningen finns, övriga växlare är aria-disabled med aria-describedby mot den, valda är användbara', async () => {
      renderScreen(MOBILE);
      await grid();
      const sentence = screen.getByText(LIMIT_TEXT);
      expect(sentence).toBeVisible();
      for (const series of [earthTrotter, climber]) {
        expect(toggleOf(series)).toHaveAttribute('aria-disabled', 'true');
        expect(toggleOf(series)).toHaveAttribute('aria-describedby', sentence.id);
        expect(toggleOf(series)).toHaveTextContent('Show');
      }
      expect(toggleOf(streakKeeper)).not.toHaveAttribute('aria-disabled');
    });

    it('ett klick på en spärrad växlare lägger inte till något; kortet saknar dimning', async () => {
      renderScreen(MOBILE);
      await grid();
      fireEvent.click(toggleOf(climber));
      expect(toggleOf(climber)).toHaveAttribute('aria-pressed', 'false');
      expect(stripMinis()).toHaveAccessibleName(expect.not.stringContaining(climber.name));
      const card = cardOf(climber);
      expect(card.getAttribute('style')).toBeNull();
      expect(card).not.toHaveAttribute('aria-disabled');
    });

    it('meningen försvinner och växlarna öppnas igen när en plats frigörs', async () => {
      renderScreen(MOBILE);
      await grid();
      fireEvent.click(toggleOf(earlyBird));
      expect(screen.queryByText(LIMIT_TEXT)).toBeNull();
      expect(toggleOf(climber)).not.toHaveAttribute('aria-disabled');
    });

    it('snabba klick på flera serier: aldrig fler än tre valda', async () => {
      api.getUserBadges.mockResolvedValue(MINE([]));
      renderScreen(MOBILE);
      await grid();
      for (const series of [earthTrotter, climber, streakKeeper, earlyBird, milestoner]) fireEvent.click(toggleOf(series));
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(MAX_SHOWCASE);
    });
  });

  it('en spärrad växlare i läget Låst: låsta kort har ingen knapp, bara en aria-hidden "Locked"-ruta', async () => {
    renderScreen(MOBILE);
    await grid();
    for (const series of [nightOwl, speedster, precisionist]) {
      const card = cardOf(series);
      expect(within(card).queryByRole('button')).toBeNull();
      expect(card.querySelector('.rq-badge-toggle--locked')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('BadgesScreen — spara (F9.3, F9.8)', () => {
  it('sparar i vald ordning (PUT), visar SAVED + den gröna bekräftelsen i role="status" och utkastet följer det sparade', async () => {
    // Servern minns valet: omhämtningen efter sparandet (invalideringen) ger det nya.
    let server = MINE([streakKeeper.key]);
    api.getUserBadges.mockImplementation(async () => server);
    api.saveShowcase.mockImplementation(async (series: string[]) => {
      server = { ...server, showcase: series };
      return { showcase: series };
    });
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(toggleOf(milestoner));
    fireEvent.click(toggleOf(earlyBird));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Saved — your Board card is updated.')).toBeInTheDocument();
    expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    expect(api.saveShowcase).toHaveBeenCalledWith([streakKeeper.key, milestoner.key, earlyBird.key]);
    expect(screen.getByRole('status')).toHaveTextContent('Saved — your Board card is updated.');
    expect(saveButton()).toHaveTextContent('SAVED');
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(toggleOf(earlyBird)).toHaveTextContent('On display — 3');
  });

  it('bekräftelsen försvinner när utkastet ändras igen', async () => {
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(toggleOf(climber));
    fireEvent.click(saveButton());
    await screen.findByText('Saved — your Board card is updated.');
    fireEvent.click(toggleOf(earlyBird));
    expect(screen.queryByText('Saved — your Board card is updated.')).toBeNull();
  });

  it('"SAVING…" och aria-disabled medan anropet pågår; alla icke-valda växlare är aria-disabled och klick ignoreras', async () => {
    let finish: (value: { showcase: string[] }) => void = () => {};
    api.saveShowcase.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(toggleOf(climber));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton()).toHaveTextContent('SAVING…'));
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(toggleOf(earlyBird)).toHaveAttribute('aria-disabled', 'true');
    expect(toggleOf(climber)).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggleOf(earlyBird));
    fireEvent.click(toggleOf(climber));
    expect(toggleOf(earlyBird)).toHaveAttribute('aria-pressed', 'false');
    expect(toggleOf(climber)).toHaveAttribute('aria-pressed', 'true');
    finish({ showcase: [streakKeeper.key, climber.key] });
    expect(await screen.findByText('Saved — your Board card is updated.')).toBeInTheDocument();
  });

  it('fel: role="alert", utkastet kvar, etiketten SAVE DISPLAY; RETRY flyttar fokus till SAVE DISPLAY innan felraden försvinner och sparar om', async () => {
    api.saveShowcase.mockRejectedValueOnce(new Error('boom'));
    renderScreen(MOBILE);
    await grid();
    fireEvent.click(toggleOf(climber));
    saveButton().focus();
    fireEvent.click(saveButton());
    const alert = (await screen.findByText('Could not save. Your pick is still here — try again.')).closest('[role="alert"]') as HTMLElement;
    expect(alert.querySelector('[data-status="error"]')).not.toBeNull();
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(toggleOf(climber)).toHaveTextContent('On display — 2');
    expect(saveButton()).toHaveTextContent('SAVE DISPLAY');
    expect(saveButton()).not.toHaveAttribute('aria-disabled');

    const retry = within(alert).getByRole('button', { name: 'RETRY' });
    retry.focus();
    fireEvent.click(retry);
    await screen.findByText('Saved — your Board card is updated.');
    expect(alert).toBeEmptyDOMElement();
    expect(document.body).not.toHaveFocus();
    expect(saveButton()).toHaveFocus();
    expect(api.saveShowcase).toHaveBeenCalledTimes(2);
    expect(api.saveShowcase).toHaveBeenLastCalledWith([streakKeeper.key, climber.key]);
  });

  it('SAVE DISPLAY är sidans enda guldknapp: en .rq-btn--secondary och ingen fylld primärknapp', async () => {
    renderScreen(MOBILE);
    await grid();
    expect(document.querySelectorAll('.rq-btn--secondary')).toHaveLength(1);
    expect(document.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
  });

  it('inget auto-fokus vid sidladdning', async () => {
    renderScreen(MOBILE);
    await grid();
    expect(document.body).toHaveFocus();
  });
});

describe('BadgesScreen — tillstånd (F9.8)', () => {
  it('laddar: tre skelettkort i en statusregion, ingen remsa, ingen räknare, rubriken står kvar', () => {
    api.getUserBadges.mockReturnValue(new Promise(() => {}));
    const { container } = renderScreen(MOBILE);
    expect(screen.getByRole('status')).toHaveTextContent('Loading badges');
    expect(container.querySelectorAll('.rq-badge-skel')).toHaveLength(3);
    expect(container.querySelector('.rq-badge-page-grid')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'On display' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Badge series' })).toBeNull();
    expect(screen.queryByText(/series unlocked/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();
  });

  it('fel vid hämtning: ErrorState med Retry (refetch) i stället för remsa + rutnät; sidhuvudet kvar utan räknare', async () => {
    api.getUserBadges.mockRejectedValue(new Error('down'));
    renderScreen(MOBILE);
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByRole('heading', { name: "Couldn't load your badges" })).toBeInTheDocument();
    expect(within(alert).getByText('Your runs are safe.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Badge series' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'On display' })).toBeNull();
    expect(screen.queryByText(/series unlocked/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Badges' })).toBeInTheDocument();

    api.getUserBadges.mockResolvedValue(MINE([streakKeeper.key]));
    const calls = api.getUserBadges.mock.calls.length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Badge series' })).toBeInTheDocument();
    expect(api.getUserBadges.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByRole('group', { name: 'On display' })).toBeInTheDocument();
  });

  it('tomt: den streckade rutan "No badges yet" i stället för remsan, åtta låsta kort, ingen SAVE DISPLAY, räknaren 0', async () => {
    api.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
    renderScreen(MOBILE);
    expect(await screen.findByRole('heading', { name: 'No badges yet' })).toBeInTheDocument();
    expect(screen.getByText('Log a run to start collecting.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'On display' })).toBeNull();
    expect(screen.queryByRole('button', { name: /SAVE DISPLAY|SAVED|SAVING/ })).toBeNull();
    const cards = within(await grid()).getAllByRole('listitem');
    expect(cards).toHaveLength(BADGE_SERIES.length);
    for (const card of cards) {
      expect(card).toHaveAttribute('data-state', 'locked');
      expect(within(card).queryByRole('button')).toBeNull();
    }
    expect(screen.getByText(`0 of ${BADGE_SERIES.length} series unlocked`)).toBeInTheDocument();
    // Ingen platshållare med minis i rutan.
    expect(document.querySelector('.rq-badge-empty .rq-badge')).toBeNull();
  });
});

describe('BadgesScreen — väljaren är borta', () => {
  it('inga spår av den gamla väljaren: ingen ON DISPLAY-panel, inga Empty slot, Close eller Edit', async () => {
    renderScreen(DESKTOP);
    await grid();
    expect(screen.queryByRole('region', { name: 'ON DISPLAY' })).toBeNull();
    expect(screen.queryByText(/Empty slot|Preview on leaderboard/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Close|Edit)/ })).toBeNull();
    expect(document.querySelector('.rq-badge-pick, .rq-badge-slots, .rq-badge-slot')).toBeNull();
  });
});

// Sparflödet på skärmnivå (kritikerns lucka): sidan + hookarna + en SEPARAT konsument av samma queries, med en server som minns valet. Ersätter profiltestet
// "spara … hjältekortet och Board-cachen följer med" från den gamla väljaren.
describe('BadgesScreen — spara på skärmnivå (cache, förlorat svar, dubbelklick)', () => {
  /** Motsvarar Board-minis och profilens hjältekort: läser samma user- och group-queries som sidan och visar det sparade valet. */
  function Consumer() {
    const { user } = useAuth();
    const mine = useUserBadges(user?.id);
    const group = useGroupBadges(!!user);
    return <p data-testid="consumer">{mine.data ? mine.data.showcase.join(',') : 'none'}|{group.data ? 'group' : 'nogroup'}</p>;
  }
  const renderWithConsumer = () => renderWithApp(<><BadgesScreen /><Consumer /></>, { entry: '/badges', width: MOBILE });
  const consumer = () => screen.getByTestId('consumer');

  /** En server som minns valet: omhämtningen efter en spara ger det nya. */
  function rememberingServer(initial: string[]) {
    const server = { showcase: initial };
    api.getUserBadges.mockImplementation(async () => ({ items: OWNED, showcase: server.showcase }));
    return server;
  }

  it('(a) spara: den separata konsumenten visar det nya valet, och användar- och gruppqueryn hämtas om', async () => {
    const server = rememberingServer([streakKeeper.key]);
    api.saveShowcase.mockImplementation(async (series: string[]) => {
      server.showcase = series;
      return { showcase: series };
    });
    renderWithConsumer();
    await grid();
    await waitFor(() => expect(consumer()).toHaveTextContent(`${streakKeeper.key}|group`));
    const userCalls = api.getUserBadges.mock.calls.length;
    const groupCalls = api.getGroupBadges.mock.calls.length;

    fireEvent.click(toggleOf(climber));
    fireEvent.click(saveButton());
    await screen.findByText('Saved — your Board card is updated.');
    expect(api.saveShowcase).toHaveBeenCalledWith([streakKeeper.key, climber.key]);
    await waitFor(() => expect(consumer()).toHaveTextContent(`${streakKeeper.key},${climber.key}|group`));
    await waitFor(() => expect(api.getUserBadges.mock.calls.length).toBeGreaterThan(userCalls));
    await waitFor(() => expect(api.getGroupBadges.mock.calls.length).toBeGreaterThan(groupCalls));
    expect(saveButton()).toHaveTextContent('SAVED');
  });

  it('(b) förlorat svar: PUT gick igenom men klienten får fel — felet rensas efter omhämtningen och inget andra PUT går iväg', async () => {
    const server = rememberingServer([streakKeeper.key]);
    api.saveShowcase.mockImplementation(async (series: string[]) => {
      server.showcase = series;
      throw new Error('response lost');
    });
    renderWithConsumer();
    await grid();
    fireEvent.click(toggleOf(climber));
    fireEvent.click(saveButton());

    // Omhämtningen ger sparat = utkast: felet har inget att göra och rensas (ingen påhittad bekräftelse), knappen säger SAVED.
    await waitFor(() => expect(saveButton()).toHaveTextContent('SAVED'));
    expect(screen.queryByText('Could not save. Your pick is still here — try again.')).toBeNull();
    expect(screen.queryByText('Saved — your Board card is updated.')).toBeNull();
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(toggleOf(climber)).toHaveTextContent('On display — 2');
    await waitFor(() => expect(consumer()).toHaveTextContent(`${streakKeeper.key},${climber.key}|group`));
    expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    // Inget andra PUT även sedan det en stund har gått och SAVE trycks igen på ett rent utkast.
    fireEvent.click(saveButton());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.saveShowcase).toHaveBeenCalledTimes(1);
  });

  describe('dubbelklick', () => {
    it('(c) två klick på SAVE i samma tick ger exakt ett PUT', async () => {
      rememberingServer([streakKeeper.key]);
      renderWithConsumer();
      await grid();
      fireEvent.click(toggleOf(climber));
      const save = saveButton();
      // Båda klicken i en och samma act: ingen omrendering emellan, så bara hookens spärr (inte knappens aria-disabled) kan stoppa det andra.
      act(() => {
        save.click();
        save.click();
      });
      await screen.findByText('Saved — your Board card is updated.');
      expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    });

    it('(c) klick på SAVING… medan anropet pågår ger inget nytt PUT', async () => {
      let finish: (value: { showcase: string[] }) => void = () => {};
      api.saveShowcase.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      rememberingServer([streakKeeper.key]);
      renderWithConsumer();
      await grid();
      fireEvent.click(toggleOf(climber));
      fireEvent.click(saveButton());
      await waitFor(() => expect(saveButton()).toHaveTextContent('SAVING…'));
      fireEvent.click(saveButton());
      fireEvent.click(saveButton());
      expect(api.saveShowcase).toHaveBeenCalledTimes(1);
      finish({ showcase: [streakKeeper.key, climber.key] });
      await screen.findByText('Saved — your Board card is updated.');
      expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    });

    it('(d) RETRY med dubbelklick: exakt ett nytt PUT, och fokus ligger på SAVE DISPLAY', async () => {
      rememberingServer([streakKeeper.key]);
      api.saveShowcase.mockRejectedValueOnce(new Error('boom'));
      renderWithConsumer();
      await grid();
      fireEvent.click(toggleOf(climber));
      fireEvent.click(saveButton());
      const retry = await screen.findByRole('button', { name: 'RETRY' });
      expect(api.saveShowcase).toHaveBeenCalledTimes(1);
      retry.focus();
      act(() => {
        retry.click();
        retry.click();
      });
      expect(saveButton()).toHaveFocus();
      await screen.findByText('Saved — your Board card is updated.');
      expect(api.saveShowcase).toHaveBeenCalledTimes(2);
      expect(api.saveShowcase).toHaveBeenLastCalledWith([streakKeeper.key, climber.key]);
      expect(document.body).not.toHaveFocus();
      expect(saveButton()).toHaveFocus();
    });
  });
});
