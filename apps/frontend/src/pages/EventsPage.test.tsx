import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import EventsPage from './EventsPage';
import { TOUR_EVENTS_V2 } from '@/features/onboarding/featureTourSteps';
import { ADAM, KARL, ME, event, mine, row } from '@/features/events/events.fixture';
import type { EventItem } from '@runquest/shared';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
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

// Öppna/kommande event ligger relativt "nu" (sidan läser klockan), historiken har fasta datum.
const MS_HOUR = 3_600_000;
const MS_MINUTE = 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const FIVE_K = event({
  id: 'e-5k',
  startsAt: at(-17 * MS_HOUR),
  endsAt: at(6 * MS_HOUR + 30 * MS_MINUTE + 30_000), // → "6h 30m"
  template: { name: '5K Friday', icon: 'calendar', description: 'Run 5 km or more before midnight', minKm: 5, rewardXp: 25, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null },
  participantCount: 4,
});

const WEEKLY = event({
  id: 'e-weekly',
  type: 'competition',
  metric: 'km',
  startsAt: at(-100 * MS_HOUR),
  endsAt: at(2 * 24 * MS_HOUR + 5 * MS_HOUR + 30_000),
  template: { name: 'Weekly km', icon: 'trophy', description: 'Most kilometres in the week', minKm: 0, rewardXp: 0, rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30, requiresWeather: null },
  myEntry: mine({ rank: 2, xpAwarded: null, totalValue: 41.2 }),
  participantCount: 3,
  leaderboard: [
    row({ userId: KARL, userName: 'Karl Persson', totalValue: 48.3, rank: 1 }),
    row({ userId: ME, userName: 'Du', totalValue: 41.2, rank: 2, isMe: true }),
    row({ userId: ADAM, userName: 'Adam Einstein', totalValue: 12, rank: 3 }),
  ],
});

const EVENING = event({
  id: 'e-evening',
  status: 'scheduled',
  startsAt: at(3 * MS_HOUR + 30_000), // → "3h 0m"
  endsAt: at(7 * MS_HOUR),
  template: { name: 'Evening Run', icon: 'moon', description: '3 km between 18:00 and 22:00.', minKm: 3, rewardXp: 25, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null },
});

const HANGOVER = event({
  id: 'e-hangover',
  status: 'scheduled',
  startsAt: at(60 * MS_HOUR),
  endsAt: at(80 * MS_HOUR),
  template: { name: 'Hangover Run', icon: 'sun', description: '5 km before 11:00 on a weekend', minKm: 5, rewardXp: 40, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null },
});

// 14 avslutade event: 12 participation (8 klarade, 4 missade) och 2 tävlingar (en tvåa med 60 XP, en jag inte var med i).
const NAMES = ['Morning Run', 'Storm Chaser', 'Hangover Run', 'Evening Run'];
const HISTORY: EventItem[] = Array.from({ length: 14 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 8, 28) - i * 3 * 86_400_000);
  const startsAt = new Date(+day + 5 * MS_HOUR).toISOString();
  const endsAt = new Date(+day + 9 * MS_HOUR).toISOString();
  const base = { id: `h${i}`, status: 'settled', startsAt, endsAt, participantCount: 4 };
  const template = (name: string, over = {}) => ({ name, icon: 'calendar', description: '', minKm: 3, rewardXp: 25, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0, requiresWeather: null, ...over });
  if (i === 4 || i === 9) {
    return event({
      ...base, type: 'competition', metric: 'km', participantCount: 5,
      template: template('Weekly km', { rewardXp: 0, rewardXp1st: 100, rewardXp2nd: 60, rewardXp3rd: 30 }),
      myEntry: i === 4 ? mine({ rank: 2, xpAwarded: 60, totalValue: 30 }) : null,
    });
  }
  return event({ ...base, template: template(`${NAMES[i % NAMES.length]} ${i}`), myEntry: i % 3 === 1 ? null : mine({ xpAwarded: 25 }) });
});
// Klarade 8 av 12 participation-event (200 XP) + tvåplatsen (60 XP) = 260 XP; 4 missade × 25 = 100 XP kvar.

interface Scenario {
  open?: EventItem[];
  history?: EventItem[];
}

const calls: Array<[number, number]> = [];

function setup({ open = [FIVE_K, WEEKLY, EVENING, HANGOVER], history = HISTORY }: Scenario = {}) {
  calls.length = 0;
  handlers.getEventList = () => ({ success: true, data: { events: open } });
  handlers.getEventHistoryPage = (limit: unknown, offset: unknown) => {
    calls.push([limit as number, offset as number]);
    const slice = history.slice(offset as number, (offset as number) + (limit as number));
    return {
      success: true,
      data: { events: slice, meta: { total: history.length, limit, offset, has_more: (offset as number) + (limit as number) < history.length } },
    };
  };
}

function renderEvents(entry = '/events', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/events" element={<EventsPage />} />
    </Routes>,
    { entry, width },
  );
}

const primaryButtons = (container: HTMLElement) => [...container.querySelectorAll('.rq-btn--primary')];
const openRegion = () => screen.getByRole('region', { name: 'Open now and up next' });
const card = (name: string) => screen.getByRole('heading', { name, level: 2 }).closest('article') as HTMLElement;

beforeEach(() => {
  resetFakeBackend();
  setup();
});

describe('Events — rubrik, öppna event och nedräkning (mobil)', () => {
  it('rubrik "Events" och räknarraden "N open now · X of Y taken" (all-time, ingen season)', async () => {
    renderEvents();
    expect(await screen.findByRole('heading', { name: 'Events', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('2 open now · 8 of 12 taken')).toBeInTheDocument();
  });

  it('participation-kortet: regeln ordagrant, nedräkning, "4 of 6 done" och bara värdetaggen som chip', async () => {
    renderEvents();
    const five = within(await screen.findByRole('heading', { name: '5K Friday', level: 2 }).then((heading) => heading.closest('article') as HTMLElement));
    expect(five.getByText('Open now')).toBeInTheDocument();
    expect(five.getByText('Run 5 km or more before midnight')).toBeInTheDocument();
    expect(five.getByText('6h 30m')).toBeInTheDocument();
    expect(five.getByText('left to run')).toBeInTheDocument();
    expect(five.getByText('4 of 6 done')).toBeInTheDocument();
    expect(five.getAllByRole('listitem').map((chip) => chip.textContent)).toEqual(['+25 XP']);
  });

  it('har jag klarat eventet visar chipen "Done" med den XP jag fick (kortet har fortfarande en nedräkning)', async () => {
    setup({ open: [{ ...FIVE_K, myEntry: mine({ xpAwarded: 25 }) }] });
    renderEvents();
    const five = within(await screen.findByRole('heading', { name: '5K Friday', level: 2 }).then((heading) => heading.closest('article') as HTMLElement));
    expect(five.getByText('Done · +25 XP')).toBeInTheDocument();
    expect(five.getByText('6h 30m')).toBeInTheDocument();
  });

  it('tävlingskortet: tabell med plats, namn ("You", inte "Du"), värde och pris för topp tre', async () => {
    renderEvents();
    await screen.findByRole('heading', { name: 'Weekly km', level: 2 });
    const board = within(card('Weekly km')).getByRole('list', { name: 'Standings' });
    expect(within(board).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1Karl Persson48.3 km+100 XP',
      '2You41.2 km+60 XP',
      '3Adam Einstein12.0 km+30 XP',
    ]);
    expect(within(card('Weekly km')).getByText('2d 5h')).toBeInTheDocument();
  });

  it('är jag inte med i tävlingen än får kortet en förklarande rad', async () => {
    setup({ open: [{ ...WEEKLY, myEntry: null }] });
    renderEvents();
    expect(await screen.findByText(/You are not on the board yet/)).toBeInTheDocument();
  });

  it('en tävling utan deltagare säger det i stället för en tom tabell', async () => {
    setup({ open: [{ ...WEEKLY, leaderboard: [], participantCount: 0, myEntry: null }] });
    renderEvents();
    expect(await screen.findByText(/Nobody has run yet this week/)).toBeInTheDocument();
  });

  it('en tävling efter slutdatum men före avräkningen visas som "Settling" medan ett participation-event i samma läge försvinner', async () => {
    const settling = { ...WEEKLY, endsAt: at(-MS_MINUTE) };
    const over = { ...FIVE_K, endsAt: at(-MS_MINUTE) };
    setup({ open: [settling, over] });
    renderEvents();
    const weekly = within(await screen.findByRole('heading', { name: 'Weekly km', level: 2 }).then((heading) => heading.closest('article') as HTMLElement));
    expect(weekly.getByText('Settling')).toBeInTheDocument();
    expect(weekly.getByText('Final')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '5K Friday', level: 2 })).toBeNull();
    expect(await screen.findByText('Nothing open now · 8 of 12 taken')).toBeInTheDocument();
  });
});

describe('Events — up next och This week (mobil)', () => {
  it('up next är det som öppnar först, med nedräkning och faktaraden', async () => {
    renderEvents();
    const next = within(await screen.findByRole('heading', { name: 'Evening Run', level: 2 }).then((heading) => heading.closest('article') as HTMLElement));
    expect(next.getByText('Up next')).toBeInTheDocument();
    expect(next.getByText('3h 0m')).toBeInTheDocument();
    expect(next.getByText('until open')).toBeInTheDocument();
    expect(next.getByText(/^3 km · .* · \+25 XP$/)).toBeInTheDocument();
  });

  it('This week listar bara det som faktiskt är schemalagt efter up next', async () => {
    renderEvents();
    const week = within(await screen.findByRole('region', { name: 'This week' }));
    expect(week.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Hangover Run']);
    expect(week.getByText('5 km before 11:00 on a weekend')).toBeInTheDocument();
    expect(week.getByText('+40 XP')).toBeInTheDocument();
  });

  it('inga fler schemalagda: ingen This week-sektion', async () => {
    setup({ open: [FIVE_K, EVENING] });
    renderEvents();
    await screen.findByRole('heading', { name: 'Evening Run', level: 2 });
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull();
  });

  it('inget öppet och inget schemalagt: streckat tomt läge, ankaret för turen finns ändå', async () => {
    setup({ open: [] });
    renderEvents();
    expect(await screen.findByText(/Nothing is open or scheduled right now/)).toBeInTheDocument();
    expect(openRegion()).toHaveAttribute('data-tour', 'events-open');
  });
});

describe('Events — Your record och historik (mobil)', () => {
  it('Your record: klarade av avslutade, XP intjänad och XP kvar på bordet', async () => {
    renderEvents();
    const record = within(await screen.findByRole('region', { name: 'Your record' }));
    expect(record.getByText('8 of 12')).toBeInTheDocument();
    expect(record.getByText('260 XP earned · 100 XP left on the table')).toBeInTheDocument();
    expect(record.getByRole('img', { name: '8 of 12 events taken' })).toBeInTheDocument();
  });

  it('historiken: sex rader per sida med resultat, XP och "N of 6 finished"', async () => {
    renderEvents();
    const history = within(await screen.findByRole('region', { name: 'History' }));
    const rows = await history.findAllByRole('listitem');
    expect(rows).toHaveLength(6);
    expect(rows[0].textContent).toContain('Morning Run 0');
    expect(rows[0].textContent).toContain('28 Sep · 4 of 6 finished');
    expect(rows[0].textContent).toContain('✓ Done+25 XP');
    expect(rows[1].textContent).toContain('Missed—');
    // Plats 4 på listan är tävlingen jag kom tvåa i.
    expect(rows[4].textContent).toContain('Weekly km');
    expect(rows[4].textContent).toContain('#2+60 XP');
    expect(rows[4].textContent).toContain('5 of 6 entered');
  });

  it('pagern: tre sidor, sida 1 vald och föregående avstängd', async () => {
    renderEvents();
    const pager = within(await screen.findByRole('navigation', { name: 'History pages' }));
    expect(pager.getAllByRole('button').map((button) => [button.getAttribute('aria-label'), button.hasAttribute('disabled')])).toEqual([
      ['Previous page', true], ['Page 1', false], ['Page 2', false], ['Page 3', false], ['Next page', false],
    ]);
    expect(pager.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  });

  it('en sida i pagern hämtar nästa sex (limit 6, offset 6), skriver ?page= och byter raderna', async () => {
    renderEvents();
    const pager = await screen.findByRole('navigation', { name: 'History pages' });
    fireEvent.click(within(pager).getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(location()).toBe('/events?page=2'));
    await waitFor(() => expect(screen.getByText('Hangover Run 6')).toBeInTheDocument());
    expect(calls).toContainEqual([6, 6]);
    expect(screen.queryByText('Morning Run 0')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'History pages' })).getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  });

  it('pilarna bläddrar; Next är avstängd på sista sidan och sida 1 tar bort ?page=', async () => {
    renderEvents('/events?page=3');
    const pager = await screen.findByRole('navigation', { name: 'History pages' });
    await waitFor(() => expect(screen.getByText('Storm Chaser 13')).toBeInTheDocument());
    expect(within(pager).getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(location()).toBe('/events?page=2'));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'History pages' })).getByRole('button', { name: 'Page 1' }));
    await waitFor(() => expect(location()).toBe('/events'));
  });

  it('en sida bortom slutet (?page=99) landar på sista sidan', async () => {
    renderEvents('/events?page=99');
    await waitFor(() => expect(location()).toBe('/events?page=3'));
    expect(await screen.findByText('Storm Chaser 13')).toBeInTheDocument();
  });

  it('ett ogiltigt ?page= är sida 1', async () => {
    renderEvents('/events?page=abc');
    expect(await screen.findByText('Morning Run 0')).toBeInTheDocument();
  });

  it('en enda sida: ingen pager', async () => {
    setup({ history: HISTORY.slice(0, 4) });
    renderEvents();
    await screen.findByText('Morning Run 0');
    expect(screen.queryByRole('navigation', { name: 'History pages' })).toBeNull();
  });

  it('ingen historik: streckat tomt läge och inget facit', async () => {
    setup({ history: [] });
    renderEvents();
    expect(await screen.findByText('No event has finished yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your record' })).toBeNull();
    expect(screen.getByText('2 open now')).toBeInTheDocument();
  });
});

describe('Events — fel och laddning', () => {
  it('events-anropet felar: felkort med Retry (inte tomt läge) och Retry hämtar om; historiken lever ändå', async () => {
    handlers.getEventList = () => ({ success: false, error: 'boom' });
    renderEvents();
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText("Couldn't load the events")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is open or scheduled/)).toBeNull();
    expect(await screen.findByText('Morning Run 0')).toBeInTheDocument();

    setup();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: '5K Friday', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('historiken felar: felkort i panelen med Retry; resten av skärmen ritas', async () => {
    const working = handlers.getEventHistoryPage;
    handlers.getEventHistoryPage = (limit: unknown, offset: unknown) =>
      limit === 6 ? { success: false, error: 'boom' } : working(limit, offset);
    renderEvents();
    expect(await screen.findByRole('heading', { name: '5K Friday', level: 2 })).toBeInTheDocument();
    const panel = within(screen.getByRole('region', { name: 'History' }));
    expect(await panel.findByText("Couldn't load the history", {}, SLOW)).toBeInTheDocument();

    handlers.getEventHistoryPage = working;
    fireEvent.click(panel.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Morning Run 0')).toBeInTheDocument();
  });

  it('facit-källan felar: facit-panelen och räknaren utelämnas, resten ritas', async () => {
    const working = handlers.getEventHistoryPage;
    handlers.getEventHistoryPage = (limit: unknown, offset: unknown) =>
      limit === 50 ? { success: false, error: 'boom' } : working(limit, offset);
    renderEvents();
    expect(await screen.findByText('Morning Run 0')).toBeInTheDocument();
    expect(await screen.findByText('2 open now')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.queryByRole('region', { name: 'Your record' })).toBeNull();
    expect(screen.getByText('2 open now')).toBeInTheDocument();
  });

  it('medan events laddar: skelett med statusrubrik', () => {
    handlers.getEventList = () => new Promise(() => {});
    renderEvents();
    expect(screen.getByText('Loading events')).toBeInTheDocument();
  });

  it('facit läser hela historiken i sidor om 50 tills has_more är falskt', async () => {
    renderEvents();
    await screen.findByRole('region', { name: 'Your record' });
    expect(calls).toContainEqual([50, 0]);
    expect(calls.filter(([limit]) => limit === 50)).toHaveLength(1);
  });
});

describe('Events — desktop (Web Prototype)', () => {
  it('rubrikens räknarrad säger "all-time"; eyebrow bär eventtypen', async () => {
    renderEvents('/events', DESKTOP);
    expect(await screen.findByText('2 open now · 8 of 12 taken all-time')).toBeInTheDocument();
    expect(within(card('5K Friday')).getByText('Open now · participation')).toBeInTheDocument();
    expect(within(card('Weekly km')).getByText('Open now · competition')).toBeInTheDocument();
    expect(within(card('Evening Run')).getByText('Up next · participation')).toBeInTheDocument();
  });

  it('kortet visar fakta-taggarna (Min, Closes, värde), "4 of 6 done" under ringen och en stapel för gruppen', async () => {
    renderEvents('/events', DESKTOP);
    const five = within(await screen.findByRole('heading', { name: '5K Friday', level: 2 }).then((heading) => heading.closest('article') as HTMLElement));
    const chips = five.getAllByRole('listitem').map((chip) => chip.textContent ?? '');
    expect(chips[0]).toBe('Min 5 km');
    expect(chips[1]).toMatch(/^Closes \d{2}:\d{2}$/);
    expect(chips[2]).toBe('+25 XP');
    expect(five.getByText('4 of 6 done')).toBeInTheDocument();
    expect(five.getByRole('img', { name: '4 of 6 done' })).toBeInTheDocument();
  });

  it('up next visar regeln ordagrant + chips, och This week är kort med eventtyp och belöning', async () => {
    renderEvents('/events', DESKTOP);
    const next = within(await screen.findByRole('heading', { name: 'Evening Run', level: 2 }).then((heading) => heading.closest('article') as HTMLElement));
    expect(next.getByText('3 km between 18:00 and 22:00.')).toBeInTheDocument();
    expect(next.getByText('Min 3 km')).toBeInTheDocument();
    const week = within(screen.getByRole('region', { name: 'This week' }));
    expect(week.getByText('Participation')).toBeInTheDocument();
    expect(week.getByText('+40 XP')).toBeInTheDocument();
  });

  it('Your record har "all-time" och "from events"', async () => {
    renderEvents('/events', DESKTOP);
    const record = within(await screen.findByRole('region', { name: 'Your record' }));
    expect(record.getByText('8 of 12 all-time')).toBeInTheDocument();
    expect(record.getByText('260 XP earned from events · 100 XP left on the table')).toBeInTheDocument();
  });
});

describe('Events — designspråk och tur', () => {
  it('ingen guldknapp: sidan har ingen primär handling (regel 3) — och aldrig fler än en', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const view = renderEvents('/events', width);
      await screen.findByText('Morning Run 0');
      expect(primaryButtons(view.container)).toHaveLength(0);
      view.unmount();
    }
  });

  it('turen är tour_events_v2 och startar först när eventen är ritade; ankarna finns i DOM:en', async () => {
    const view = renderEvents();
    expect(screen.queryByTestId('feature-tour')).toBeNull();
    await screen.findByRole('heading', { name: '5K Friday', level: 2 });
    expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_events_v2');
    for (const step of TOUR_EVENTS_V2) {
      if (step.element) expect({ selector: step.element, found: view.container.querySelector(step.element) !== null }).toEqual({ selector: step.element, found: true });
    }
  });

  it('turen startar inte medan eventen inte laddats (felkort)', async () => {
    handlers.getEventList = () => ({ success: false, error: 'boom' });
    renderEvents();
    await screen.findByRole('alert', {}, SLOW);
    expect(screen.queryByTestId('feature-tour')).toBeNull();
  });
});
