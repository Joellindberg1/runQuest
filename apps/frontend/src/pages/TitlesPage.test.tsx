import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import TitlesPage from './TitlesPage';
import { TOUR_TITLES_V2 } from '@/features/onboarding/featureTourSteps';
import type { GroupEligibilityEntry, TitleLeaderboard } from '@/shared/services/backendApi';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer; ankar-vakten nedan kollar DOM:en i stället.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({
  FeatureTour: ({ slug }: { slug: string }) => <div data-testid="feature-tour" data-slug={slug} />,
}));

const MOBILE = 390;
const DESKTOP = 1280;

// Felkortet kommer efter ett snabbt omförsök (~1 s).
const SLOW = { timeout: 4000 };

const location = () => screen.getByTestId('location').textContent;

const holder = (user_id: string, user_name: string, value: number, extra: object = {}) => ({ user_id, user_name, value, earned_at: '', ...extra });
const ru = (position: number, user_id: string, user_name: string, value: number) => ({ position, ...holder(user_id, user_name, value) });

const title = (id: string, name: string, metric_key: string | undefined, over: Partial<TitleLeaderboard> = {}): TitleLeaderboard => ({
  id, name, description: `${name}: regeln ur databasen.`, unlock_requirement: 0, metric_key, holder: null, runners_up: [], ...over,
});

const KARL = 'u-karl';
const ADAM = 'u-adam';
const DAN = 'u-dan';

// Dagens titelnamn ur databasen (inte designens påhittade) — ett urval över kategorierna.
const BATMAN = title('t-batman', 'The Batman', 'nightRunCount', {
  unlock_requirement: 7, holder: holder(KARL, 'Karl Persson', 18), runners_up: [ru(2, ME.id, 'Joel Lindberg', 7)],
});
const LUNCH = title('t-lunch', 'The Lunch Breaker', 'lunchRunCount', {
  unlock_requirement: 7, holder: holder(ME.id, 'Joel Lindberg', 31), runners_up: [ru(3, DAN, 'Daniel Lindblad Lüthje', 9), ru(2, ADAM, 'Adam Einstein', 13)],
});
const ROOSTER = title('t-rooster', 'The Rooster', 'earlyRunCount', {
  unlock_requirement: 7, holder: holder(KARL, 'Karl Persson', 56), runners_up: [ru(2, ME.id, 'Joel Lindberg', 8)],
});
const WEEKEND = title('t-weekend', 'The Weekend Destroyer', 'weekendAvg', {
  unlock_requirement: 30, holder: holder(ME.id, 'Joel Lindberg', 38.4), runners_up: [ru(2, KARL, 'Karl Persson', 35.3)],
});
const HAMSTER = title('t-hamster', 'The Hamster', 'maxRunsOneWeek', {
  holder: holder(ME.id, 'Joel Lindberg', 7), runners_up: [ru(2, ADAM, 'Adam Einstein', 4)],
});
const COMMUTER = title('t-commuter', 'The Commuter', 'maxWeekdayStreak', { unlock_requirement: 20 });
const KIPCHOGE = title('t-kipchoge', 'The Kipchoge', 'fastestMarathon', {
  unlock_requirement: 250, holder: holder(ADAM, 'Adam Einstein', 540), runners_up: [ru(2, ME.id, 'Joel Lindberg', 500)],
});
const GOGGINS = title('t-goggins', 'The Goggins', 'longestStreak', { holder: holder(ME.id, 'Joel Lindberg', 44) });
const NEWCOMER = title('t-new', 'The Newcomer', 'someFutureMetric', { holder: holder(KARL, 'Karl Persson', 3) });
const BOARD = [BATMAN, LUNCH, ROOSTER, WEEKEND, HAMSTER, COMMUTER, KIPCHOGE, GOGGINS, NEWCOMER];
// Jag håller Lunch Breaker, Weekend Destroyer, Hamster, Goggins = 4 av 9.

const elig = (userId: string, name: string, values: Record<string, number>): GroupEligibilityEntry => ({ userId, name, gender: null, values });
const ELIGIBILITY = [
  elig(ME.id, 'Joel Lindberg', { maxWeekdayStreak: 11 }),
  elig(KARL, 'Karl Persson', { maxWeekdayStreak: 14 }),
  elig(ADAM, 'Adam Einstein', { maxWeekdayStreak: 3 }),
];

function renderTitles(entry = '/titles', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/titles" element={<TitlesPage />} />
    </Routes>,
    { entry, width },
  );
}

const group = (name: string) => screen.getByRole('region', { name });
const card = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement;
const openAll = (names: string[]) => {
  for (const name of names) {
    const toggle = within(group(name)).getByRole('button', { name: new RegExp(name) });
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  }
};

beforeEach(() => {
  resetFakeBackend();
  handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
  handlers.getTitleGroupEligibility = () => ({ success: true, data: ELIGIBILITY });
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.updateDisplayedTitles = () => ({ success: true });
});

describe('Titles — räknarrad och filter (mobil)', () => {
  it('visar "N in play · you hold M" och rubriken', async () => {
    renderTitles();
    expect(await screen.findByRole('heading', { name: 'Titles', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('9 in play · you hold 4')).toBeInTheDocument();
  });

  it('filterchips All/Mine/Unclaimed, All vald som standard', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    const tabs = within(screen.getByRole('tablist', { name: 'Title filter' })).getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['All', 'true'], ['Mine', 'false'], ['Unclaimed', 'false'],
    ]);
  });

  it('kategorigrupper med antal, i kategoriordning; bara den första är öppen', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    const headers = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));
    expect(headers.map((button) => button.textContent)).toEqual([
      'Time of day3 titles', 'Distance1 title', 'Pace1 title', 'Volume1 title', 'Consistency2 titles', 'Other1 title',
    ]);
    expect(headers.map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(screen.getByRole('heading', { name: 'The Batman', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The Hamster', level: 3 })).toBeNull();
  });

  it('aria-controls pekar bara på en lista som finns (stängd grupp har inget aria-controls)', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    const time = within(group('Time of day')).getAllByRole('button')[0];
    const distance = within(group('Distance')).getByRole('button');
    expect(document.getElementById(time.getAttribute('aria-controls') as string)).not.toBeNull();
    expect(distance).not.toHaveAttribute('aria-controls');
  });

  it('en gruppsrubrik öppnar och stänger sin lista', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    const volume = within(group('Volume')).getByRole('button');
    fireEvent.click(volume);
    expect(volume).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'The Hamster', level: 3 })).toBeInTheDocument();

    fireEvent.click(volume);
    expect(screen.queryByRole('heading', { name: 'The Hamster', level: 3 })).toBeNull();
  });
});

describe('Titles — titelraden', () => {
  it('namn, regel ur databasen, innehavare och värde i rätt enhet', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    const batman = card('The Batman');
    expect(within(batman).getByText('The Batman: regeln ur databasen.')).toBeInTheDocument();
    expect(within(batman).getByText('Karl Persson')).toBeInTheDocument();
    expect(within(batman).getByText('18 runs')).toBeInTheDocument();
  });

  it('min titel markeras (kort och innehavarchip) — andras inte', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    const lunch = card('The Lunch Breaker');
    expect(lunch).toHaveAttribute('data-state', 'mine');
    expect(lunch.querySelector('.rq-titles-holder')).toHaveAttribute('data-mine', 'true');

    const batman = card('The Batman');
    expect(batman).toHaveAttribute('data-state', 'held');
    expect(batman.querySelector('.rq-titles-holder')).toHaveAttribute('data-mine', 'false');
  });

  it('runner-ups #2/#3 i positionsordning, och jag markeras när jag är en av dem', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    const ups = within(within(card('The Lunch Breaker')).getByRole('list', { name: 'Runners-up' })).getAllByRole('listitem');
    expect(ups.map((item) => item.textContent)).toEqual(['#2 Adam Einstein13 runs', '#3 Daniel Lindblad Lüthje9 runs']);

    const batmanUps = within(card('The Batman')).getAllByRole('listitem');
    expect(batmanUps[0].textContent).toBe('#2 Joel Lindberg7 runs');
    expect(batmanUps[0]).toHaveAttribute('data-mine', 'true');
  });

  it('en tid avkodas, King/Queen följer innehavaren, okänd metric_key hamnar i Other utan påhittad enhet', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    openAll(['Pace', 'Other']);

    expect(within(card('The Kipchoge')).getByText('3h00m')).toBeInTheDocument();
    expect(within(group('Other')).getByRole('heading', { name: 'The Newcomer', level: 3 })).toBeInTheDocument();
    expect(within(card('The Newcomer')).getByText('3')).toBeInTheDocument();
  });

  it('olåst titel: "Nobody yet", "Best so far · namn värde" ur eligibility (även under tröskeln) och kravet', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    openAll(['Consistency']);

    const commuter = card('The Commuter');
    expect(commuter).toHaveAttribute('data-state', 'unclaimed');
    expect(within(commuter).getByText('Nobody yet')).toBeInTheDocument();
    expect(within(commuter).getByText('—')).toBeInTheDocument();
    expect(within(commuter).getByText('Best so far · Karl Persson')).toBeInTheDocument();
    expect(within(commuter).getByText('14 weekdays')).toBeInTheDocument();
    expect(within(commuter).getByText('Unlocks at 20 weekdays')).toBeInTheDocument();
  });

  it('eligibility-anropet misslyckas: korten ritas ändå, olåsta titlar utan "Best so far"', async () => {
    handlers.getTitleGroupEligibility = () => ({ success: false, error: 'boom' });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    openAll(['Consistency']);

    expect(screen.queryByRole('alert')).toBeNull();
    const commuter = card('The Commuter');
    expect(within(commuter).getByText('Nobody yet')).toBeInTheDocument();
    expect(within(commuter).queryByText(/Best so far/)).toBeNull();
  });
});

describe('Titles — filter över ?filter=', () => {
  it('Mine: bara mina titlar, grupperna öppna, adressen skriver ?filter=mine', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(location()).toBe('/titles?filter=mine');
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');

    const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(names).toEqual(['The Lunch Breaker', 'The Weekend Destroyer', 'The Hamster', 'The Goggins']);
    // räknaren är fortfarande totalen, inte filtrets
    expect(screen.getByText('9 in play · you hold 4')).toBeInTheDocument();
    expect(within(group('Time of day')).getByText('1 title')).toBeInTheDocument();
  });

  it('Unclaimed: bara olåsta titlar', async () => {
    renderTitles('/titles?filter=unclaimed');
    await screen.findByText('9 in play · you hold 4');
    expect(screen.getByRole('tab', { name: 'Unclaimed' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['The Commuter']);
  });

  it('okänt filter faller tillbaka på All', async () => {
    renderTitles('/titles?filter=hopp');
    await screen.findByText('9 in play · you hold 4');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  });

  it('tomt filter: streckad empty state med väg tillbaka till alla titlar', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: [BATMAN, COMMUTER] });
    renderTitles('/titles?filter=mine');
    expect(await screen.findByRole('heading', { name: 'No titles held yet', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Titles', level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Show all titles' }));
    expect(location()).toBe('/titles');
  });

  it('inga olåsta titlar: unclaimed-filtret säger det', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: [BATMAN] });
    renderTitles('/titles?filter=unclaimed');
    expect(await screen.findByRole('heading', { name: 'Every title has a holder', level: 2 })).toBeInTheDocument();
  });
});

describe('Titles — laddning, tomt, fel (regel 9)', () => {
  it('skeleton-rader medan titlarna hämtas', async () => {
    handlers.getTitleLeaderboard = () => new Promise(() => {});
    renderTitles();
    expect(await screen.findByText('Loading titles')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-tour')).toBeNull();
  });

  it('inga titlar i gruppen: tomt läge med knapp', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
    renderTitles();
    expect(await screen.findByRole('heading', { name: 'No titles yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a run' })).toBeInTheDocument();
  });

  it('fel: felkort med Retry — inte "inga titlar" — och Retry hämtar om', async () => {
    let fail = true;
    handlers.getTitleLeaderboard = () => (fail ? { success: false, error: 'down' } : { success: true, data: BOARD });
    renderTitles();

    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText("Couldn't load the titles")).toBeInTheDocument();
    expect(screen.queryByText('No titles yet')).toBeNull();

    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('9 in play · you hold 4')).toBeInTheDocument();
  });
});

describe('Titles — visning på leaderboarden', () => {
  const display = () => screen.getByRole('region', { name: 'On display' });

  it('visar sparat val i "On display" med position, namn och värde', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...ME, displayed_title_ids: ['t-weekend', 't-hamster'] }, OTHER] });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');

    const slots = await within(display()).findAllByRole('listitem');
    expect(slots.map((slot) => slot.textContent)).toEqual(['1The Weekend Destroyer38.4 km', '2The Hamster7 runs/wk']);
    // jag håller fyra titlar → överflödesraden i förhandsvisningen
    expect(within(display()).getByText('The Weekend Destroyer, The Hamster & The one with too many names to mention!')).toBeInTheDocument();
    expect(within(display()).getByText('2 / 3')).toBeInTheDocument();
    expect(within(display()).getByRole('button', { name: 'Save display' })).toBeDisabled();
  });

  it('Save är en sekundärknapp — aldrig sidans guldknapp (mobil och desktop)', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const view = renderTitles('/titles', width);
      await screen.findByText(/in play/);
      const save = within(display()).getByRole('button', { name: 'Save display' });
      expect(save).toHaveClass('rq-btn--secondary');
      expect(view.container.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
      view.unmount();
    }
  });

  it('ett sparat val med en titel jag förlorat räknas inte', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...ME, displayed_title_ids: ['t-batman', 't-hamster'] }, OTHER] });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    const slots = await within(display()).findAllByRole('listitem');
    expect(slots.map((slot) => slot.textContent)).toEqual(['1The Hamster7 runs/wk']);
  });

  it('"Show on leaderboard" på min titel lägger den i panelen; Save skickar valet och bekräftar', async () => {
    const saved: string[][] = [];
    handlers.updateDisplayedTitles = (ids: unknown) => {
      saved.push(ids as string[]);
      return { success: true };
    };
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    openAll(['Volume', 'Distance']);

    fireEvent.click(within(card('The Hamster')).getByRole('button', { name: 'Show on leaderboard' }));
    fireEvent.click(within(card('The Weekend Destroyer')).getByRole('button', { name: 'Show on leaderboard' }));

    expect(within(card('The Hamster')).getByRole('button', { name: 'On display · 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card('The Weekend Destroyer')).getByRole('button', { name: 'On display · 2' })).toBeInTheDocument();
    expect(within(display()).getByText('The Hamster, The Weekend Destroyer', { exact: false })).toBeInTheDocument();

    fireEvent.click(within(display()).getByRole('button', { name: 'Save display' }));
    expect(await within(display()).findByText(/Saved/)).toBeInTheDocument();
    expect(saved).toEqual([['t-hamster', 't-weekend']]);
  });

  it('andras titlar och olåsta titlar har ingen valknapp', async () => {
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    await within(display()).findByText('Pick up to three of your titles to show on the leaderboard.');
    expect(within(card('The Batman')).queryByRole('button')).toBeNull();
  });

  it('✕ i panelen tar bort en titel ur valet', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...ME, displayed_title_ids: ['t-weekend', 't-hamster'] }, OTHER] });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    await within(display()).findAllByRole('listitem');

    fireEvent.click(within(display()).getByRole('button', { name: 'Remove The Weekend Destroyer from display' }));
    expect(within(display()).getAllByRole('listitem').map((slot) => slot.textContent)).toEqual(['1The Hamster7 runs/wk']);
    expect(within(display()).getByRole('button', { name: 'Save display' })).toBeEnabled();
  });

  it('högst tre: när valet är fullt är övriga valknappar avstängda', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...ME, displayed_title_ids: ['t-lunch', 't-weekend', 't-hamster'] }, OTHER] });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    await within(display()).findAllByRole('listitem');
    openAll(['Consistency']);

    const fourth = within(card('The Goggins')).getByRole('button', { name: /Show on leaderboard/ });
    expect(fourth).toBeDisabled();
    expect(fourth).toHaveAttribute('title', 'Display is full — remove one first');
    expect(fourth).toHaveAccessibleName(/Display is full — remove one first/);
    expect(within(card('The Lunch Breaker')).getByRole('button', { name: 'On display · 1' })).not.toHaveAttribute('title');
    expect(within(card('The Lunch Breaker')).getByRole('button', { name: 'On display · 1' })).toBeEnabled();
    // fler än tre innehavda titlar: överflödesraden i förhandsvisningen
    expect(within(display()).getByText(/too many names to mention/)).toBeInTheDocument();
  });

  it('misslyckad sparning: felmeddelande, valet och Save finns kvar', async () => {
    handlers.updateDisplayedTitles = () => ({ success: false, error: 'nope' });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    openAll(['Volume']);

    fireEvent.click(within(card('The Hamster')).getByRole('button', { name: 'Show on leaderboard' }));
    fireEvent.click(within(display()).getByRole('button', { name: 'Save display' }));

    expect(await within(display()).findByText(/Could not save/)).toBeInTheDocument();
    expect(within(display()).getByRole('button', { name: 'Save display' })).toBeEnabled();
    expect(within(display()).getByText('1 / 3')).toBeInTheDocument();
  });

  it('utan titlar att visa: "Hold a title…" och ingen sparaknapp', async () => {
    handlers.getTitleLeaderboard = () => ({ success: true, data: [BATMAN, COMMUTER] });
    renderTitles();
    await screen.findByText('2 in play · you hold 0');
    expect(await within(display()).findByText('Hold a title to put it on display.')).toBeInTheDocument();
    expect(within(display()).queryByRole('button', { name: 'Save display' })).toBeNull();
  });
});

describe('Titles — desktop (Web-prototypens layout)', () => {
  it('"All titles"-chip, räknarrad med "on display" och sidokolumnen On display + Closest chase', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...ME, displayed_title_ids: ['t-weekend', 't-hamster'] }, OTHER] });
    renderTitles('/titles', DESKTOP);

    expect(await screen.findByText('9 in play · you hold 4 · 2 on display')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All titles' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'On display' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Closest chase' })).toBeInTheDocument();
  });

  it('Closest chase: avstånd och vem det gäller, närmast först', async () => {
    renderTitles('/titles', DESKTOP);
    const chase = await screen.findByRole('region', { name: 'Closest chase' });

    const items = within(chase).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      // The Weekend Destroyer: 3.1 / 38.4 = 8 %
      'The Weekend Destroyer3.1 kmKarl Persson is closest behind you',
      // The Hamster: 3 / 7 = 43 %
      'The Hamster3 runs/wkAdam Einstein is closest behind you',
      // The Commuter (olåst, jag har 11 av 20): 9 / 20 = 45 %
      'The Commuter9 weekdaysUnclaimed — 20 weekdays unlocks it',
    ]);
    expect(items.map((item) => item.getAttribute('data-kind'))).toEqual(['ahead', 'ahead', 'unclaimed']);
  });

  it('desktop har dragspelsrubriker med chevron; mobilen har varken chevron eller Closest chase', async () => {
    const { container, unmount } = renderTitles('/titles', DESKTOP);
    await screen.findByText(/in play/);
    expect(container.querySelectorAll('.rq-titles-group__chev').length).toBeGreaterThan(0);
    unmount();

    const mobile = renderTitles('/titles', MOBILE);
    await screen.findByText(/in play/);
    expect(mobile.container.querySelectorAll('.rq-titles-group__chev')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Closest chase' })).toBeNull();
    expect(screen.getByRole('region', { name: 'On display' })).toBeInTheDocument();
  });
});

describe('Titles — tour', () => {
  it('startar inte medan titlarna laddar, och använder slug tour_titles_v2 när sidan är ritad', async () => {
    handlers.getTitleLeaderboard = () => new Promise(() => {});
    const pending = renderTitles();
    await screen.findByText('Loading titles');
    expect(screen.queryByTestId('feature-tour')).toBeNull();
    pending.unmount();

    resetFakeBackend();
    handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
    renderTitles();
    await screen.findByText('9 in play · you hold 4');
    await waitFor(() => expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_titles_v2'));
  });

  const selectors = TOUR_TITLES_V2.flatMap((step) => (step.element ? [step.element] : []));

  it('touren har ankare att leta efter', () => {
    expect(selectors.length).toBeGreaterThan(0);
  });

  it.each([MOBILE, DESKTOP])('varje elementväljare i TOUR_TITLES_V2 träffar exakt ett element (%ipx)', async (width) => {
    const { container } = renderTitles('/titles', width);
    await screen.findByText(/in play/);
    for (const selector of selectors) {
      expect({ selector, count: container.querySelectorAll(selector).length }).toEqual({ selector, count: 1 });
    }
  });
});
