import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { Run, User, UserTitle } from '@runquest/types';
import type { ChallengeHistoryItem, HeadToHeadResponse } from '@runquest/shared';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { getLevelFromXP, getXPForLevel } from '@/shared/services/levelService';
import { AppRoutes } from '@/routes';
import RunnerRoute from './RunnerPage';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

const MOBILE = 390;
const DESKTOP = 1280;

// Fast klocka: söndag 2026-10-04 12:00 Stockholm (CEST) = 10:00 UTC. Bara Date fejkas så waitFor/timers lever.
const NOW = new Date('2026-10-04T10:00:00Z');
// Queries gör ett snabbt omförsök (~1 s) före felkortet.
const SLOW = { timeout: 4000 };

const location = () => screen.getByTestId('location').textContent;

const run = (date: string, extra: Partial<Run> = {}): Run => ({
  id: `r-${date}-${extra.distance ?? 5}-${extra.start_time ?? ''}`, user_id: 'u-karl', date, distance: 5, xp_gained: 120, multiplier: 1,
  streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, ...extra,
});

const runner = (over: Partial<User> & Pick<User, 'id' | 'name' | 'total_xp'>): User => ({
  ...ME, total_km: 100, current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 0, runs: [], challenge_counts: {}, ...over,
});

// Karl: söndagslöpare med ett dubbelpass i dag (05:00Z och 10:00Z = 5 h isär), streak 8 som lever.
const KARL = runner({
  id: 'u-karl', name: 'Karl Persson', total_xp: 5539, total_km: 46.2, current_streak: 8, longest_streak: 31, wins: 0, losses: 2,
  runs: [
    run('2026-10-04', { distance: 8.4, start_time: '2026-10-04T05:00:00Z' }),
    run('2026-10-04', { distance: 5, start_time: '2026-10-04T10:00:00Z' }),
    run('2026-09-20', { distance: 32.8 }),
  ],
});
// Adam har gått långt (för Frodo): 988.4 km = Doors of Durin.
const ADAM = runner({ id: 'u-adam', name: 'Adam Einstein', total_xp: 4736, total_km: 988.4, current_streak: 0, longest_streak: 19 });
const PACK = [ME, KARL, ADAM];

const ut = (over: Partial<UserTitle> & Pick<UserTitle, 'title_id' | 'title_name'>): UserTitle => ({
  title_description: '', position: 1, value: 0, earned_at: '', is_current_holder: true, status: 'holder', ...over,
});
const entry = (id: string, metric: string, holder: { name: string; value: number }): TitleLeaderboard => ({
  id, name: id, description: '', unlock_requirement: 0, metric_key: metric,
  holder: { user_id: 'h', user_name: holder.name, value: holder.value, earned_at: '' }, runners_up: [],
});

const KARL_TITLES: UserTitle[] = [
  ut({ title_id: 't-rooster', title_name: 'The Rooster', value: 56 }),
  ut({ title_id: 't-long', title_name: 'The Longest Run', value: 32.8 }),
  ut({ title_id: 't-batman', title_name: 'The Batman', value: 11, position: 2, is_current_holder: false, status: 'runner_up' }),
];
const TITLE_BOARD: TitleLeaderboard[] = [
  entry('t-rooster', 'earlyRunCount', { name: 'Karl Persson', value: 56 }),
  entry('t-long', 'longestRun', { name: 'Karl Persson', value: 32.8 }),
  entry('t-batman', 'nightRunCount', { name: 'Nicklas von Elling', value: 18 }),
];

const party = (id: string, name: string) => ({ id, name, profile_picture: null, level: 20 });
const boost = { type: 'multiplier_days', delta: 0.2, duration: 4 };
const duel = (over: Partial<ChallengeHistoryItem>): ChallengeHistoryItem => ({
  id: 'c1', tier: 'minor', metric: 'km', duration_days: 7, start_date: '2026-09-20', end_date: '2026-09-27', ended_at: '2026-09-27T21:00:00Z',
  outcome: 'challenger_wins', winner_id: ME.id, challenger: party(ME.id, ME.name), opponent: party('u-karl', 'Karl Persson'),
  challenger_value: 42.1, opponent_value: 37, winner_boost: boost, loser_boost: boost, ...over,
});
const H2H: HeadToHeadResponse = {
  opponent: { id: 'u-karl', name: 'Karl Persson', profile_picture: null },
  record: { wins: 2, draws: 0, losses: 1, total: 3 },
  history: [
    duel({ id: 'a' }),
    duel({ id: 'b', metric: 'runs', duration_days: 5, outcome: 'opponent_wins', winner_id: 'u-karl', challenger_value: 4, opponent_value: 6, ended_at: '2026-09-10T21:00:00Z' }),
  ],
  active: null,
};

function renderRunner(entry = '/runner/u-karl', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/runner/:id" element={<RunnerRoute presentation="page" />} />
      <Route path="/duels" element={<div>Duels page</div>} />
      <Route path="/board" element={<div>Board page</div>} />
      <Route path="/profile" element={<div>Profile page</div>} />
    </Routes>,
    { entry, width },
  );
}

beforeEach(() => {
  resetFakeBackend();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
  handlers.getUserTitles = (id: unknown) => ({ success: true, data: id === 'u-karl' ? KARL_TITLES : [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: TITLE_BOARD });
  handlers.getHeadToHead = () => ({ success: true, data: H2H });
});
afterEach(() => vi.useRealTimers());

describe('hjältekortet', () => {
  it('namn, rank, rundor och "N XP to level M" — plus nivåringen med en läsbar etikett', async () => {
    renderRunner();

    expect(await screen.findByRole('heading', { level: 1, name: 'Karl Persson' })).toBeInTheDocument();
    expect(screen.getByText('#1 in the group · 3 runs')).toBeInTheDocument();

    const level = getLevelFromXP(5539);
    const toNext = getXPForLevel(level + 1) - 5539;
    expect(screen.getByText(`${toNext.toLocaleString('sv-SE')} XP to level ${level + 1}`)).toBeInTheDocument();

    const ring = screen.getByRole('img', { name: new RegExp(`^Level ${level}, \\d+% of the way to level ${level + 1}$`) });
    expect(ring).toHaveTextContent(String(level));
    expect(ring.style.getPropertyValue('--rq-ring-p')).toMatch(/^[\d.]+turn$/);
  });

  it('statcellerna: total xp · total km · challenges W–L (röd när förlusterna leder)', async () => {
    const { container } = renderRunner();
    await screen.findByRole('heading', { level: 1, name: 'Karl Persson' });

    const cell = (key: string) => container.querySelector(`.rq-runner-cells [data-cell="${key}"]`) as HTMLElement;
    expect(within(cell('xp')).getByText('total xp')).toBeInTheDocument();
    expect(cell('xp').querySelector('dd')?.textContent?.replace(/\s/g, '')).toBe('5539');
    expect(cell('km').querySelector('dd')).toHaveTextContent('46.2');
    expect(cell('challenges').querySelector('dd')).toHaveTextContent('0–2');
    expect(cell('challenges').querySelector('dd')).toHaveAttribute('data-tone', 'down');
    // Mobil = tre celler (App Prototype).
    expect(container.querySelectorAll('.rq-runner-cells > div')).toHaveLength(3);
  });

  it('desktop: fem celler (Web Prototype) — även rundor och innehavda titlar', async () => {
    const { container } = renderRunner('/runner/u-karl', DESKTOP);
    await screen.findByRole('heading', { level: 1, name: 'Karl Persson' });

    expect(container.querySelectorAll('.rq-runner-cells > div')).toHaveLength(5);
    const titles = container.querySelector('.rq-runner-cells [data-cell="titles"] dd');
    await waitFor(() => expect(titles).toHaveTextContent('2')); // The Rooster + The Longest Run (Batman är runner-up)
    expect(container.querySelector('.rq-runner-cells [data-cell="runs"] dd')).toHaveTextContent('3');
  });
});

describe('Frodo\'s journey', () => {
  it('mobil: enkel stapel med procent, Shire/Moria/Mordor och senaste checkpoint', async () => {
    renderRunner('/runner/u-adam');

    const journey = await screen.findByRole('region', { name: "Frodo's journey" });
    expect(within(journey).getByText('30.3%')).toBeInTheDocument();
    expect(within(journey).getByText('Doors of Durin')).toBeInTheDocument();
    expect(within(journey).getByText('Shire')).toBeInTheDocument();
    expect(within(journey).getByText('Mordor')).toBeInTheDocument();
    const bar = within(journey).getByRole('progressbar', { name: 'Progress to Mount Doom' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect((bar as HTMLElement).style.getPropertyValue('--w')).toMatch(/^30\.2\d*%$/);
    // Ingen zoomknapp i mobilvarianten.
    expect(within(journey).queryByRole('button')).toBeNull();
  });

  it('desktop: zoomknappen växlar Overview → Zoomed → Close-up → Overview och byter vägens etiketter', async () => {
    renderRunner('/runner/u-adam', DESKTOP);
    const journey = await screen.findByRole('region', { name: "Frodo's journey" });

    // Overview: bara stora mål på vägen, hela vägen från The Shire till Mordor.
    const road = journey.querySelector('.rq-runner-road') as HTMLElement;
    expect(within(road).getByText('Rivendell')).toBeInTheDocument();
    expect(within(road).queryByText('Doors of Durin')).toBeNull();
    expect(within(road).getByText('The Shire')).toBeInTheDocument();
    expect(within(road).getByText('Mordor')).toBeInTheDocument();
    expect(within(journey).getByText(/30\.3% · 988 \/ 3.266 km/)).toBeInTheDocument();

    fireEvent.click(within(journey).getByRole('button', { name: 'Overview' }));
    expect(within(journey).getByRole('button', { name: 'Zoomed' })).toBeInTheDocument();
    expect(within(road).getByText('Moria')).toBeInTheDocument();
    expect(within(road).getByText('388 km')).toBeInTheDocument(); // 988 − 600

    fireEvent.click(within(journey).getByRole('button', { name: 'Zoomed' }));
    expect(within(journey).getByRole('button', { name: 'Close-up' })).toBeInTheDocument();
    expect(within(road).getByText('Doors of Durin')).toBeInTheDocument();
    expect(within(road).getByText('788 km')).toBeInTheDocument(); // 988 − 200

    fireEvent.click(within(journey).getByRole('button', { name: 'Close-up' }));
    expect(within(journey).getByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });

  it('0 km: ingen zoomknapp och checkpointen är The Shire', async () => {
    handlers.getUsersWithRuns = () => ({
      success: true,
      data: [ME, { ...ADAM, total_km: 0 }],
    });
    renderRunner('/runner/u-adam', DESKTOP);
    const fresh = await screen.findByRole('region', { name: "Frodo's journey" });
    expect(within(fresh).queryByRole('button')).toBeNull();
    expect(within(fresh).getByText('The Shire', { selector: '.rq-runner-journey__cp' })).toBeInTheDocument();
  });

  it('framme: målmeddelande och ingen zoomknapp', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [ME, { ...KARL, total_km: 3300 }] });
    renderRunner('/runner/u-karl', DESKTOP);
    const journey = await screen.findByRole('region', { name: "Frodo's journey" });
    expect(within(journey).getByText('Mount Doom reached — the Ring is destroyed.')).toBeInTheDocument();
    expect(within(journey).queryByRole('button')).toBeNull();
  });
});

describe('statflikarna (?view=)', () => {
  const rows = (panel: HTMLElement) =>
    Object.fromEntries([...panel.querySelectorAll('.rq-runner-row')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]));

  it('Distance är default: longest, total, average och this month', async () => {
    renderRunner();
    const tabs = await screen.findByRole('tablist', { name: 'Runner stats' });
    expect(within(tabs).getByRole('tab', { name: 'Distance' })).toHaveAttribute('aria-selected', 'true');

    const panel = screen.getByRole('tabpanel');
    expect(rows(panel)).toEqual({
      'Longest run': '32.80 km', Total: '46.2 km', 'Average per run': '15.4 km', 'This month': '13.4 km',
    });
    expect(panel).toHaveAttribute('aria-labelledby', 'runner-stats-tab-distance');
  });

  it('Streak: nuvarande, bästa, multiplikator och nästa steg — trappan ur /config/xp', async () => {
    renderRunner();
    fireEvent.click(await screen.findByRole('tab', { name: 'Streak' }));

    await waitFor(() => expect(rows(screen.getByRole('tabpanel'))).toEqual({
      Current: '8 days', Best: '31 days', Multiplier: '1.5×', 'Next tier at': '14 days · 1.8×',
    }));
    expect(location()).toBe('/runner/u-karl?view=streak');
  });

  it('Fun facts: marathon-ekvivalenter, dubbelpass (4 h-regeln) och favoritdag', async () => {
    renderRunner('/runner/u-karl?view=fun');
    const panel = await screen.findByRole('tabpanel');

    expect(screen.getByRole('tab', { name: 'Fun facts' })).toHaveAttribute('aria-selected', 'true');
    expect(rows(panel)).toEqual({
      'Marathon equivalents total': '1',
      'Marathon equivalents 2026': '1',
      'Double-run days': '1',
      'Favourite day to run': 'Sunday',
    });
  });

  it('okänt värde (inkl. consistency, som hör till egna profilen) faller tillbaka på Distance', async () => {
    renderRunner('/runner/u-karl?view=consistency');
    await screen.findByRole('tablist', { name: 'Runner stats' });
    expect(screen.getByRole('tab', { name: 'Distance' })).toHaveAttribute('aria-selected', 'true');
  });

  it('piltangenter flyttar flik och skriver adressen', async () => {
    renderRunner();
    const distance = await screen.findByRole('tab', { name: 'Distance' });
    fireEvent.keyDown(distance, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Streak' })).toHaveAttribute('aria-selected', 'true'));
    expect(location()).toBe('/runner/u-karl?view=streak');
  });

  it('Streak: felar config-endpointen → felkort med Retry som hämtar om', async () => {
    let fail = true;
    handlers.getXpConfig = () => (fail ? { success: false, error: 'boom' } : { success: true, data: { settings: {}, streak_multipliers: [{ days: 7, multiplier: 1.5 }] } });
    renderRunner('/runner/u-karl?view=streak');

    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText("Couldn't load streak tiers")).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rows(screen.getByRole('tabpanel')).Multiplier).toBe('1.5×'), SLOW);
  });
});

describe('titlar', () => {
  it('"TITLES HELD · N held" med värden i rätt enhet, och Runner-up med innehavare och avstånd', async () => {
    renderRunner();

    const section = await screen.findByRole('region', { name: 'Titles' });
    expect(await within(section).findByText('2 held')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'TITLES HELD' })).toBeInTheDocument();

    const held = within(within(section).getByRole('list', { name: 'Titles held' })).getAllByRole('listitem');
    expect(held.map((item) => item.textContent)).toEqual(['The Rooster56 runs', 'The Longest Run32.8 km']);

    expect(within(section).getByRole('heading', { name: 'Runner-up · 1' })).toBeInTheDocument();
    const [batman] = within(within(section).getByRole('list', { name: 'Runner-up titles' })).getAllByRole('listitem');
    expect(batman).toHaveTextContent('The Batman');
    expect(batman).toHaveTextContent('held by Nicklas von Elling');
    expect(batman).toHaveTextContent('7 runs'); // 18 − 11
  });

  it('inga titlar → anteckning, inte en tom ruta', async () => {
    renderRunner('/runner/u-adam');
    expect(await screen.findByText('No titles yet — Adam is still chasing the first one.')).toBeInTheDocument();
  });

  it('bara runner-up: "No titles held yet." ovanför runner-up-listan', async () => {
    handlers.getUserTitles = () => ({ success: true, data: [KARL_TITLES[2]] });
    renderRunner();
    expect(await screen.findByText('No titles held yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Runner-up · 1' })).toBeInTheDocument();
  });

  it('laddning: stadion-ovalen med skärmläsartext', async () => {
    handlers.getUserTitles = () => new Promise(() => {});
    renderRunner();
    const section = await screen.findByRole('region', { name: 'Titles' });
    expect(within(section).getByText('Loading titles')).toBeInTheDocument();
  });

  it('fel → felkort med Retry (inte "inga titlar") som hämtar om', async () => {
    let fail = true;
    handlers.getUserTitles = () => (fail ? { success: false, error: 'boom' } : { success: true, data: KARL_TITLES });
    renderRunner();

    const section = await screen.findByRole('region', { name: 'Titles' });
    expect(await within(section).findByText("Couldn't load titles", undefined, SLOW)).toBeInTheDocument();
    expect(within(section).queryByText(/No titles/)).toBeNull();

    fail = false;
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(await within(section).findByText('2 held', undefined, SLOW)).toBeInTheDocument();
  });
});

describe('head to head', () => {
  it('rekordet ur ditt perspektiv (you won · drawn · you lost) och senaste mötena', async () => {
    renderRunner();

    const section = await screen.findByRole('region', { name: 'Head to head' });
    await waitFor(() => {
      const cells = [...section.querySelectorAll('.rq-runner-record > div')].map((cell) => [cell.querySelector('dt')?.textContent, cell.querySelector('dd')?.textContent]);
      expect(cells).toEqual([['you won', '2'], ['drawn', '0'], ['you lost', '1']]);
    });

    const meetings = within(within(section).getByRole('list', { name: 'Latest meetings' })).getAllByRole('listitem');
    expect(meetings).toHaveLength(2);
    expect(meetings[0]).toHaveTextContent('WonMost km · 7 days42.1 km – 37.0 km27 Sep');
    expect(meetings[1]).toHaveTextContent('LostMost runs · 5 days4 runs – 6 runs10 Sep');
  });

  it('hämtar med löparens id och ett kompakt antal möten', async () => {
    const spy = vi.fn(() => ({ success: true, data: H2H }));
    handlers.getHeadToHead = spy;
    renderRunner();
    await screen.findByRole('list', { name: 'Latest meetings' });
    expect(spy).toHaveBeenCalledWith('u-karl', 5);
  });

  it('inga möten ännu: nollor och en rad om det', async () => {
    handlers.getHeadToHead = () => ({ success: true, data: { ...H2H, record: { wins: 0, draws: 0, losses: 0, total: 0 }, history: [] } });
    renderRunner();
    expect(await screen.findByText('No duels against Karl yet.')).toBeInTheDocument();
  });

  it('laddning: stadion-ovalen med skärmläsartext', async () => {
    handlers.getHeadToHead = () => new Promise(() => {});
    renderRunner();
    const section = await screen.findByRole('region', { name: 'Head to head' });
    expect(within(section).getByText('Loading head to head')).toBeInTheDocument();
  });

  it('fel → felkort med Retry; kortet i övrigt (och Challenge) fungerar ändå', async () => {
    let fail = true;
    handlers.getHeadToHead = () => (fail ? { success: false, error: 'boom' } : { success: true, data: H2H });
    renderRunner();

    const section = await screen.findByRole('region', { name: 'Head to head' });
    expect(await within(section).findByText("Couldn't load head to head", undefined, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Challenge' })).toBeInTheDocument();

    fail = false;
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(await within(section).findByRole('list', { name: 'Latest meetings' }, SLOW)).toBeInTheDocument();
  });
});

describe('Challenge-knappen', () => {
  it('länkar till /duels?send=1&opponent=<id> och navigerar dit', async () => {
    renderRunner();
    const link = await screen.findByRole('link', { name: 'Challenge' });
    expect(link).toHaveAttribute('href', '/duels?send=1&opponent=u-karl');

    fireEvent.click(link);
    await waitFor(() => expect(location()).toBe('/duels?send=1&opponent=u-karl'));
  });

  it('Challenge är en sekundärknapp (guld-hårlinje) — inga fyllda guldknappar på kortet', async () => {
    const { container } = renderRunner();
    await screen.findByRole('link', { name: 'Challenge' });
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Challenge' })).toHaveClass('rq-btn--secondary');
  });

  it.each([
    ['pending', 'Challenge pending'],
    ['active', 'Challenge live'],
  ] as const)('redan en %s utmaning mot löparen: statuschip (%s) i stället för knapp', async (status, label) => {
    handlers.getHeadToHead = () => ({ success: true, data: { ...H2H, active: { id: 'x', status, challenger_id: ME.id } } });
    renderRunner();

    const chip = await screen.findByText(label);
    expect(chip).toHaveClass('rq-chip--status', 'rq-chip--duel');
    expect(screen.queryByRole('link', { name: 'Challenge' })).toBeNull();
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  });
});

describe('ramen: sida respektive overlay', () => {
  it('mobil/sida: Back-knapp, ingen "Runner profile"-rubrik och ingen dialog', async () => {
    renderRunner();
    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(screen.queryByText('Runner profile')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Back går ett steg tillbaka, eller till /board utan historik', async () => {
    renderRunner();
    fireEvent.click(await screen.findByRole('button', { name: /Back/ }));
    await waitFor(() => expect(location()).toBe('/board'));
  });

  it('egen profil: /runner/<eget id> → /profile (inget head-to-head mot sig själv)', async () => {
    renderRunner(`/runner/${ME.id}`);
    await waitFor(() => expect(location()).toBe('/profile'));
    expect(screen.queryByRole('region', { name: 'Head to head' })).toBeNull();
  });
});

describe('desktop-overlayn (background location)', () => {
  const fromBoard = [
    '/board',
    { pathname: '/runner/u-karl', state: { background: { pathname: '/board', search: '', hash: '', state: null, key: 'bg' } } },
  ];

  it('samma kort i dialogen: "Runner profile", Challenge, hjältekort, paneler', async () => {
    renderWithApp(<AppRoutes />, { entry: fromBoard, width: DESKTOP });

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('heading', { level: 1, name: 'Karl Persson' })).toBeInTheDocument();
    expect(within(dialog).getByText('Runner profile')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Challenge' })).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: "Frodo's journey" })).toBeInTheDocument();
    expect(within(dialog).getByRole('tablist', { name: 'Runner stats' })).toBeInTheDocument();
    expect(await within(dialog).findByRole('region', { name: 'Head to head' })).toBeInTheDocument();
  });

  it('flikbyte i overlayn behåller overlayn och bakgrundssidan (router-state följer med ?view=)', async () => {
    renderWithApp(<AppRoutes />, { entry: fromBoard, width: DESKTOP });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('tab', { name: 'Fun facts' }));
    await waitFor(() => expect(location()).toBe('/runner/u-karl?view=fun'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('tab', { name: 'Fun facts' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelectorAll('[data-shell="desktop"]')).toHaveLength(1);
    // Radix döljer bakgrunden för hjälpmedel medan dialogen är öppen, därför hidden: true.
    expect(screen.getByRole('heading', { name: 'The standings', hidden: true })).toBeInTheDocument();
  });

  it('Challenge i overlayn stänger den och landar på /duels med förvald motståndare', async () => {
    renderWithApp(<AppRoutes />, { entry: fromBoard, width: DESKTOP });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('link', { name: 'Challenge' }));
    await waitFor(() => expect(location()).toBe('/duels?send=1&opponent=u-karl'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
