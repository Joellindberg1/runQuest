import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { Run, User, UserTitle } from '@runquest/types';
import BoardPage from './BoardPage';
import { TOUR_LEADERBOARD_V1 } from '@/features/onboarding/featureTourSteps';
import { ME, RANK_DELTA, WEEK, XP_CONFIG, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer; ankar-vakten nedan kollar DOM:en i stället.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({
  FeatureTour: ({ slug }: { slug: string }) => <div data-testid="feature-tour" data-slug={slug} />,
}));

const MOBILE = 390;
const DESKTOP = 1280;

// Fast klocka: 2026-10-04 12:00 Stockholm (CEST) = 10:00 UTC. Bara Date fejkas, så waitFor/timers lever.
const NOW = new Date('2026-10-04T10:00:00Z');

// Veckan och XP-configen gör ett snabbt omförsök (~1 s) före felkortet.
const SLOW = { timeout: 4000 };

const location = () => screen.getByTestId('location').textContent;

const run = (date: string, extra: Partial<Run> = {}): Run => ({
  id: `r-${date}-${extra.distance ?? 5}`, user_id: 'x', date, distance: 5, xp_gained: 120, multiplier: 1, streak_day: 1,
  base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, ...extra,
});

const runner = (id: string, name: string, xp: number, extra: Partial<User> = {}): User => ({
  ...ME, id, name, total_xp: xp, total_km: 500, current_streak: 0, longest_streak: 0, runs: [], challenge_counts: {}, ...extra,
});

const KARL = runner('u-karl', 'Karl Persson', 5539, {
  total_km: 988, current_streak: 8, longest_streak: 31, challenge_counts: { minor: 3, major: 1 },
  runs: [run('2026-10-04', { distance: 8.4, start_time: '2026-10-04T05:00:00Z' }), run('2026-09-20', { distance: 32.8 })],
});
const JOEL = runner('u-me', 'Joel Lindberg', 5243, {
  current_streak: 4, longest_streak: 44, challenge_counts: { minor: 2 }, runs: [run('2026-10-03', { distance: 10 })],
});
const ADAM = runner('u-adam', 'Adam Einstein', 4736, { current_streak: 1, longest_streak: 19, runs: [run('2026-10-02')] });
const NICKLAS = runner('u-nick', 'Nicklas von Elling', 4483, {
  current_streak: 3, longest_streak: 22, challenge_counts: { minor: 5, major: 1 }, runs: [run('2026-10-04')],
});
const DANIEL = runner('u-dan', 'Daniel Lindblad Lüthje', 2527, { longest_streak: 27 });
const PACK = [JOEL, KARL, ADAM, NICKLAS, DANIEL];

const rankDelta = (deltas: Record<string, number | null>) => ({
  success: true,
  data: { ...RANK_DELTA, users: Object.entries(deltas).map(([id, delta], i) => ({ user_id: id, xp: 0, rank: i + 1, previous_xp: 0, previous_rank: null, rank_delta: delta })) },
});

function renderBoard(entry = '/board', width = MOBILE, admin = false) {
  return renderWithApp(
    <Routes>
      <Route path="/board" element={<BoardPage />} />
      <Route path="/runner/:id" element={<div>Runner card</div>} />
    </Routes>,
    { entry, width, admin },
  );
}

beforeEach(() => {
  resetFakeBackend();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
  handlers.getRankDelta = () => rankDelta({ 'u-karl': 1, 'u-me': -1, 'u-adam': 0, 'u-nick': 2, 'u-dan': null });
});
afterEach(() => vi.useRealTimers());

describe('Season-vyn (default) — mobil', () => {
  it('visar podiet (topp 3) i rankordning och resten som lista', async () => {
    renderBoard();

    const first = await screen.findByTestId('podium-1');
    expect(within(first).getByRole('button', { name: 'Karl Persson' })).toBeInTheDocument();
    expect(within(screen.getByTestId('podium-2')).getByRole('button', { name: 'Joel Lindberg' })).toBeInTheDocument();
    expect(within(screen.getByTestId('podium-3')).getByRole('button', { name: 'Adam Einstein' })).toBeInTheDocument();
    expect(screen.queryByTestId('podium-4')).toBeNull();

    const rest = screen.getByRole('table', { name: 'Rest of the pack' });
    const rows = within(rest).getAllByRole('row').slice(1); // första raden = rubrikraden
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual(['Nicklas von Elling', 'Daniel Lindblad Lüthje']);
    expect(within(rows[0]).getByText('4')).toBeInTheDocument();
  });

  it('podiekortet: nivå + nivåframsteg, stats, xp-tempo, nästa nivå, challenge-ribbons och senaste runda', async () => {
    handlers.getUserTitles = (id: unknown) => ({
      success: true,
      data: id === 'u-karl'
        ? [{ title_id: 't1', title_name: 'The Double Trouble', title_description: '', position: 1, value: 14, earned_at: '', is_current_holder: true, status: 'holder' } satisfies UserTitle]
        : [],
    });
    renderBoard();

    const card = await screen.findByTestId('podium-1');
    expect(await within(card).findByText('The Double Trouble')).toBeInTheDocument();
    expect(within(card).getByText(/^Level \d+$/)).toBeInTheDocument();
    expect(within(card).getByText(/\d+ \/ \d+ XP/)).toBeInTheDocument();
    for (const label of ['km total', 'longest', 'runs', 'avg / run', 'xp pace', 'next lvl']) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).getByText('988')).toBeInTheDocument();
    expect(within(card).getByLabelText('Challenges to send: 3 minor, 1 major')).toBeInTheDocument();
    expect(within(card).getByText('4 left')).toBeInTheDocument();
    // start_time 05:00Z mot klockan 10:00Z.
    expect(within(card).getByText('Last run 5 h ago · 8.4 km')).toBeInTheDocument();
  });

  it('mobilkorten visar alla visade titlar, inte bara den första — på podiet och från plats 4', async () => {
    const held = (id: string, name: string): UserTitle => ({
      title_id: id, title_name: name, title_description: '', position: 1, value: 1, earned_at: '', is_current_holder: true, status: 'holder',
    });
    handlers.getUserTitles = (id: unknown) => ({
      success: true,
      data: id === 'u-karl'
        ? [held('t1', 'The Double Trouble'), held('t2', 'The Rooster'), held('t3', 'The Hamster')]
        : id === 'u-nick'
          ? [held('t4', 'The Batman'), held('t5', 'The Ghost')]
          : [],
    });
    renderBoard();

    const podium = await screen.findByTestId('podium-1');
    expect(await within(podium).findByText('The Double Trouble, The Rooster & The Hamster')).toBeInTheDocument();

    const rest = screen.getByRole('table', { name: 'Rest of the pack' });
    const nick = within(rest).getAllByRole('row')[1];
    expect(await within(nick).findByText('The Batman & The Ghost')).toBeInTheDocument();
    expect(within(within(rest).getAllByRole('row')[2]).getByText('No titles held yet')).toBeInTheDocument();
  });

  it('korten från plats 4 visar nivå och XP i nivån mot vad nivån kräver', async () => {
    renderBoard();
    await screen.findByTestId('podium-1');
    const rest = screen.getByRole('table', { name: 'Rest of the pack' });
    for (const row of within(rest).getAllByRole('row').slice(1)) {
      expect(within(row).getByText(/^Level \d+$/)).toBeInTheDocument();
      expect(within(row).getByText(/^\d[\d\s]* \/ \d[\d\s]* XP$|^Max level$/)).toBeInTheDocument();
    }
  });

  it('nivåframsteget ritas som stapel med --w = andel av nivån', async () => {
    const { container } = renderBoard();
    await screen.findByTestId('podium-1');
    const fill = container.querySelector('[data-testid="podium-1"] .rq-track > .rq-fill') as HTMLElement;
    expect(fill.style.getPropertyValue('--w')).toMatch(/^\d+%$/);
  });

  it('rank-delta-pilarnas riktning: ▲ upp, ▼ ner, — oförändrad/saknas', async () => {
    renderBoard();
    const karl = await screen.findByTestId('podium-1');
    expect(await within(karl).findByLabelText('Up 1 place')).toHaveTextContent('▲ 1');
    expect(within(screen.getByTestId('podium-2')).getByLabelText('Down 1 place')).toHaveTextContent('▼ 1');
    expect(within(screen.getByTestId('podium-3')).getByLabelText('No change')).toHaveTextContent('—');

    const rest = screen.getByRole('table', { name: 'Rest of the pack' });
    expect(within(rest).getByLabelText('Up 2 places')).toHaveTextContent('▲ 2');
    expect(within(rest).getByLabelText('No change')).toHaveTextContent('—'); // Daniel: rank_delta null
  });

  it('utan rank-delta (endpointen felar) ritas korten ändå, bara utan pilar', async () => {
    handlers.getRankDelta = () => ({ success: false, error: 'boom' });
    renderBoard();
    const karl = await screen.findByTestId('podium-1');
    expect(within(karl).getByLabelText('No change')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('utan titlar (titel-endpointen felar) ritas podiet ändå, utan felkort och utan titelrad', async () => {
    handlers.getUserTitles = () => ({ success: false, error: 'boom' });
    renderBoard();

    const karl = await screen.findByTestId('podium-1');
    expect(within(karl).getByRole('button', { name: 'Karl Persson' })).toBeInTheDocument();
    expect(within(karl).getByText(/^Level \d+$/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(karl).queryByText(/The Double Trouble/)).toBeNull();
  });

  it('klick på namn och på kortet öppnar Runner card (/runner/:id)', async () => {
    renderBoard();
    fireEvent.click(await screen.findByRole('button', { name: 'Karl Persson' }));
    await waitFor(() => expect(location()).toBe('/runner/u-karl'));
  });

  it('klick på kortytan (inte namnet) öppnar också Runner card', async () => {
    renderBoard();
    fireEvent.click(await screen.findByTestId('podium-2'));
    await waitFor(() => expect(location()).toBe('/runner/u-me'));
  });

  it('tom grupp → tomt läge med knapp till /log', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [] });
    renderBoard();
    expect(await screen.findByRole('heading', { name: 'No runners yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a run' })).toHaveAttribute('href', '/log');
  });
});

describe('Season-vyn — desktop (≥1024)', () => {
  it('Web-prototypens layout: podium 2·1·3 med sockel, tabell med silvertint-rubrikrad', async () => {
    const { container } = renderBoard('/board', DESKTOP);
    await screen.findByTestId('podium-1');

    const order = screen.getAllByTestId(/^podium-\d$/).map((card) => card.getAttribute('data-testid'));
    expect(order).toEqual(['podium-2', 'podium-1', 'podium-3']);
    expect(container.querySelectorAll('.rq-plinth')).toHaveLength(3);
    expect(screen.getAllByText('Challenges to send')).toHaveLength(3);
    expect(within(screen.getByTestId('podium-1')).getByText('Avg per run')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Rest of the pack' });
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['#', 'Runner', 'Level progress', 'Avg / run', 'XP / day', 'Next level', 'Last run']);
    expect(table.querySelector('.rq-table-head')).not.toBeNull();
  });

  it('exakt en variant: mobilens 3-kortslista finns inte på desktop och tvärtom', async () => {
    const { container, unmount } = renderBoard('/board', DESKTOP);
    await screen.findByTestId('podium-1');
    expect(container.querySelector('.rq-board-podium-list')).toBeNull();
    expect(container.querySelector('.rq-board-podium-row')).not.toBeNull();
    unmount();

    const mobile = renderBoard('/board', MOBILE);
    await screen.findByTestId('podium-1');
    expect(mobile.container.querySelector('.rq-board-podium-row')).toBeNull();
  });

  it('desktop: rubrikraden för titlar visar "No titles held yet" tills titlar finns', async () => {
    renderBoard('/board', DESKTOP);
    await screen.findByTestId('podium-1');
    expect(within(screen.getByTestId('podium-1')).getByText('No titles held yet')).toBeInTheDocument();
  });
});

describe('Week-vyn (?view=week)', () => {
  it('visar rader med km/runs/xp och rank_delta som form-pil', async () => {
    renderBoard('/board?view=week');

    const table = await screen.findByRole('table', { name: 'This week' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('button', { name: 'Karl Persson' })).toBeInTheDocument();
    expect(within(rows[0]).getByText('31.0 km · 4 runs')).toBeInTheDocument();
    expect(within(rows[0]).getByText('186')).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText('Up 1 place')).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText('Down 1 place')).toBeInTheDocument();
    expect(within(rows[1]).getByText('10.0 km · 1 run')).toBeInTheDocument();
  });

  it('dagstaplarnas höjdskala: längsta dagen i flocken = 100 %, övriga proportionellt, tom dag = 0', async () => {
    renderBoard('/board?view=week');
    const table = await screen.findByRole('table', { name: 'This week' });
    const heights = (row: HTMLElement) =>
      Array.from(row.querySelectorAll<HTMLElement>('.rq-daybar__fill')).map((bar) => bar.style.getPropertyValue('--h'));

    const [karl, joel] = within(table).getAllByRole('row').slice(1);
    // Karl [0,12,6,0,8,5,0] km mot längsta dagen 12 km; Joel 10 km på fredagen.
    expect(heights(karl)).toEqual(['0%', '100%', '50%', '0%', '67%', '42%', '0%']);
    expect(heights(joel)).toEqual(['0%', '0%', '0%', '0%', '83%', '0%', '0%']);
    expect(karl.querySelectorAll('.rq-daybar__fill')).toHaveLength(7);
    expect(Array.from(karl.querySelectorAll('.rq-daybar__label')).map((l) => l.textContent).join('')).toBe('MTWTFSS');
    // staplarna animeras en gång, förskjutna i steg (stagger via --rq-delay)
    const delays = Array.from(karl.querySelectorAll<HTMLElement>('.rq-daybar__fill')).map((bar) => bar.style.getPropertyValue('--rq-delay'));
    expect(new Set(delays).size).toBe(7);
  });

  it('Mover of the week, pack-totalen och "Week resets Monday"', async () => {
    renderBoard('/board?view=week');

    const mover = await screen.findByRole('region', { name: 'Mover of the week' });
    expect(within(mover).getByRole('heading', { name: 'Karl Persson' })).toBeInTheDocument();
    expect(within(mover).getByText(/Up 1 place on last week — 4 runs and 31\.0 km so far\./)).toBeInTheDocument();

    const pack = screen.getByRole('region', { name: 'Pack total this week' });
    expect(within(pack).getByText('148.6 km')).toBeInTheDocument();
    expect(within(pack).getByText('21 runs · 5 of 6 runners active')).toBeInTheDocument();
    expect(within(pack).getByText('82% of your best week')).toBeInTheDocument();
    expect(pack.querySelector<HTMLElement>('.rq-fill--pack')?.style.getPropertyValue('--w')).toBe('82%');

    expect(screen.getByText(/Week resets Monday 00:00/)).toBeInTheDocument();
  });

  it('ingen mover → inget Mover-kort', async () => {
    handlers.getWeekLeaderboard = () => ({ success: true, data: { ...WEEK, mover: null } });
    renderBoard('/board?view=week');
    await screen.findByRole('table', { name: 'This week' });
    expect(screen.queryByRole('region', { name: 'Mover of the week' })).toBeNull();
  });

  it('desktop: tabell med Form-kolumn och sidokolumn', async () => {
    renderBoard('/board?view=week', DESKTOP);
    const table = await screen.findByRole('table', { name: 'This week' });
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['#', 'Runner', 'Mon — Sun', 'Week XP', 'Form']);
    expect(screen.getByRole('region', { name: 'Pack total this week' })).toBeInTheDocument();
  });

  it('laddning: stadion-ovalen (helvy); fel: felkort med Retry som hämtar om', async () => {
    let calls = 0;
    let failing = true;
    handlers.getWeekLeaderboard = () => {
      calls += 1;
      return failing ? { success: false, error: 'boom' } : { success: true, data: WEEK };
    };
    renderBoard('/board?view=week');

    expect(screen.getByText('Loading the week')).toBeInTheDocument();
    // Veckoqueryn gör ett snabbt omförsök (retry: 1, ~1 s) innan felkortet visas.
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText(/Your data is safe/)).toBeInTheDocument();
    expect(calls).toBe(2); // första försöket + det snabba omförsöket
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('table', { name: 'This week' })).toBeInTheDocument();
    expect(calls).toBe(3);
  });
});

describe('Streaks-vyn (?view=streaks)', () => {
  const rowOf = (name: string) =>
    within(screen.getByRole('table', { name: 'Streaks' })).getAllByRole('row').find((row) => within(row).queryByRole('button', { name }))!;

  it('status per löpare — Safe / At risk / Broken — med tider vid fast klockslag', async () => {
    renderBoard('/board?view=streaks');
    await screen.findByRole('table', { name: 'Streaks' });

    // Karl sprang idag 05:00Z → safe.
    expect(within(rowOf('Karl Persson')).getByText('Safe')).toBeInTheDocument();
    expect(within(rowOf('Karl Persson')).getByText('ran 5 h ago')).toBeInTheDocument();
    // Joel sprang igår → 12:00 Stockholm → 12h kvar av idag.
    expect(within(rowOf('Joel Lindberg')).getByText('At risk')).toBeInTheDocument();
    expect(within(rowOf('Joel Lindberg')).getByText('12h 00m left')).toBeInTheDocument();
    // Adam sprang för två dagar sedan → bruten trots current_streak 1.
    expect(within(rowOf('Adam Einstein')).getByText('Broken')).toBeInTheDocument();
    expect(within(rowOf('Adam Einstein')).getByText('last run 2 d ago')).toBeInTheDocument();
    expect(within(rowOf('Daniel Lindblad Lüthje')).getByText('no runs yet')).toBeInTheDocument();
  });

  it('current / best / multiplikator / pct mot toppen — multiplikatorn ur config-endpointen', async () => {
    renderBoard('/board?view=streaks');
    await screen.findByRole('table', { name: 'Streaks' });

    const karl = rowOf('Karl Persson'); // 8 dagar → 1.5× i testtrappan (INTE produktionens 1.1×)
    expect(within(karl).getByText('8')).toBeInTheDocument();
    expect(within(karl).getByText('days · best 31')).toBeInTheDocument();
    expect(within(karl).getByText('1.5× now')).toBeInTheDocument();
    expect(within(karl).getByText('2.0×')).toBeInTheDocument(); // toppen ur trappan
    // (1.5 − 1) / (2.0 − 1) = 50 %
    expect(karl.querySelector<HTMLElement>('.rq-fill')?.style.getPropertyValue('--w')).toBe('50%');

    expect(within(rowOf('Adam Einstein')).getByText('1.0× now')).toBeInTheDocument();
    expect(rowOf('Adam Einstein').querySelector<HTMLElement>('.rq-fill')?.style.getPropertyValue('--w')).toBe('0%');
  });

  it('sorterar på effektiv streak (bruten = 0, då längsta streak först) — Adams rådata 1 räknas inte', async () => {
    renderBoard('/board?view=streaks');
    const table = await screen.findByRole('table', { name: 'Streaks' });
    const names = within(table).getAllByRole('row').map((row) => within(row).getByRole('button').textContent);
    expect(names).toEqual(['Karl Persson', 'Joel Lindberg', 'Nicklas von Elling', 'Daniel Lindblad Lüthje', 'Adam Einstein']);
  });

  it('trappan ritas ur /api/config/xp: aldrig de hårdkodade stegen', async () => {
    renderBoard('/board?view=streaks');
    const ladder = await screen.findByRole('region', { name: 'How the multiplier grows' });

    const rows = within(ladder).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['3 days1.3×', '7 days1.5×', '14 days1.8×', '21 days and beyond2.0×']);
    expect(within(ladder).queryByText('5 days')).toBeNull();
    expect(within(ladder).getByText(/One missed day resets to 1\.0×/)).toBeInTheDocument();
  });

  it('"Your streak dies in" (AT RISK): nedräkning, vad som står på spel (shared-formeln) och Log a run', async () => {
    renderBoard('/board?view=streaks');
    const alert = await screen.findByRole('region', { name: 'Your streak' });

    expect(within(alert).getByText('Your streak dies in')).toBeInTheDocument();
    expect(within(alert).getByRole('timer')).toHaveTextContent('12h 00m 00s');
    // Joel: 4 dagar → dag 5 = 1.3×; 10 km: floor((15+20)·1.3 + 15) = 60 mot 50 utan streak.
    expect(within(alert).getByText('Your run today earns 1.3×. Miss it and your next 10 km run drops from 60 to 50 XP.')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Log a run' })).toHaveAttribute('href', '/log');
    expect(alert).toHaveAttribute('data-state', 'at-risk');
  });

  it('din egen rad i riskzonen får röd accent; andras at-risk gör det inte', async () => {
    renderBoard('/board?view=streaks');
    await screen.findByRole('table', { name: 'Streaks' });
    expect(rowOf('Joel Lindberg')).toHaveAttribute('data-accent', 'down');
    expect(rowOf('Karl Persson')).not.toHaveAttribute('data-accent', 'down');
  });

  it('alert-kortet SAFE: grön, nedräkning till deadline, ingen guldknapp', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...JOEL, runs: [run('2026-10-04', { start_time: '2026-10-04T08:00:00Z' })] }, KARL] });
    renderBoard('/board?view=streaks');
    const alert = await screen.findByRole('region', { name: 'Your streak' });

    expect(alert).toHaveAttribute('data-state', 'safe');
    expect(within(alert).getByText('Your streak is safe')).toBeInTheDocument();
    // 12:00 Stockholm → 12 h kvar av idag + ett dygn.
    expect(within(alert).getByRole('timer')).toHaveTextContent('36h 00m 00s');
    expect(within(alert).queryByRole('link', { name: 'Log a run' })).toBeNull();
  });

  it('alert-kortet BROKEN: ingen nedräkning, trappans första steg ur configen och Log a run', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...JOEL, current_streak: 0, runs: [run('2026-09-20')] }, KARL] });
    renderBoard('/board?view=streaks');
    const alert = await screen.findByRole('region', { name: 'Your streak' });

    expect(alert).toHaveAttribute('data-state', 'broken');
    expect(within(alert).queryByRole('timer')).toBeNull();
    expect(within(alert).getByText('Run today to start a new one. 3 days in a row starts the multiplier at 1.3×.')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Log a run' })).toBeInTheDocument();
  });

  it('exakt en guldknapp i vyn (regel 3)', async () => {
    const { container } = renderBoard('/board?view=streaks');
    await screen.findByRole('region', { name: 'Your streak' });
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(1);
  });

  it('desktop: tabell (Runner/Current/Multiplier/Status) + sidokolumn', async () => {
    renderBoard('/board?view=streaks', DESKTOP);
    const table = await screen.findByRole('table', { name: 'Streaks' });
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Runner', 'Current', 'Multiplier', 'Status']);
    expect(screen.getByRole('region', { name: 'How the multiplier grows' })).toBeInTheDocument();
  });

  it('laddning: stadion-ovalen; fel i config-endpointen: felkort med Retry', async () => {
    let failing = true;
    handlers.getXpConfig = () => (failing ? { success: false, error: 'boom' } : { success: true, data: XP_CONFIG });
    renderBoard('/board?view=streaks');

    expect(screen.getByText('Loading streaks')).toBeInTheDocument();
    const alert = await screen.findByRole('alert', {}, SLOW);
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Streaks' })).toBeInTheDocument();
  });
});

describe('?view= — växling och delad URL', () => {
  const selected = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;

  it('default är season (All-time); fliklistan har tre flikar', async () => {
    renderBoard('/board');
    expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All-time', 'Week', 'Streaks']);
    expect(selected()).toBe('All-time');
  });

  it.each([
    ['/board?view=week', 'Week'],
    ['/board?view=streaks', 'Streaks'],
    ['/board?view=season', 'All-time'],
  ])('delad URL %s landar på rätt flik', async (entry, tab) => {
    renderBoard(entry);
    await waitFor(() => expect(selected()).toBe(tab));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { selected: true }).id);
  });

  it('okänt värde faller tillbaka på season', async () => {
    renderBoard('/board?view=hopp');
    expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
    expect(selected()).toBe('All-time');
  });

  it('klick på flikarna byter vy och skriver ?view= i adressen', async () => {
    renderBoard('/board');
    await screen.findByTestId('podium-1');

    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(location()).toBe('/board?view=week'));
    expect(await screen.findByRole('table', { name: 'This week' })).toBeInTheDocument();
    expect(screen.queryByTestId('podium-1')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Streaks' }));
    await waitFor(() => expect(location()).toBe('/board?view=streaks'));
    expect(await screen.findByRole('table', { name: 'Streaks' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'All-time' }));
    await waitFor(() => expect(location()).toBe('/board?view=season'));
    expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
  });

  it('desktop har samma flikar (i rubrikraden)', async () => {
    renderBoard('/board?view=week', DESKTOP);
    await screen.findByRole('table', { name: 'This week' });
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByText(/Week \d+ · 5 runners/)).toBeInTheDocument();
  });
});

describe('laddning, fel och tomt — Season', () => {
  it('laddar: skeleton-rader (role=status) tills gruppen anländer', async () => {
    handlers.getUsersWithRuns = () => new Promise(() => {});
    renderBoard();
    expect(await screen.findByText('Loading the standings')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('fel: felkort med Retry; Retry hämtar om och visar sedan brädet', async () => {
    let calls = 0;
    handlers.getUsersWithRuns = () => {
      calls += 1;
      return calls === 1 ? { success: false, error: 'boom' } : { success: true, data: PACK };
    };
    renderBoard();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: "Couldn't load the standings" })).toBeInTheDocument();
    expect(within(alert).getByText(/Your data is safe/)).toBeInTheDocument();
    expect(screen.queryByTestId('podium-1')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
    expect(calls).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('tour-ankare (leaderboard-touren)', () => {
  it('touren monteras först när podiet är ritat, och bara i Season-vyn (ankaret finns inte i Week/Streaks)', async () => {
    handlers.getUsersWithRuns = () => new Promise(() => {});
    const pending = renderBoard('/board');
    await screen.findByText('Loading the standings');
    expect(screen.queryByTestId('feature-tour')).toBeNull();
    pending.unmount();

    resetFakeBackend();
    handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
    renderBoard('/board');
    await screen.findByTestId('podium-1');
    expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_leaderboard_v2');
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    await screen.findByRole('table', { name: 'This week' });
    expect(screen.queryByTestId('feature-tour')).toBeNull();
  });

  const selectors = TOUR_LEADERBOARD_V1.flatMap((step) => (step.element ? [step.element] : []));

  it('touren har ankare att leta efter', () => {
    expect(selectors.length).toBeGreaterThan(0);
  });

  it.each([MOBILE, DESKTOP])('varje elementväljare i TOUR_LEADERBOARD_V1 träffar exakt ett element i Season-vyn (%ipx)', async (width) => {
    const { container } = renderBoard('/board', width);
    await screen.findByTestId('podium-1');
    for (const selector of selectors) {
      expect(container.querySelectorAll(selector)).toHaveLength(1);
    }
    // ankaret sitter på det främsta kortet
    expect(within(container.querySelector('[data-tour="leaderboard-card"]') as HTMLElement).getByRole('button', { name: 'Karl Persson' })).toBeInTheDocument();
  });
});
