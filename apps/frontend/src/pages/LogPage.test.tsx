import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { calculateCompleteRunXP, DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS, type GroupRunHistoryItem } from '@runquest/shared';
import LogPage from './LogPage';
import { useOpenEvents } from '@/features/events/hooks/useEventsQueries';
import { KARL, ME as ME_ID, historyItem, historyPage } from '@/features/log/log.fixture';
import { ME, OTHER, XP_CONFIG, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const MOBILE = 390;
const DESKTOP = 1280;
// Config-felet kommer efter ett snabbt omförsök (~1 s).
const SLOW = { timeout: 4000 };

const NOW = '2026-10-04T10:00:00Z'; // 12:00 i Stockholm — idag är 2026-10-04
const TODAY = '2026-10-04';

const location = () => screen.getByTestId('location').textContent;

// Jag har löpt igår (streakdag 4) → en runda idag blir dag 5. Karl ligger 296 XP före.
const mine = {
  ...ME,
  runs: [{ id: 'r1', user_id: ME.id, date: '2026-10-03', distance: 8, xp_gained: 40, multiplier: 1.1, streak_day: 4, base_xp: 15, km_xp: 16, distance_bonus: 5, streak_bonus: 4 }],
};

const serverRun = (over = {}) => ({
  id: 'new', user_id: ME.id, date: TODAY, distance: 8, xp_gained: 44, multiplier: 1.1, streak_day: 5, base_xp: 15, km_xp: 16, distance_bonus: 5, streak_bonus: 3, ...over,
});

const createRun = vi.fn();
const usersCalls = vi.fn();
const historyCalls: Array<[number, number]> = [];

function setup({ history = [] as GroupRunHistoryItem[] } = {}) {
  createRun.mockReset();
  createRun.mockImplementation(async () => ({ success: true, data: serverRun() }));
  usersCalls.mockReset();
  historyCalls.length = 0;
  handlers.getUsersWithRuns = () => {
    usersCalls();
    return { success: true, data: [mine, OTHER] };
  };
  handlers.createRun = (...args: unknown[]) => createRun(...args);
  handlers.getGroupRunHistoryPage = (limit: unknown, offset: unknown) => {
    historyCalls.push([limit as number, offset as number]);
    const slice = history.slice(offset as number, (offset as number) + (limit as number));
    return { success: true, data: historyPage(slice, history.length, offset as number, limit as number) };
  };
  handlers.getStravaStatus = () => ({ success: true, data: { connected: true, expired: false } });
  handlers.getStravaLastSync = () => ({
    success: true,
    data: { last_sync_attempt: '2026-10-04T09:28:00Z', last_sync_status: 'ok', next_sync_estimated: '2026-10-04T10:28:00Z' },
  });
}

/** Håller events-listan monterad, som skalets "Right now" gör, så att invalideringen efter en runda har något att träffa. */
function EventsObserver() {
  useOpenEvents();
  return null;
}

function renderLog(entry = '/log', width = MOBILE) {
  return renderWithApp(
    <>
      <Routes>
        <Route path="/log" element={<LogPage />} />
      </Routes>
      <EventsObserver />
    </>,
    { entry, width },
  );
}

const manyRuns = (count: number): GroupRunHistoryItem[] =>
  Array.from({ length: count }, (_, i) => historyItem({ id: `r${i}`, user_id: i === 0 ? ME_ID : KARL, user_name: i === 0 ? 'Joel Lindberg' : 'Karl Persson' }));

const distanceField = () => screen.getByLabelText('Distance (km)') as HTMLInputElement;
const dateField = () => screen.getByLabelText('Date') as HTMLInputElement;
const type = (value: string) => fireEvent.change(distanceField(), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Log run' }));
const primaryButtons = (container: HTMLElement) => [...container.querySelectorAll('.rq-btn--primary')];
const xpCard = () => within(screen.getByRole('region', { name: 'Estimated XP' }));
const effects = () => within(screen.getByRole('region', { name: 'What this run does' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  resetFakeBackend();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Log — formuläret (mobil)', () => {
  it('rubrik, flikar, Strava-rad och ett formulär med dagens datum och tomt distansfält', async () => {
    renderLog();
    expect(await screen.findByRole('heading', { name: 'Log runs', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Strava syncs on its own · manual for treadmills')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Log a run', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Group history', selected: false })).toBeInTheDocument();
    expect(dateField().value).toBe(TODAY);
    expect(dateField()).toHaveAttribute('min', '2025-06-01');
    expect(dateField()).toHaveAttribute('max', TODAY);
    expect(distanceField().value).toBe('');
    expect(screen.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Treadmill' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Strava-raden visar senaste och nästa synk', async () => {
    renderLog();
    expect(await screen.findByText('Strava connected')).toBeInTheDocument();
    expect(await screen.findByText('Last sync 32 min ago · next in 28 min')).toBeInTheDocument();
  });

  it('inte kopplad: raden pekar på Settings', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: false, expired: false } });
    renderLog();
    expect(await screen.findByText('Strava not connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(location()).toBe('/settings');
  });

  it('exakt en guldknapp i vyn: submit', async () => {
    const { container } = renderLog();
    await screen.findByRole('heading', { name: 'Log runs' });
    expect(primaryButtons(container).map((button) => button.textContent)).toEqual(['Log run']);
  });

  it('snabbvalen fyller fältet och markerar sig; att skriva samma tal för hand markerar dem också', async () => {
    renderLog();
    await screen.findByRole('heading', { name: 'Log runs' });
    fireEvent.click(screen.getByRole('button', { name: '10 km' }));
    expect(distanceField().value).toBe('10');
    expect(screen.getByRole('button', { name: '10 km' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '5 km' })).toHaveAttribute('aria-pressed', 'false');
    type('21,1');
    expect(screen.getByRole('button', { name: '21.1 km' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('hjälptexterna är bara uppläsningstext på mobil (prototypens desktopvariant) och synliga som fel', async () => {
    renderLog();
    await screen.findByRole('heading', { name: 'Log runs' });
    expect(screen.getByText('Minimum 1.0 km to count')).toHaveClass('sr-only');
    type('0.4');
    expect(screen.getByText('A run needs at least 1.0 km to count')).toHaveClass('rq-log-note');
  });
});

describe('Log — Estimated XP och "What this run does"', () => {
  it('tomt fält: "—", dämpad uppställning och uppmaningen att ange en distans', async () => {
    renderLog();
    expect(await screen.findByText('Enter a distance')).toBeInTheDocument();
    expect(xpCard().getByText('—', { selector: '.rq-log-xp__total' })).toBeInTheDocument();
    expect(effects().getByText('min 1.0 km')).toBeInTheDocument();
  });

  it('8 km: shared-formeln över config-trappan med streakdag 5, och uppställningen summerar till totalen', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    const expected = calculateCompleteRunXP(8, 5, XP_CONFIG.settings, XP_CONFIG.streak_multipliers);
    expect(expected.multiplier).toBe(1.3); // fixturens trappa, inte produktionens
    expect(xpCard().getByText(`~${expected.finalXP}`)).toBeInTheDocument();
    expect(xpCard().getByText('Distance · 8.0 km × 2')).toBeInTheDocument();
    expect(xpCard().getByText('+16')).toBeInTheDocument();
    expect(xpCard().getByText('+5')).toBeInTheDocument();
    expect(xpCard().getByText('Streak · day 5')).toBeInTheDocument();
    expect(xpCard().getByText('×1.3')).toBeInTheDocument();
  });

  it('effekterna bygger på min faktiska data: streak lever, nivå, Frodo och rankingen mot Karl', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    const gained = calculateCompleteRunXP(8, 5, XP_CONFIG.settings, XP_CONFIG.streak_multipliers).finalXP;
    expect(effects().getByText('Stays alive · day 5')).toBeInTheDocument();
    expect(effects().getByText('Level 25')).toBeInTheDocument();
    expect(effects().getByText(`${659 - gained} XP to go`)).toBeInTheDocument();
    expect(effects().getByText('Frodo’s journey')).toBeInTheDocument();
    expect(effects().getByText("+8.0 km toward Balin's Tomb")).toBeInTheDocument();
    expect(effects().getByText(`Closes on Karl · ${OTHER.total_xp - ME.total_xp - gained} XP behind`)).toBeInTheDocument();
  });

  it('ett annat datum ger en annan streakdag och därmed en annan multiplikator', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    fireEvent.change(dateField(), { target: { value: '2026-09-20' } });
    expect(xpCard().getByText('Streak · day 1')).toBeInTheDocument();
    expect(effects().getByText('New streak · day 1')).toBeInTheDocument();
  });

  it('XP-konfigen går inte att läsa: shareds standardvärden räknar, och kortet säger det', async () => {
    handlers.getXpConfig = () => ({ success: false, error: 'nope' });
    renderLog();
    expect(await screen.findByText(/Showing the standard XP rules/, undefined, SLOW)).toBeInTheDocument();
    type('8');
    const expected = calculateCompleteRunXP(8, 5, DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS);
    expect(xpCard().getByText(`~${expected.finalXP}`)).toBeInTheDocument();
  });

  it('användardatan går inte att läsa: felkort med Retry bredvid ett fortfarande användbart formulär', async () => {
    let fail = true;
    handlers.getUsersWithRuns = () => (fail ? { success: false, error: 'boom' } : { success: true, data: [mine, OTHER] });
    renderLog();
    expect(await screen.findByText("Couldn't load your stats")).toBeInTheDocument();
    expect(distanceField()).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load your stats")).toBeNull());
    expect(await screen.findByText('Enter a distance')).toBeInTheDocument();
  });
});

describe('Log — validering med backendens regler', () => {
  it('tomt fält vid inlämning: vänligt fel, fokus på fältet och inget anrop', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    submit();
    expect(await screen.findByText('Enter a distance in km')).toBeInTheDocument();
    expect(distanceField()).toHaveAttribute('aria-invalid', 'true');
    expect(distanceField()).toHaveFocus();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('under 1.0 km: felet visas direkt och det går inte att skicka', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('0.9');
    expect(screen.getByText('A run needs at least 1.0 km to count')).toBeInTheDocument();
    submit();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('framtida datum och datum före 2025-06-01 nekas, och fokus går till datumfältet', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    fireEvent.change(dateField(), { target: { value: '2026-10-05' } });
    expect(screen.getByText('You cannot log a run for a future date')).toBeInTheDocument();
    fireEvent.change(dateField(), { target: { value: '2025-05-31' } });
    expect(screen.getByText('Runs can only be logged from 1 June 2025')).toBeInTheDocument();
    submit();
    await waitFor(() => expect(dateField()).toHaveFocus());
    expect(createRun).not.toHaveBeenCalled();
  });

  it('ett datum utan värde (rensat fält) är ett fel, inte en krasch', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    fireEvent.change(dateField(), { target: { value: '' } });
    expect(screen.getByText('Pick a date')).toBeInTheDocument();
  });
});

describe('Log — att logga en runda', () => {
  it('skickar datum, distans och en bool för is_treadmill; bekräftar med serverns siffror och nollställer formuläret', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('8,4');
    fireEvent.click(screen.getByRole('button', { name: 'Treadmill' }));
    submit();

    await waitFor(() => expect(createRun).toHaveBeenCalledWith(TODAY, 8.4, 'manual', true));
    expect(await screen.findByText('Run logged: 8.0 km for 44 XP · streak day 5 at 1.1×')).toBeInTheDocument();
    expect(distanceField().value).toBe('');
    expect(screen.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('utomhus skickar is_treadmill: false (valet är gjort, inte okänt)', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('5');
    submit();
    await waitFor(() => expect(createRun).toHaveBeenCalledWith(TODAY, 5, 'manual', false));
  });

  it('bekräftelsen och felet ligger i permanenta live-regioner som finns redan före texten', async () => {
    const { container } = renderLog();
    await screen.findByText('Enter a distance');
    const status = container.querySelector('[role="status"].rq-log-notice-slot');
    const alert = container.querySelector('[role="alert"].rq-log-notice-slot');
    expect(status).toBeEmptyDOMElement();
    expect(alert).toBeEmptyDOMElement();

    type('8');
    submit();
    await screen.findByText(/^Run logged:/);
    expect(status).toHaveTextContent(/^Run logged:/);
    expect(container.querySelector('[role="status"].rq-log-notice-slot')).toBe(status);
  });

  it('knappen är avstängd och säger "Logging…" medan anropet pågår, så en dubbelklick inte skickar två gånger', async () => {
    let resolve: (value: unknown) => void = () => {};
    createRun.mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    submit();
    const button = await screen.findByRole('button', { name: 'Logging…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createRun).toHaveBeenCalledTimes(1);
    resolve({ success: true, data: serverRun() });
    expect(await screen.findByRole('button', { name: 'Log run' })).toBeEnabled();
  });

  it('serverns fel visas i alert-regionen och formuläret står kvar orört', async () => {
    createRun.mockImplementation(async () => ({ success: false, error: 'Cannot log runs for future dates' }));
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    submit();
    const alert = await screen.findByText('Cannot log runs for future dates');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(distanceField().value).toBe('8');
    expect(screen.queryByText(/^Run logged:/)).toBeNull();
  });

  it('en lyckad runda hämtar om det som räknas ur rundorna: användarna och öppna event ("N of M done" släpar inte)', async () => {
    const eventCalls = vi.fn();
    handlers.getEventList = () => {
      eventCalls();
      return { success: true, data: { events: [] } };
    };
    renderLog();
    await screen.findByText('Enter a distance');
    await waitFor(() => expect(eventCalls).toHaveBeenCalledTimes(1));
    const before = usersCalls.mock.calls.length;

    type('8');
    submit();
    await screen.findByText(/^Run logged:/);
    await waitFor(() => expect(eventCalls).toHaveBeenCalledTimes(2));
    expect(usersCalls.mock.calls.length).toBeGreaterThan(before);
  });

  it('att skriva efter en bekräftelse tar bort den', async () => {
    renderLog();
    await screen.findByText('Enter a distance');
    type('8');
    submit();
    await screen.findByText(/^Run logged:/);
    type('9');
    expect(screen.queryByText(/^Run logged:/)).toBeNull();
  });
});

describe('Log — Group history', () => {
  it('?view=group väljer fliken; ett flikbyte skriver ?view= och formuläret behåller det som skrivits', async () => {
    setup({ history: manyRuns(3) });
    renderLog();
    await screen.findByText('Enter a distance');
    type('7');
    fireEvent.click(screen.getByRole('tab', { name: 'Group history' }));
    expect(location()).toBe('/log?view=group');
    expect(await screen.findByRole('list', { name: 'Runs in the pack' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Group history', selected: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Log a run' }));
    expect(distanceField().value).toBe('7');
  });

  it('ett okänt ?view= faller tillbaka på formuläret', async () => {
    renderLog('/log?view=nonsense');
    expect(await screen.findByLabelText('Distance (km)')).toBeInTheDocument();
  });

  it('korten: namn, datum, underlag, väder, källa, km/XP och de fem cellerna; min runda har guldkant; ingen guldknapp', async () => {
    setup({
      history: [
        historyItem({ id: 'a', user_id: ME_ID, user_name: 'Joel Lindberg', distance: 8, xp_gained: 44, streak_day: 12, multiplier: 1.8, weather_code: 0, temperature_c: 19.4 }),
        historyItem({ id: 'b', is_treadmill: true, source: 'manual', weather_code: null, temperature_c: null }),
      ],
    });
    const { container } = renderLog('/log?view=group');
    await screen.findByRole('list', { name: 'Runs in the pack' });
    const cards = [...container.querySelectorAll('.rq-log-run')] as HTMLElement[];
    expect(cards).toHaveLength(2);

    const first = within(cards[0]);
    expect(first.getByRole('button', { name: 'Joel Lindberg' })).toBeInTheDocument();
    expect(first.getByText('Outdoor')).toBeInTheDocument();
    expect(first.getByText('19 °C')).toBeInTheDocument();
    expect(first.getByText('Strava')).toBeInTheDocument();
    expect(first.getByText('8.0 km')).toBeInTheDocument();
    expect(first.getByText('+44 XP')).toBeInTheDocument();
    expect(first.getAllByRole('listitem').map((cell) => cell.textContent)).toEqual([
      '12streak day', '1.8×multiplier', '15base xp', '16km xp', '+5bonus',
    ]);
    expect(cards[0]).toHaveAttribute('data-me', 'true');
    expect(cards[1]).not.toHaveAttribute('data-me');

    const second = within(cards[1]);
    expect(second.getByText('Treadmill')).toBeInTheDocument();
    expect(second.getByText('Manual')).toBeInTheDocument();
    expect(primaryButtons(container)).toHaveLength(0);
  });

  it('inga emojis i vädret — ikon eller text', async () => {
    setup({ history: [historyItem({ weather_code: 61, temperature_c: 12 })] });
    renderLog('/log?view=group');
    await screen.findByRole('list', { name: 'Runs in the pack' });
    expect(screen.getByText('12 °C · Rain')).toBeInTheDocument();
  });

  it('Show more hämtar nästa sida (offset) och försvinner när allt är hämtat', async () => {
    setup({ history: manyRuns(25) });
    const { container } = renderLog('/log?view=group');
    await screen.findByRole('list', { name: 'Runs in the pack' });
    expect(container.querySelectorAll('.rq-log-run')).toHaveLength(10);
    expect(historyCalls).toEqual([[10, 0]]);

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(container.querySelectorAll('.rq-log-run')).toHaveLength(20));
    expect(historyCalls).toEqual([[10, 0], [10, 10]]);

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(container.querySelectorAll('.rq-log-run')).toHaveLength(25));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('en sida som inte går att hämta lämnar raderna kvar och visar ett felkort med Retry', async () => {
    setup({ history: manyRuns(25) });
    const { container } = renderLog('/log?view=group');
    await screen.findByRole('list', { name: 'Runs in the pack' });
    const working = handlers.getGroupRunHistoryPage;
    handlers.getGroupRunHistoryPage = () => ({ success: false, error: 'boom' });
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText("Couldn't load more runs", undefined, SLOW)).toBeInTheDocument();
    expect(container.querySelectorAll('.rq-log-run')).toHaveLength(10);

    handlers.getGroupRunHistoryPage = working;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelectorAll('.rq-log-run')).toHaveLength(20));
  });

  it('tomt: streckat tomt läge med en väg tillbaka till formuläret', async () => {
    setup({ history: [] });
    renderLog('/log?view=group');
    expect(await screen.findByRole('heading', { name: 'No runs yet', level: 2 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Log a run' }));
    expect(location()).toBe('/log');
  });

  it('fel: felkort med Retry som hämtar om', async () => {
    let fail = true;
    handlers.getGroupRunHistoryPage = () => (fail ? { success: false, error: 'boom' } : { success: true, data: historyPage([historyItem()], 1) });
    renderLog('/log?view=group');
    expect(await screen.findByText("Couldn't load the group history", undefined, SLOW)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Runs in the pack' })).toBeInTheDocument();
  });

  it('ett namn öppnar Runner card', async () => {
    setup({ history: [historyItem()] });
    renderLog('/log?view=group');
    await screen.findByRole('list', { name: 'Runs in the pack' });
    fireEvent.click(screen.getByRole('button', { name: 'Karl Persson' }));
    expect(location()).toBe('/runner/u-karl');
  });
});

describe('Log — desktop', () => {
  it('desktopvarianten: egen undertext, hjälptexter synliga, ingen Strava-rad och fortfarande en guldknapp', async () => {
    const { container } = renderLog('/log', DESKTOP);
    expect(await screen.findByText('Strava syncs automatically · manual entry for treadmills')).toBeInTheDocument();
    expect(screen.getByText('From 1 June 2025 onwards')).toHaveClass('rq-log-note');
    expect(screen.getByText('Minimum 1.0 km to count')).toHaveClass('rq-log-note');
    expect(screen.queryByText('Strava connected')).toBeNull();
    expect(primaryButtons(container).map((button) => button.textContent)).toEqual(['Log run']);
  });

  it('Estimated XP och effekterna fungerar likadant på desktop', async () => {
    renderLog('/log', DESKTOP);
    await screen.findByText('Enter a distance');
    type('8');
    const gained = calculateCompleteRunXP(8, 5, XP_CONFIG.settings, XP_CONFIG.streak_multipliers).finalXP;
    expect(xpCard().getByText(`~${gained}`)).toBeInTheDocument();
    expect(effects().getByText('Stays alive · day 5')).toBeInTheDocument();
  });

  it('Group history på desktop är samma kort, och ingen guldknapp', async () => {
    setup({ history: manyRuns(2) });
    const { container } = renderLog('/log?view=group', DESKTOP);
    await screen.findByRole('list', { name: 'Runs in the pack' });
    expect(container.querySelectorAll('.rq-log-run')).toHaveLength(2);
    expect(primaryButtons(container)).toHaveLength(0);
  });
});
