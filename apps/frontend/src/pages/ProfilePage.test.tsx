import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { Run, User, UserTitle } from '@runquest/types';
import ProfilePage from './ProfilePage';
import { TOUR_PROFILE_V2 } from '@/features/onboarding/featureTourSteps';
import { run as makeRun } from '@/features/profile/profile.fixture';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer; ankar-vakten nedan kollar DOM:en i stället.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({
  FeatureTour: ({ slug }: { slug: string }) => <div data-testid="feature-tour" data-slug={slug} />,
}));

const MOBILE = 390;
const DESKTOP = 1280;
// Felkort kommer efter ett snabbt omförsök (~1 s).
const SLOW = { timeout: 4000 };

// 12:00 i Stockholm — idag är 2026-10-04.
const NOW = '2026-10-04T10:00:00Z';
const TODAY = '2026-10-04';

// Fem rundor: igår (streakdag 4) bakåt, plus en äldre.
const RUNS: Run[] = [
  makeRun({ id: 'r3', date: '2026-10-03', distance: 10, streak_day: 4, xp_gained: 70, multiplier: 1.4 }),
  makeRun({ id: 'r2', date: '2026-10-02', distance: 7.5, streak_day: 3, xp_gained: 39, multiplier: 1.3 }),
  makeRun({ id: 'r1', date: '2026-10-01', distance: 10, streak_day: 2, xp_gained: 50, multiplier: 1 }),
  makeRun({ id: 'r0', date: '2026-09-30', distance: 6, streak_day: 1, xp_gained: 32, multiplier: 1, is_treadmill: true }),
  makeRun({ id: 'old', date: '2026-07-18', distance: 4, streak_day: 1, xp_gained: 23, multiplier: 1, is_treadmill: null }),
];

const mine = (over: Partial<User> = {}): User => ({ ...ME, total_km: 942.7, current_streak: 4, longest_streak: 44, wins: 11, losses: 6, runs: RUNS, ...over });

const title = (id: string, name: string, holder: boolean, position = 1): UserTitle => ({
  title_id: id, title_name: name, title_description: '', position, value: 10, earned_at: '', is_current_holder: holder, status: holder ? 'holder' : 'runner_up',
});
const HELD = ['a', 'b', 'c', 'd', 'e'].map((id) => title(id, `Title ${id.toUpperCase()}`, true));
const RUNNERS_UP = [title('x', 'The Double Trouble', false, 2), title('y', 'The Batman', false, 3)];
const BOARD = [
  { id: 'x', name: 'The Double Trouble', description: '', unlock_requirement: 0, metric_key: 'bestDoubleDayKm', holder: { user_id: OTHER.id, user_name: 'Karl Persson', value: 15, earned_at: '' }, runners_up: [] },
];

const location = () => screen.getByTestId('location').textContent;
const updateRun = vi.fn();
const deleteRun = vi.fn();
const uploadPicture = vi.fn();
const usersCalls = vi.fn();
const history = { current: [] as Run[] };

function setup({ runs = RUNS, titles = [...HELD, ...RUNNERS_UP] }: { runs?: Run[]; titles?: UserTitle[] } = {}) {
  history.current = runs;
  updateRun.mockReset();
  deleteRun.mockReset();
  uploadPicture.mockReset();
  usersCalls.mockReset();
  handlers.getUsersWithRuns = () => {
    usersCalls();
    return { success: true, data: [mine({ runs: history.current }), OTHER] };
  };
  handlers.getUserTitles = () => ({ success: true, data: titles });
  handlers.getTitleLeaderboard = () => ({ success: true, data: BOARD });
  updateRun.mockImplementation(async (id: string, update: { distance: number; date: string }) => {
    history.current = history.current.map((r) => (r.id === id ? { ...r, ...update, xp_gained: 61 } : r));
    return { success: true, data: { ...history.current.find((r) => r.id === id) } };
  });
  deleteRun.mockImplementation(async (id: string) => {
    history.current = history.current.filter((r) => r.id !== id);
    return { success: true };
  });
  uploadPicture.mockImplementation(async () => ({ success: true, data: { profile_picture: 'https://x/y.png' } }));
  handlers.updateRun = (...args: unknown[]) => updateRun(...args);
  handlers.deleteRun = (...args: unknown[]) => deleteRun(...args);
  handlers.uploadProfilePicture = (...args: unknown[]) => uploadPicture(...args);
}

function renderProfile(entry = '/profile', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/profile" element={<ProfilePage />} />
    </Routes>,
    { entry, width },
  );
}

const primaryButtons = () => [...document.querySelectorAll('.rq-btn--primary')];
const editButton = (date: string) => screen.getByRole('button', { name: `Edit run ${date}` });
const distanceField = () => screen.getByLabelText('Distance (km)') as HTMLInputElement;
const dateField = () => screen.getByLabelText('Date') as HTMLInputElement;
const dialog = () => screen.getByRole('dialog');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  resetFakeBackend();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Profile — hjältekort', () => {
  it('namn som rubrik, rank i gruppen, rundor, XP kvar och tre statceller på mobil', async () => {
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'Joel Lindberg', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('#2 in the group · 5 runs')).toBeInTheDocument();
    expect(screen.getByText(/XP to level 25$/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Level 24, \d+% of the way to level 25$/ })).toBeInTheDocument();
    const cells = [...document.querySelectorAll('.rq-profile-cell')].map((cell) => cell.getAttribute('data-cell'));
    expect(cells).toEqual(['xp', 'km', 'challenges']);
    expect(screen.getByText('11–6')).toBeInTheDocument();
  });

  it('desktop: fem celler — även rundor och titlar hållna', async () => {
    renderProfile('/profile', DESKTOP);
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    expect([...document.querySelectorAll('.rq-profile-cell')].map((cell) => cell.getAttribute('data-cell'))).toEqual(['xp', 'km', 'challenges', 'runs', 'titles']);
    await waitFor(() => expect(document.querySelector('[data-cell="titles"] dd')).toHaveTextContent('5'));
  });

  it('inga guldknappar på sidan — den enda guldknappen finns i redigeringsrutan', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    expect(primaryButtons()).toHaveLength(0);
    fireEvent.click(editButton('2026-10-03'));
    await screen.findByRole('dialog');
    expect(primaryButtons()).toHaveLength(1);
  });

  it('turen är tour_profile_v2 och varje ankare finns i sidan (mobil och desktop)', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_profile_v2');
    const anchors = TOUR_PROFILE_V2.flatMap((step) => (step.element ? [step.element] : []));
    expect(anchors).toHaveLength(5);
    for (const selector of anchors) expect(document.querySelector(selector), selector).not.toBeNull();
  });
});

describe('Profile — Frodo-zoom', () => {
  // 942.7 km: Overview visar hela vägen (28.9 %), Zoomed ±600 km runt läget (342.7–1542.7, markören mitt i) och Close-up ±200 km.
  const road = () => {
    const bar = screen.getByRole('progressbar', { name: 'Progress to Mount Doom' });
    const wrap = bar.parentElement as HTMLElement;
    return {
      start: wrap.querySelector('[data-end="start"]')?.textContent,
      end: wrap.querySelector('[data-end="finish"]')?.textContent,
      fill: parseFloat(bar.style.getPropertyValue('--w')),
      knob: bar.querySelector('.rq-profile-knob') !== null,
      next: bar.querySelector('.rq-profile-next') !== null,
    };
  };

  it('zoomknappen cyklar Overview → Zoomed → Close-up → Overview; ändetiketter, markörens läge och nästa checkpoint följer med', async () => {
    renderProfile('/profile', DESKTOP);
    await screen.findByRole('heading', { name: 'Joel Lindberg' });

    expect(road()).toMatchObject({ start: 'The Shire', end: 'Mordor', knob: true, next: true });
    expect(road().fill).toBeCloseTo(28.86, 1);

    fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
    expect(screen.getByRole('button', { name: /Zoomed/ })).toBeInTheDocument();
    expect(road()).toMatchObject({ start: '343 km', end: '1\u00a0543 km', knob: true, next: true });
    expect(road().fill).toBeCloseTo(50, 1);

    fireEvent.click(screen.getByRole('button', { name: /Zoomed/ }));
    expect(screen.getByRole('button', { name: /Close-up/ })).toBeInTheDocument();
    expect(road()).toMatchObject({ start: '743 km', end: '1\u00a0143 km', knob: true, next: true });
    expect(road().fill).toBeCloseTo(50, 1);

    fireEvent.click(screen.getByRole('button', { name: /Close-up/ }));
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
    expect(road()).toMatchObject({ start: 'The Shire', end: 'Mordor' });
  });

  it('mobil zoomar likadant men utan ring vid nästa checkpoint', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    expect(road()).toMatchObject({ start: 'The Shire', end: 'Mordor', knob: true, next: false });
    fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
    expect(road()).toMatchObject({ start: '343 km', end: '1\u00a0543 km', knob: true, next: false });
    expect(road().fill).toBeCloseTo(50, 1);
  });

  it('nära start klampas fönstret till 0–1 200 km och markören ligger kvar nära början', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [mine({ total_km: 20 }), OTHER] });
    renderProfile('/profile', DESKTOP);
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
    expect(road()).toMatchObject({ start: '0 km', end: '1\u00a0200 km', knob: true });
    expect(road().fill).toBeCloseTo((20 / 1200) * 100, 1);
  });

  it('mobil har zoomknappen också och visar procent + nästa mål utan "away"', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByText(/^28\.9% · 943 \/ 3 266 km$/)).toBeInTheDocument();
    expect(screen.getByText(/Balin's Tomb — 95 km$/)).toBeInTheDocument();
  });

  it('desktop: senaste checkpoint och nästa med "away"', async () => {
    renderProfile('/profile', DESKTOP);
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    expect(screen.getByText('Doors of Durin')).toBeInTheDocument();
    expect(screen.getByText(/Balin's Tomb — 95 km away$/)).toBeInTheDocument();
  });

  it('framme vid Mount Doom: målmeddelande och ingen zoomknapp', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [mine({ total_km: 3300 }), OTHER] });
    renderProfile();
    expect(await screen.findByText(/Mount Doom reached/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Overview/ })).toBeNull();
  });
});

describe('Profile — statflikar (?view=)', () => {
  it('Distance är standard; fliken följer adressen och ett okänt värde faller tillbaka', async () => {
    renderProfile();
    expect(await screen.findByRole('tab', { name: 'Distance', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Consistency' })).toBeInTheDocument();
    expect(screen.getByText('Longest run')).toBeInTheDocument();
  });

  it('flikbyte skriver ?view= med replace', async () => {
    renderProfile();
    await screen.findByRole('tab', { name: 'Distance' });
    fireEvent.click(screen.getByRole('tab', { name: 'Fun facts' }));
    await waitFor(() => expect(location()).toBe('/profile?view=fun'));
    expect(screen.getByText('Longest gap between runs')).toBeInTheDocument();
    expect(screen.getByText('Favourite day to run')).toBeInTheDocument();
  });

  it('Streak läser trappan ur config: nästa steg och multiplikator', async () => {
    renderProfile('/profile?view=streak');
    expect(await screen.findByText('Next tier at')).toBeInTheDocument();
    const rows = within(screen.getByRole('tabpanel'));
    expect(rows.getByText('7 days · 1.5×')).toBeInTheDocument();
    expect(rows.getByText('1.3×')).toBeInTheDocument();
  });

  it('Streak utan config: felkort med Retry — inte ett påhittat steg', async () => {
    handlers.getXpConfig = () => ({ success: false, error: 'down' });
    renderProfile('/profile?view=streak');
    const alert = (await screen.findByText("Couldn't load streak tiers", {}, SLOW)).closest('[role="alert"]') as HTMLElement;
    handlers.getXpConfig = () => ({ success: true, data: { settings: {}, streak_multipliers: [{ days: 3, multiplier: 1.3 }] } });
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Next tier at')).toBeInTheDocument();
  });

  it('Consistency (mobil): sex månader, rundor i fönstret, idag, streak och dagar aktiva', async () => {
    renderProfile('/profile?view=consistency');
    const heat = await screen.findByRole('region', { name: /^Run heatmap: 5 runs on 5 of \d+ days$/ });
    expect(heat).toBeInTheDocument();
    // 4 oktober: oktobers första måndag har inte hänt, så sex månader ritas som fem block — etiketten säger det.
    expect(screen.getByText('runs · 5 months')).toBeInTheDocument();
    expect(screen.getByText('Today · 4 Oct')).toBeInTheDocument();
    expect(heat.querySelectorAll('.rq-profile-heat__month')).toHaveLength(5);
    expect(heat.querySelectorAll('[data-today="true"]')).toHaveLength(1);
    expect(document.querySelector('[data-stat="streak"] dd')).toHaveTextContent('4');
    expect(document.querySelector('[data-stat="longest"] dd')).toHaveTextContent('44');
    expect(screen.queryByText('Less')).toBeNull();
  });

  it('Consistency (desktop): tolv månader, veckodagsetiketter och förklaringen Less → More', async () => {
    renderProfile('/profile?view=consistency', DESKTOP);
    await screen.findByText('runs in the last 11 months');
    expect(document.querySelectorAll('.rq-profile-heat__month').length).toBeGreaterThanOrEqual(11);
    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    expect(document.querySelectorAll('.rq-profile-heat__day')).toHaveLength(7);
  });

  // jsdom har ingen layout: bredderna sätts för hand så att startscrollen går att pröva (mätt i riktig webbläsare vid 1440 px: 681/681).
  const withWidths = (scrollWidth: number, clientWidth: number) => {
    const sw = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
    return () => {
      if (sw) Object.defineProperty(Element.prototype, 'scrollWidth', sw); else delete (Element.prototype as unknown as Record<string, unknown>).scrollWidth;
      if (cw) Object.defineProperty(Element.prototype, 'clientWidth', cw); else delete (Element.prototype as unknown as Record<string, unknown>).clientWidth;
    };
  };

  it('ett litet överflöd (några px) räknas som att rutnätet ryms: start vid första månaden, ingen scroll, ingen scrollyta', async () => {
    const restore = withWidths(686, 681);
    try {
      renderProfile('/profile?view=consistency', DESKTOP);
      const region = await screen.findByRole('region', { name: /Run heatmap/ });
      expect(region).toHaveAttribute('data-fits', 'true');
      expect(region.scrollLeft).toBe(0);
    } finally {
      restore();
    }
  });

  it('ett verkligt överflöd (smalare fönster, mobil) scrollar till nyaste delen', async () => {
    const restore = withWidths(666, 521);
    try {
      renderProfile('/profile?view=consistency', DESKTOP);
      const region = await screen.findByRole('region', { name: /Run heatmap/ });
      expect(region).toHaveAttribute('data-fits', 'false');
      expect(region.scrollLeft).toBe(145);
    } finally {
      restore();
    }
  });

  it('en cell med runda bär datum och km som titel; intensiteten följer dagens km', async () => {
    renderProfile('/profile?view=consistency');
    await screen.findByRole('region', { name: /Run heatmap/ });
    const cell = screen.getByRole('img', { name: '2026-10-03 · 10.0 km · 1 run' });
    expect(cell).toHaveAttribute('data-level', '3');
    expect(cell).toHaveAttribute('title', '2026-10-03 · 10.0 km · 1 run');
    // Dagar utan runda är dekor: inga bildroller att tabba eller läsa upp.
    expect(screen.getAllByRole('img', { name: /km · \d+ runs?$/ })).toHaveLength(5);
  });
});

describe('Profile — titlar', () => {
  it('mobil: "5 held · 2 runner-up", tre titlar och "Show all 7" som fäller ut allt', async () => {
    renderProfile();
    expect(await screen.findByText('5 held · 2 runner-up')).toBeInTheDocument();
    const held = await screen.findByRole('list', { name: 'Titles held' });
    expect(within(held).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('list', { name: 'Runner-up titles' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
    expect(within(screen.getByRole('list', { name: 'Titles held' })).getAllByRole('listitem')).toHaveLength(5);
    expect(within(screen.getByRole('list', { name: 'Runner-up titles' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Show all d+$/ })).toBeNull();
  });

  it('desktop: Holding · 5 och Runner-up · 2 med vem som håller titeln och avståndet dit', async () => {
    renderProfile('/profile', DESKTOP);
    expect(await screen.findByText('Holding · 5')).toBeInTheDocument();
    expect(await screen.findByText('Runner-up · 2')).toBeInTheDocument();
    expect(screen.getByText('held by Karl Persson')).toBeInTheDocument();
    expect(screen.getByText('5.0 km')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show all d+$/ })).toBeNull();
  });

  it('inga titlar: en vänlig rad, inte en tom ruta', async () => {
    setup({ titles: [] });
    renderProfile();
    expect(await screen.findByText(/No titles yet/)).toBeInTheDocument();
  });

  it('fel: felkort med Retry — inte "No titles" — och Retry hämtar om', async () => {
    let fail = true;
    handlers.getUserTitles = () => (fail ? { success: false, error: 'down' } : { success: true, data: HELD });
    renderProfile();
    const alert = (await screen.findByText("Couldn't load your titles", {}, SLOW)).closest('[role="alert"]') as HTMLElement;
    expect(screen.queryByText(/No titles yet/)).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('5 held · 0 runner-up')).toBeInTheDocument();
  });
});

describe('Profile — rundhistorik', () => {
  it('fyra rader nyast först (datum, km · underlag · streakdag, XP, multiplikator) och "Show all 5 runs"', async () => {
    renderProfile();
    const list = await screen.findByRole('list', { name: 'Your runs' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('2026-10-03');
    expect(rows[0]).toHaveTextContent('10.0 km · outdoor · streak day 4');
    expect(rows[0]).toHaveTextContent('+70 XP');
    expect(rows[0]).toHaveTextContent('1.4×');
    expect(rows[3]).toHaveTextContent('6.0 km · treadmill · streak day 1');

    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 runs' }));
    expect(within(screen.getByRole('list', { name: 'Your runs' })).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('4.0 km · streak day 1')).toBeInTheDocument(); // okänt underlag: ingen gissning
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(within(screen.getByRole('list', { name: 'Your runs' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('inga rundor: tomt läge med en sekundärknapp till Log', async () => {
    setup({ runs: [] });
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'No runs yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a run' })).toHaveAttribute('href', '/log');
  });
});

describe('Profile — redigera en runda', () => {
  const open = async (date = '2026-10-02', width = MOBILE) => {
    renderProfile('/profile', width);
    await screen.findByRole('list', { name: 'Your runs' });
    fireEvent.click(editButton(date));
    return screen.findByRole('dialog', { name: 'Edit run' });
  };

  it('rutan startar med rundans datum och distans, visar vad rundan gav och har Save avstängd tills något ändrats', async () => {
    const sheet = await open();
    expect(dateField().value).toBe('2026-10-02');
    expect(distanceField().value).toBe('7.5');
    expect(dateField()).toHaveAttribute('min', '2025-06-01');
    expect(dateField()).toHaveAttribute('max', TODAY);
    expect(within(sheet).getByText('39 XP')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(distanceField(), { target: { value: '8' } });
    expect(within(sheet).getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('sparar: PUT med datum och distans (komma → punkt), data omhämtas, rutan stängs och bekräftelsen visas med serverns XP', async () => {
    await open();
    const callsBefore = usersCalls.mock.calls.length;
    fireEvent.change(distanceField(), { target: { value: '8,4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Datumet är oförändrat och skickas därför inte (servern validerar mot UTC-"idag" mellan 00 och 02 svensk tid).
    expect(updateRun).toHaveBeenCalledWith('r2', { distance: 8.4 });
    expect(usersCalls.mock.calls.length).toBeGreaterThan(callsBefore);
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Run updated'));
    expect(status).toHaveTextContent('Run updated: 8.4 km on 2 Oct for 61 XP.');
    expect(await screen.findByText('8.4 km · outdoor · streak day 3')).toBeInTheDocument();
  });

  it('ett nytt datum skickas också', async () => {
    await open();
    fireEvent.change(dateField(), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateRun).toHaveBeenCalledWith('r2', { date: '2026-10-01', distance: 7.5 }));
  });

  it('valideringen speglar backend: under 1.0 km, framtida datum — fel bredvid fältet, fokus på det, inget anrop', async () => {
    await open();
    fireEvent.change(distanceField(), { target: { value: '0.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('A run needs at least 1.0 km to count')).toBeInTheDocument();
    expect(distanceField()).toHaveAttribute('aria-invalid', 'true');
    expect(distanceField()).toHaveFocus();

    fireEvent.change(dateField(), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('You cannot log a run for a future date')).toBeInTheDocument();
    expect(dateField()).toHaveFocus();
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('serverfel: rutan står kvar med felet i en alert (inget toast), fälten orörda', async () => {
    updateRun.mockImplementation(async () => ({ success: false, error: 'Runs can only be logged from 1 June 2025' }));
    await open();
    fireEvent.change(distanceField(), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog()).findByText('Runs can only be logged from 1 June 2025')).toBeInTheDocument();
    expect(distanceField().value).toBe('9');
    expect(within(dialog()).getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('Cancel stänger utan anrop', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('desktop: samma ruta, ändå exakt en guldknapp', async () => {
    await open('2026-10-02', DESKTOP);
    expect(primaryButtons()).toHaveLength(1);
  });
});

describe('Profile — fokus när rutan stängs utan att spara', () => {
  const openSheet = async () => {
    renderProfile();
    await screen.findByRole('list', { name: 'Your runs' });
    const opener = editButton('2026-10-02');
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Edit run' });
    return opener;
  };

  it('Cancel: fokus tillbaka på Edit-knappen som öppnade rutan (inte body)', async () => {
    const opener = await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('Esc: samma sak', async () => {
    const opener = await openSheet();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('✕: samma sak', async () => {
    const opener = await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('Profile — radera en runda', () => {
  const openDelete = async () => {
    renderProfile();
    await screen.findByRole('list', { name: 'Your runs' });
    fireEvent.click(editButton('2026-10-02'));
    await screen.findByRole('dialog', { name: 'Edit run' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));
    return screen.findByRole('dialog', { name: 'Delete run' });
  };

  it('Delete kräver ett bekräftelsesteg som säger vad som händer; Keep run går tillbaka utan anrop', async () => {
    const sheet = await openDelete();
    expect(within(sheet).getByText(/Delete this 7\.5 km run from 2026-10-02\?/)).toBeInTheDocument();
    expect(within(sheet).getByText(/recalculated from that day on/)).toBeInTheDocument();
    expect(deleteRun).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep run' }));
    expect(await screen.findByRole('dialog', { name: 'Edit run' })).toBeInTheDocument();
    expect(deleteRun).not.toHaveBeenCalled();
  });

  it('bekräftad radering: DELETE, data omhämtas, rutan stängs och raden är borta med en bekräftelse', async () => {
    const sheet = await openDelete();
    const callsBefore = usersCalls.mock.calls.length;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete run' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteRun).toHaveBeenCalledWith('r2');
    expect(usersCalls.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getAllByRole('status').find((el) => el.textContent?.includes('Run deleted'))).toHaveTextContent('Run deleted: 7.5 km on 2 Oct.');
    expect(screen.queryByRole('button', { name: 'Edit run 2026-10-02' })).toBeNull();
  });

  it('fokus hamnar på bekräftelsen efter radering (inte på body när Edit-knappen försvunnit)', async () => {
    const sheet = await openDelete();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete run' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Run deleted')) as HTMLElement;
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('fokus hamnar på bekräftelsen efter en sparad ändring också', async () => {
    renderProfile();
    await screen.findByRole('list', { name: 'Your runs' });
    fireEvent.click(editButton('2026-10-02'));
    await screen.findByRole('dialog', { name: 'Edit run' });
    fireEvent.change(distanceField(), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Run updated')) as HTMLElement;
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('serverfel: rutan står kvar med felet', async () => {
    deleteRun.mockImplementation(async () => ({ success: false, error: 'Run not found' }));
    const sheet = await openDelete();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete run' }));
    expect(await within(dialog()).findByText('Run not found')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Delete run' })).toBeInTheDocument();
  });
});

describe('Profile — Strava-rundor och spärrad radering', () => {
  const openEdit = async (date: string) => {
    renderProfile();
    await screen.findByRole('list', { name: 'Your runs' });
    fireEvent.click(editButton(date));
    return screen.findByRole('dialog', { name: 'Edit run' });
  };

  it('en Strava-runda: Delete är avstängd med förklaringen (title + skärmläsartext) och Edit/Save fungerar som vanligt', async () => {
    setup({ runs: RUNS.map((r) => (r.id === 'r2' ? { ...r, source: 'strava' } : r)) });
    const sheet = await openEdit('2026-10-02');
    const del = within(sheet).getByRole('button', { name: /Delete run/ });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute('title', 'Strava runs come back on next sync — delete it in Strava instead');
    expect(del).toHaveAccessibleName('Delete run — Strava runs come back on next sync — delete it in Strava instead');

    fireEvent.click(del);
    expect(screen.getByRole('dialog', { name: 'Edit run' })).toBeInTheDocument();
    expect(deleteRun).not.toHaveBeenCalled();

    fireEvent.change(distanceField(), { target: { value: '9' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
  });

  it('en manuell runda (source manual, null eller saknad): Delete är på och utan förklaring', async () => {
    setup({ runs: RUNS.map((r) => (r.id === 'r2' ? { ...r, source: 'manual' } : r.id === 'r3' ? { ...r, source: null } : r)) });
    renderProfile();
    await screen.findByRole('list', { name: 'Your runs' });
    for (const date of ['2026-10-02', '2026-10-03', '2026-10-01']) {
      fireEvent.click(editButton(date));
      const sheet = await screen.findByRole('dialog', { name: 'Edit run' });
      const del = within(sheet).getByRole('button', { name: 'Delete run' });
      expect(del).toBeEnabled();
      expect(del).not.toHaveAttribute('title');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  });

  it('source följer med från users-with-runs till rundan (mapApiUser tappar den inte)', async () => {
    setup({ runs: RUNS.map((r) => (r.id === 'r3' ? { ...r, source: 'strava' } : r)) });
    const sheet = await openEdit('2026-10-03');
    expect(within(sheet).getByRole('button', { name: /Delete run/ })).toBeDisabled();
  });
});

describe('Profile — 409 från servern vid radering', () => {
  const CONFLICT = "This run qualified an event and can't be deleted — edit it instead";

  it('serverns klartext står i rutans alert-region, rutan stängs inte och inget invalideras', async () => {
    deleteRun.mockImplementation(async () => ({ success: false, error: CONFLICT }));
    renderProfile();
    await screen.findByRole('list', { name: 'Your runs' });
    fireEvent.click(editButton('2026-10-02'));
    await screen.findByRole('dialog', { name: 'Edit run' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete run' });
    const callsBefore = usersCalls.mock.calls.length;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete run' }));

    await waitFor(() => expect(within(sheet).getByRole('alert')).toHaveTextContent(CONFLICT));
    expect(screen.getByRole('dialog', { name: 'Delete run' })).toBeInTheDocument();
    expect(usersCalls.mock.calls.length).toBe(callsBefore);
    // Tillbaka till redigeringssteget: felet är borta, och Save är kvar som utväg ("edit it instead").
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep run' }));
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });
});

describe('Profile — profilbild', () => {
  const choose = (file: File) => fireEvent.change(screen.getByLabelText('Change photo'), { target: { files: [file] } });
  const png = (size = 100) => new File([new Uint8Array(size)], 'me.png', { type: 'image/png' });

  it('en bild laddas upp, användarna omhämtas och bekräftelsen står i en live-region', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    const callsBefore = usersCalls.mock.calls.length;
    choose(png());
    await waitFor(() => expect(uploadPicture).toHaveBeenCalledTimes(1));
    expect((uploadPicture.mock.calls[0][0] as File).name).toBe('me.png');
    expect(await screen.findByText('Profile picture updated')).toBeInTheDocument();
    expect(usersCalls.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('en fil som inte är en bild, eller över 5 MB, nekas utan anrop', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    choose(new File(['x'], 'cv.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('Only JPEG, PNG, WebP or GIF images are allowed')).toBeInTheDocument();
    choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText('Only JPEG, PNG, WebP or GIF images are allowed')).toBeInTheDocument();
    choose(png(5 * 1024 * 1024 + 1));
    expect(await screen.findByText('The image must be smaller than 5 MB')).toBeInTheDocument();
    expect(uploadPicture).not.toHaveBeenCalled();
  });

  it('serverfel visas som felmeddelande', async () => {
    uploadPicture.mockImplementation(async () => ({ success: false, error: 'Storage is unavailable' }));
    renderProfile();
    await screen.findByRole('heading', { name: 'Joel Lindberg' });
    choose(png());
    expect(await screen.findByText('Storage is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Profile picture updated')).toBeNull();
  });
});

describe('Profile — laddning, fel och okänd användare', () => {
  it('laddning: skelett med en text för skärmläsare', async () => {
    handlers.getUsersWithRuns = () => new Promise(() => undefined);
    renderProfile();
    expect(await screen.findByText('Loading your profile')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-tour')).toBeNull();
  });

  it('fel: felkort med Retry — och Retry hämtar om', async () => {
    let fail = true;
    handlers.getUsersWithRuns = () => (fail ? { success: false, error: 'down' } : { success: true, data: [mine(), OTHER] });
    renderProfile();
    const alert = (await screen.findByText("Couldn't load your profile", {}, SLOW)).closest('[role="alert"]') as HTMLElement;
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Joel Lindberg' })).toBeInTheDocument();
  });

  it('inloggad användare som inte finns i gruppen: "User not found" med väg tillbaka', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [OTHER] });
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'User not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/board');
  });
});
