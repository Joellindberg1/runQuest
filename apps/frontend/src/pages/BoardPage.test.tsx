import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { Run, User } from '@runquest/types';
import BoardPage from './BoardPage';
import { PENNANT_PATH, PENNANT_VIEW_BOX } from '@/shared/components/challengeMark';
import { TOUR_LEADERBOARD_V1 } from '@/features/onboarding/featureTourSteps';
import { ME, RANK_DELTA, WEEK, XP_CONFIG, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { OPEN_KEYS, tabTo } from '@/test/runnerRows';
import type { UserTitleEntry } from '@runquest/shared';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Gruppens badges (minis i Season-raderna): varje test väljer själv vad GET /badges/group svarar. Standard = felar, dvs Board som förut.
const badgesApi = vi.hoisted(() => ({ getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));
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
  runs: [run('2026-10-04', { distance: 8.4, start_time: '2026-10-04T07:00:00Z' }), run('2026-09-20', { distance: 32.8 })],
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
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getGroupBadges.mockRejectedValue(new Error('badges unavailable'));
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
        ? [{ title_id: 't1', title_name: 'The Double Trouble', title_description: '', position: 1, value: 14, earned_at: '', is_current_holder: true, status: 'holder' } satisfies UserTitleEntry]
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
    // start_time 07:00 väggklocka mot klockan 12:00 Stockholm.
    expect(within(card).getByText('Last run 5 h ago · 8.4 km')).toBeInTheDocument();
  });

  it('mobilkorten visar alla visade titlar, inte bara den första — på podiet och från plats 4', async () => {
    const held = (id: string, name: string): UserTitleEntry => ({
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

  it('dagstaplarna: varje rad har en bild som berättar km per dag, måndag till söndag', async () => {
    renderBoard('/board?view=week');
    const table = await screen.findByRole('table', { name: 'This week' });

    const [karl, joel] = within(table).getAllByRole('row').slice(1);
    // Karl [0,12,6,0,8,5,0] km; Joel 10 km på fredagen. Höjdskalan (--h) och etiketterna M–S testas i weekModel.test.ts.
    expect(within(karl).getByRole('img', { name: 'Kilometres per day, Monday to Sunday: 0, 12, 6, 0, 8, 5, 0' })).toBeInTheDocument();
    expect(within(joel).getByRole('img', { name: 'Kilometres per day, Monday to Sunday: 0, 0, 0, 0, 10, 0, 0' })).toBeInTheDocument();
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

    expect(within(rowOf('Adam Einstein')).getByText('1.0× now')).toBeInTheDocument();
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

  it('default är season (All-time); fliklistan har fyra flikar (Position kommer sist, med fem medlemmar)', async () => {
    renderBoard('/board');
    expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All-time', 'Week', 'Streaks', 'Position']);
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
    expect(screen.getAllByRole('tab')).toHaveLength(4);
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

describe('visade badges i Season-raderna', () => {
  const KARL_BADGES = [{ series: 'milestoner', tier: 3 }, { series: 'climber', tier: 5 }];
  const NICK_BADGES = [{ series: 'night_owl', tier: 1 }, { series: 'speedster', tier: 2 }, { series: 'climber', tier: 4 }];

  const serveBadges = (members: Array<{ user_id: string; showcase: Array<{ series: string; tier: number }> }>) =>
    badgesApi.getGroupBadges.mockResolvedValue({ members, holders: {}, member_count: members.length });
  const serveStandardBadges = () => serveBadges([
    { user_id: 'u-karl', showcase: KARL_BADGES },
    { user_id: 'u-me', showcase: [] },
    { user_id: 'u-nick', showcase: NICK_BADGES },
  ]);

  const restRows = () => within(screen.getByRole('table', { name: 'Rest of the pack' })).getAllByRole('row').slice(1);
  const KARL_LABEL = 'Badges: Rare Milestoner, Epic Climber';
  const NICK_LABEL = 'Badges: Common Night Owl, Uncommon Speedster, Heroic Climber';

  it('mobil, podiet: minis på namnraden i ordningen namn, delta, minis — gruppen är ETT img med samlad etikett', async () => {
    serveStandardBadges();
    renderBoard();

    const karl = await screen.findByTestId('podium-1');
    const group = await within(karl).findByRole('img', { name: KARL_LABEL });
    const nameline = group.parentElement as HTMLElement;
    expect(nameline).toHaveClass('rq-board-podium__nameline');
    expect([...nameline.children].map((child) => child.getAttribute('aria-label') ?? child.textContent)).toEqual(['Karl Persson', 'Up 1 place', KARL_LABEL]);
    // varje mini är dekorativ: inga egna img-element inuti gruppen
    expect(group.querySelectorAll('.rq-badge[aria-hidden="true"]')).toHaveLength(2);
    expect(within(group).queryAllByRole('img')).toHaveLength(0);
  });

  it('mobil, podiet: vimpeln står inte på samma rad som minis (foten, inte namnraden)', async () => {
    serveStandardBadges();
    renderBoard();

    const karl = await screen.findByTestId('podium-1');
    const group = await within(karl).findByRole('img', { name: KARL_LABEL });
    const ribbons = within(karl).getByLabelText('Challenges to send: 3 minor, 1 major');
    expect(group.parentElement?.contains(ribbons)).toBe(false);
    expect(ribbons.closest('.rq-board-podium__foot')).not.toBeNull();
    expect(group.closest('.rq-board-podium__foot')).toBeNull();
  });

  it('mobil, rest-rad: minis på sub-raden efter km; vimpeln i högerkolumnen under ETA så de aldrig delar behållare', async () => {
    serveStandardBadges();
    renderBoard();
    await screen.findByTestId('podium-1');

    const nick = restRows()[0];
    const group = await within(nick).findByRole('img', { name: NICK_LABEL });
    const sub = group.parentElement as HTMLElement;
    expect(sub).toHaveClass('rq-board-sub');
    expect(sub.firstElementChild?.textContent).toMatch(/km$/);

    const ribbons = within(nick).getByLabelText('Challenges to send: 5 minor, 1 major');
    expect(sub.contains(ribbons)).toBe(false);
    const rightCell = ribbons.closest('.rq-board-cell-right') as HTMLElement;
    expect(rightCell).not.toBeNull();
    expect(rightCell.contains(group)).toBe(false);
    // ordning i högerkolumnen: tempo, ETA, vimplar
    expect([...rightCell.children].map((child) => child.className)).toEqual(['rq-board-num', 'rq-board-cell-sub', 'rq-board-cell-ribbons']);
  });

  it('mobil, rest-rader: vimplarna står i högerkolumnen oavsett om raden har minis', async () => {
    // Nicklas har minis, Daniel har inga och inga utmaningar; ger Daniel tokens ska de också hamna i högerkolumnen.
    handlers.getUsersWithRuns = () => ({
      success: true,
      data: [JOEL, KARL, ADAM, NICKLAS, { ...DANIEL, challenge_counts: { legendary: 2 } }],
    });
    serveBadges([{ user_id: 'u-nick', showcase: NICK_BADGES }]);
    renderBoard();
    await screen.findByTestId('podium-1');
    await within(restRows()[0]).findByRole('img', { name: NICK_LABEL });

    const [withMinis, withoutMinis] = restRows();
    expect(withMinis.querySelector('.rq-badge-minis')).not.toBeNull();
    expect(withoutMinis.querySelector('.rq-badge-minis')).toBeNull();
    for (const [row, label] of [[withMinis, 'Challenges to send: 5 minor, 1 major'], [withoutMinis, 'Challenges to send: 2 legendary']] as const) {
      const ribbons = within(row).getByLabelText(label);
      expect(ribbons.parentElement).toHaveClass('rq-board-cell-ribbons');
      expect(ribbons.closest('.rq-board-cell-right')).not.toBeNull();
      expect(ribbons.closest('.rq-board-sub')).toBeNull();
    }
  });

  it('mobil: ALLA rest-raders sub-rad bär den gemensamma min-height-klassen, med och utan minis (ingen hopp när queryn landar)', async () => {
    serveStandardBadges();
    renderBoard();
    await screen.findByTestId('podium-1');
    await within(restRows()[0]).findByRole('img', { name: NICK_LABEL });

    const subs = restRows().map((row) => row.querySelector('.rq-board-sub'));
    expect(subs).toHaveLength(2);
    for (const sub of subs) expect(sub).toHaveClass('rq-board-sub--list');
  });

  it('en rest-rad utan visade badges: inga minis, vimpeln i högerkolumnen, sub-raden bara km', async () => {
    serveBadges([{ user_id: 'u-karl', showcase: KARL_BADGES }, { user_id: 'u-nick', showcase: [] }]);
    renderBoard();
    await within(await screen.findByTestId('podium-1')).findByRole('img', { name: KARL_LABEL });

    const nick = restRows()[0];
    expect(nick.querySelector('.rq-badge-minis')).toBeNull();
    expect(nick.querySelector('[data-minis]')).toBeNull();
    const ribbons = within(nick).getByLabelText('Challenges to send: 5 minor, 1 major');
    expect(ribbons.closest('.rq-board-cell-ribbons')).not.toBeNull();
    expect(nick.querySelector('.rq-board-sub')?.children).toHaveLength(1);
  });

  it('badge-queryn felar → Board som förut: inga minis, inget felkort, ingen spinner', async () => {
    renderBoard();

    await screen.findByTestId('podium-1');
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());
    expect(document.querySelector('.rq-badge-minis')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(restRows().map((row) => within(row).getByRole('button').textContent)).toEqual(['Nicklas von Elling', 'Daniel Lindblad Lüthje']);
    // vimpeln står i högerkolumnen även utan badge-data
    expect(within(restRows()[0]).getByLabelText('Challenges to send: 5 minor, 1 major').closest('.rq-board-cell-ribbons')).not.toBeNull();
  });

  it('badge-queryn laddar → Board ritas direkt utan minis och spinner; minis tillkommer när svaret landar', async () => {
    let land: (value: unknown) => void = () => {};
    badgesApi.getGroupBadges.mockReturnValue(new Promise((resolve) => { land = resolve; }));
    renderBoard();

    await screen.findByTestId('podium-1');
    expect(document.querySelector('.rq-badge-minis')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    land({ members: [{ user_id: 'u-karl', showcase: KARL_BADGES }], holders: {}, member_count: 5 });
    expect(await within(screen.getByTestId('podium-1')).findByRole('img', { name: KARL_LABEL })).toBeInTheDocument();
  });

  it('tour-ankaret sitter kvar på det främsta podiekortet när minis finns', async () => {
    serveStandardBadges();
    const { container } = renderBoard();
    const karl = await screen.findByTestId('podium-1');
    await within(karl).findByRole('img', { name: KARL_LABEL });

    expect(container.querySelectorAll('[data-tour="leaderboard-card"]')).toHaveLength(1);
    expect(karl).toHaveAttribute('data-tour', 'leaderboard-card');
  });

  it('desktop, podiet: minis efter namnet på samma rad (minis krymper inte)', async () => {
    serveStandardBadges();
    renderBoard('/board', DESKTOP);

    const karl = await screen.findByTestId('podium-1');
    const group = await within(karl).findByRole('img', { name: KARL_LABEL });
    expect([...(group.parentElement as HTMLElement).children].map((child) => child.getAttribute('aria-label') ?? child.textContent)).toEqual(['Karl Persson', KARL_LABEL]);
    expect(group.parentElement).toHaveAttribute('data-minis', 'true');
  });

  it('desktop, tabellen: namnet ensamt på namnraden, minis på sub-raden efter "Lvl N · X km", vimplarna i Last run-cellen', async () => {
    serveStandardBadges();
    renderBoard('/board', DESKTOP);
    await screen.findByTestId('podium-1');

    const nick = restRows()[0];
    const group = await within(nick).findByRole('img', { name: NICK_LABEL });
    const sub = group.parentElement as HTMLElement;
    expect(sub).toHaveClass('rq-board-sub', 'rq-board-sub--table');
    expect([...sub.children].map((child) => child.getAttribute('aria-label') ?? child.textContent)).toEqual([expect.stringMatching(/^Lvl \d+ · .+ km$/), NICK_LABEL]);
    // namnet står ensamt: ingen .rq-board-namerow, inga minis bredvid namnknappen
    expect(nick.querySelector('.rq-board-namerow')).toBeNull();
    const nameButton = within(nick).getByRole('button', { name: 'Nicklas von Elling' });
    expect(nameButton.parentElement?.querySelector('.rq-badge-minis')).toBe(group);
    expect(nameButton.nextElementSibling).toBe(sub);

    const ribbons = within(nick).getByLabelText('Challenges to send: 5 minor, 1 major');
    expect(sub.contains(ribbons)).toBe(false);
    const cells = within(nick).getAllByRole('cell');
    const lastRunCell = cells[cells.length - 1];
    expect(lastRunCell).toHaveClass('rq-board-cell-stack');
    expect([...lastRunCell.children].map((child) => child.tagName.toLowerCase() + (child.getAttribute('aria-label') ? `:${child.getAttribute('aria-label')}` : ''))).toEqual(['span', 'span:Challenges to send: 5 minor, 1 major']);
    expect(lastRunCell.contains(ribbons)).toBe(true);
  });

  it('desktop, tabellen: ALLA rest-raders sub-rad rymmer en mini (min-height-klassen), med och utan minis', async () => {
    serveBadges([{ user_id: 'u-nick', showcase: NICK_BADGES }]);
    renderBoard('/board', DESKTOP);
    await screen.findByTestId('podium-1');
    await within(restRows()[0]).findByRole('img', { name: NICK_LABEL });

    const subs = restRows().map((row) => row.querySelector('.rq-board-sub'));
    expect(subs).toHaveLength(2);
    for (const sub of subs) expect(sub).toHaveClass('rq-board-sub--table');
    expect(restRows()[1].querySelector('.rq-badge-minis')).toBeNull();
  });

  it.each([MOBILE, DESKTOP])('podiets namnrad bär min-height-klassen på ALLA kort, med och utan minis (%ipx)', async (width) => {
    serveStandardBadges();
    renderBoard('/board', width);
    await within(await screen.findByTestId('podium-1')).findByRole('img', { name: KARL_LABEL });

    for (const rank of [1, 2, 3]) {
      const card = screen.getByTestId(`podium-${rank}`);
      const name = within(card).getByRole('button', { name: /^(Karl Persson|Joel Lindberg|Adam Einstein)$/ });
      expect(name.closest('.rq-board-podium__nameline')).toHaveClass('rq-board-podium__nameline--room');
    }
    // Joel (plats 2) har inga visade badges: raden har rum men inga minis.
    expect(screen.getByTestId('podium-2').querySelector('.rq-badge-minis')).toBeNull();
  });

  it('mobil, rest-rad med minis men utan utmaningar: ingen tom ribbons-behållare', async () => {
    serveBadges([{ user_id: 'u-dan', showcase: NICK_BADGES }]);
    renderBoard();
    await screen.findByTestId('podium-1');

    const dan = restRows()[1];
    await within(dan).findByRole('img', { name: NICK_LABEL });
    expect(dan.querySelector('.rq-board-cell-ribbons')).toBeNull();
  });

  it('Week och Streaks är orörda: ingen badge-hämtning och inga minis', async () => {
    serveStandardBadges();
    renderBoard('/board?view=week');
    await screen.findByRole('table', { name: 'This week' });
    expect(badgesApi.getGroupBadges).not.toHaveBeenCalled();
    expect(document.querySelector('.rq-badge-minis')).toBeNull();
  });
});

describe('vimpeln som utmaningstecken (F12.4)', () => {
  // Vimpelns geometri (path, siffrans y, viewBox) och att sköldens path är borta testas i shared/components/challengeMark.test.ts.
  it('varje vimpel ritas med den delade geometrin: viewBox och path ur challengeMark', async () => {
    const { container } = renderBoard();
    await screen.findByTestId('podium-1');

    const pennants = [...container.querySelectorAll('svg.rq-ribbon')];
    expect(pennants.length).toBeGreaterThan(0);
    for (const svg of pennants) {
      expect(svg).toHaveAttribute('viewBox', PENNANT_VIEW_BOX);
      expect(svg.querySelector('path')).toHaveAttribute('d', PENNANT_PATH);
    }
  });

  it.each([MOBILE, DESKTOP])('vimplarna ritas i podiet med sin tillgängliga etikett (%ipx)', async (width) => {
    renderBoard('/board', width);
    const karl = await screen.findByTestId('podium-1');

    expect(within(karl).getByLabelText('Challenges to send: 3 minor, 1 major')).toBeInTheDocument();
  });

  it('nivåattribut, antal och tillgänglig etikett är oförändrade', async () => {
    renderBoard();
    const karl = await screen.findByTestId('podium-1');
    const group = within(karl).getByLabelText('Challenges to send: 3 minor, 1 major');
    expect(group).toHaveAttribute('role', 'img');
    const marks = [...group.querySelectorAll('svg.rq-ribbon')];
    expect(marks.map((svg) => svg.getAttribute('data-tier'))).toEqual(['minor', 'major']);
    expect(marks.map((svg) => svg.textContent)).toEqual(['3', '1']);
    for (const svg of marks) expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Council 8: vimpel och minis i aldrig en gemensam behållare (F12.4/F12.5)', () => {
  const BADGES = [{ series: 'milestoner', tier: 3 }, { series: 'climber', tier: 5 }];

  // Kortets/radens egen rot: podiets innehållsbox (.rq-board-podium__body) och tabellens/listans rad. Allt däremellan är en "behållare".
  const isRoot = (el: Element) => el.matches('[role="row"], .rq-board-podium__body');
  const containersAbove = (el: Element): Element[] => {
    const found: Element[] = [];
    for (let node = el.parentElement; node && !isRoot(node); node = node.parentElement) found.push(node);
    return found;
  };

  async function renderWithMinisEverywhere(width: number) {
    badgesApi.getGroupBadges.mockResolvedValue({
      members: [KARL, JOEL, ADAM, NICKLAS, DANIEL].map((user) => ({ user_id: user.id, showcase: BADGES })),
      holders: {},
      member_count: 5,
    });
    const view = renderBoard('/board', width);
    await screen.findByTestId('podium-1');
    await waitFor(() => expect(view.container.querySelectorAll('.rq-badge-minis').length).toBe(5));
    return view.container;
  }

  it.each([MOBILE, DESKTOP])('ingen behållare mellan en minis-grupp och kortets/radens rot rymmer också en vimpel (%ipx)', async (width) => {
    const container = await renderWithMinisEverywhere(width);

    const groups = [...container.querySelectorAll('.rq-badge-minis')];
    expect(groups).toHaveLength(5);
    let rootsWithBoth = 0;
    for (const group of groups) {
      const root = group.closest('[role="row"], .rq-board-podium__body');
      expect(root).not.toBeNull();
      if (root!.querySelector('.rq-ribbons')) rootsWithBoth += 1;
      for (const holder of containersAbove(group)) expect(holder.querySelector('.rq-ribbons')).toBeNull();
    }
    // Adam och Daniel har inga utmaningar; Karl, Joel och Nicklas har både minis och vimplar i samma kort/rad (annars vore testet tomt).
    expect(rootsWithBoth).toBe(3);
    // och åt andra hållet: ingen behållare ovanför en vimpel rymmer minis
    for (const ribbons of container.querySelectorAll('.rq-ribbons')) {
      for (const holder of containersAbove(ribbons)) expect(holder.querySelector('.rq-badge-minis')).toBeNull();
    }
  });

  it('testet fäller när de delar behållare (mutationskontroll)', async () => {
    const container = await renderWithMinisEverywhere(MOBILE);
    const group = container.querySelector('.rq-badge-minis') as HTMLElement;
    const ribbons = container.querySelector('.rq-ribbons') as HTMLElement;
    group.parentElement!.appendChild(ribbons.cloneNode(true));
    expect(containersAbove(group).some((holder) => holder.querySelector('.rq-ribbons'))).toBe(true);
  });

  it.each([MOBILE, DESKTOP])('tour-ankaret och raderna utan badges: ankaret oförändrat, ingen tom minis- eller vimpelbehållare (%ipx)', async (width) => {
    renderBoard('/board', width);
    const karl = await screen.findByTestId('podium-1');
    expect(karl).toHaveAttribute('data-tour', 'leaderboard-card');
    // Daniel har varken badges eller utmaningar: inga tomma behållare
    const daniel = within(screen.getByRole('table', { name: 'Rest of the pack' })).getAllByRole('row')[2];
    expect(daniel.querySelector('.rq-badge-minis')).toBeNull();
    expect(daniel.querySelector('.rq-ribbons')).toBeNull();
    expect(daniel.querySelector('.rq-board-cell-ribbons')).toBeNull();
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

// Beräkningen av procenten testas i modellerna (seasonModel, weekModel, streakModel). Här vaktas bara inkopplingen: att varje stapel
// får sin CSS-variabel från rätt fält. Staplarna har ingen roll eller text, så variabeln är det enda som visar bredden/höjden.
describe('modellens procent kopplas till stapelns CSS-variabel', () => {
  const cssVar = (element: Element | null | undefined, name: string) => (element as HTMLElement | null)?.style.getPropertyValue(name);

  it('Season: nivåstapelns --w följer procenten som "x / y XP" visar', async () => {
    renderBoard();
    const card = await screen.findByTestId('podium-1');
    const [, into, total] = /(\d[\d\s]*) \/ (\d[\d\s]*) XP/.exec(within(card).getByText(/\d+ \/ \d+ XP/).textContent ?? '')!;
    const expected = (Number(into.replace(/\s/g, '')) / Number(total.replace(/\s/g, ''))) * 100;
    const width = parseInt(cssVar(card.querySelector('.rq-track > .rq-fill'), '--w') ?? '', 10);
    expect(Math.abs(width - expected)).toBeLessThanOrEqual(1);
  });

  it('Week: packens stapel får --w ur pctOfBest och varje dagstapel --h ur heightPct', async () => {
    renderBoard('/board?view=week');
    const table = await screen.findByRole('table', { name: 'This week' });

    const pack = screen.getByRole('region', { name: 'Pack total this week' });
    expect(cssVar(pack.querySelector('.rq-fill--pack'), '--w')).toBe('82%');

    // Karl [0,12,6,0,8,5,0] km mot längsta dagen 12 km.
    const [karl] = within(table).getAllByRole('row').slice(1);
    expect([...karl.querySelectorAll('.rq-daybar__fill')].map((bar) => cssVar(bar, '--h'))).toEqual(['0%', '100%', '50%', '0%', '67%', '42%', '0%']);
  });

  it('Streaks: radens stapel får --w ur pct (8 dagar = 1.5× av toppen 2.0× = 50 %)', async () => {
    renderBoard('/board?view=streaks');
    const table = await screen.findByRole('table', { name: 'Streaks' });
    const karl = within(table).getAllByRole('row').find((row) => within(row).queryByRole('button', { name: 'Karl Persson' }))!;
    expect(cssVar(karl.querySelector('.rq-fill'), '--w')).toBe('50%');
  });
});

describe('Board — runner rows are real buttons', () => {
  const ROWS = [
    { view: 'Season podium on mobile', entry: '/board', width: MOBILE, name: 'Karl Persson', id: 'u-karl' },
    { view: 'Season rest list on mobile', entry: '/board', width: MOBILE, name: 'Nicklas von Elling', id: 'u-nick' },
    { view: 'Season podium on desktop', entry: '/board', width: DESKTOP, name: 'Karl Persson', id: 'u-karl' },
    { view: 'Season rest table on desktop', entry: '/board', width: DESKTOP, name: 'Nicklas von Elling', id: 'u-nick' },
    { view: 'Week on mobile', entry: '/board?view=week', width: MOBILE, name: 'Karl Persson', id: 'u-karl' },
    { view: 'Week on desktop', entry: '/board?view=week', width: DESKTOP, name: 'Karl Persson', id: 'u-karl' },
    { view: 'Streaks on mobile', entry: '/board?view=streaks', width: MOBILE, name: 'Adam Einstein', id: 'u-adam' },
    { view: 'Streaks on desktop', entry: '/board?view=streaks', width: DESKTOP, name: 'Adam Einstein', id: 'u-adam' },
  ];

  it.each(ROWS)('$view: the runner button is named after the runner and carries the runner id', async ({ entry, width, name, id }) => {
    renderBoard(entry, width);

    const button = await screen.findByRole('button', { name });

    expect(button).toHaveAttribute('data-runner-id', id);
  });

  describe.each(OPEN_KEYS)('with $label', ({ keys }) => {
    it.each(ROWS)('$view: Tab reaches the runner and the key opens the runner card', async ({ entry, width, name, id }) => {
      const user = userEvent.setup();
      renderBoard(entry, width);
      const button = await screen.findByRole('button', { name });

      await tabTo(user, button);
      await user.keyboard(keys);

      await waitFor(() => expect(location()).toBe(`/runner/${id}`));
    });
  });
});
