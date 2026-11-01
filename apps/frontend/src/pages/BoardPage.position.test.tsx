import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { PositionHistoryResponse } from '@runquest/shared';
import type { Run, User } from '@runquest/types';
import BoardPage from './BoardPage';
import { FirstBoardGate } from '@/app-shell/FirstBoardGate';
import { TOUR_LEADERBOARD_V1 } from '@/features/onboarding/featureTourSteps';
import { loadPositionView } from '@/features/leaderboard/positionViewLoader';
import { NO_FINISHED_WEEK_MESSAGE } from '@/features/leaderboard/positionTexts';
import { ME_ID as FIXTURE_ME_ID, packOf, responseOf, runnerOf, twelve, weeksOf } from '@/features/leaderboard/positionBoard.fixture';
import { ME, RANK_DELTA, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
const badgesApi = vi.hoisted(() => ({ getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));
vi.mock('@/features/onboarding/components/FeatureTour', () => ({
  FeatureTour: ({ slug }: { slug: string }) => <div data-testid="feature-tour" data-slug={slug} />,
}));
// Samma laddare som sidan använder, men med ett räknat anrop: proven gäller NÄR vyns chunk begärs, inte vad den innehåller.
vi.mock('@/features/leaderboard/positionViewLoader', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/leaderboard/positionViewLoader')>();
  return { ...original, loadPositionView: vi.fn(original.loadPositionView) };
});

const MOBILE = 390;
const DESKTOP = 1280;

// Fast klocka som i BoardPage.test: bara Date fejkas, så waitFor och timers lever.
const NOW = new Date('2026-10-04T10:00:00Z');
// Positionssvaret gör ett snabbt omförsök (~1 s) före felkortet.
const SLOW = { timeout: 4000 };

const location = () => screen.getByTestId('location').textContent;

const run = (date: string): Run => ({
  id: `r-${date}`, user_id: 'x', date, distance: 5, xp_gained: 120, multiplier: 1, streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0,
});

const runner = (id: string, name: string, xp: number, extra: Partial<User> = {}): User => ({
  ...ME, id, name, total_xp: xp, total_km: 500, current_streak: 0, longest_streak: 0, runs: [], challenge_counts: {}, ...extra,
});

const KARL = runner('u-karl', 'Karl Persson', 5539, { runs: [run('2026-10-04')] });
const JOEL = runner(ME.id, 'Joel Lindberg', 5243, { runs: [run('2026-10-03')] });
const ADAM = runner('u-adam', 'Adam Einstein', 4736, { runs: [run('2026-10-02')] });
const NICKLAS = runner('u-nick', 'Nicklas von Elling', 4483, { runs: [run('2026-10-04')] });
const DANIEL = runner('u-dan', 'Daniel Lindblad Lüthje', 2527);
const PACK = [JOEL, KARL, ADAM, NICKLAS, DANIEL];

// Fem löpare, åtta veckor, i Standings ordning (live-placeringen i sista kolumnen). Vecka sju är den sista avslutade veckan.
const FIVE: PositionHistoryResponse = responseOf(weeksOf(8), [
  runnerOf('u-karl', 'Karl Persson', [2, 2, 1, 2, 2, 2, 2, 1]),
  runnerOf(ME.id, 'Joel Lindberg', [1, 1, 2, 1, 1, 1, 1, 2]),
  runnerOf('u-adam', 'Adam Einstein', [3, 4, 3, 3, 4, 3, 3, 3]),
  runnerOf('u-nick', 'Nicklas von Elling', [5, 5, 5, 4, 5, 5, 5, 4]),
  runnerOf('u-dan', 'Daniel Lindblad Lüthje', [4, 3, 4, 5, 3, 4, 4, 5]),
]);

/** Fixturens inloggade löpare är Boardens (ME). */
const asMe = (data: PositionHistoryResponse): PositionHistoryResponse => ({
  ...data,
  runners: data.runners.map((entry) => (entry.user_id === FIXTURE_ME_ID ? { ...entry, user_id: ME.id } : entry)),
});

/** Gruppen på Standings ur samma svar: en löpare per rad i svaret, så antalet medlemmar är detsamma. */
const groupOf = (data: PositionHistoryResponse): User[] => data.runners.map((entry, index) => runner(entry.user_id, entry.name, 6000 - index * 100));

/** Rank-pilarnas underlag ur samma positionssvar som grafen: förra veckan (sista avslutade) mot nu. Samma källa, som i backenden. */
function rankDeltaOf(data: PositionHistoryResponse) {
  const finished = data.weeks.length - 2;
  const now = data.weeks.length - 1;
  return {
    success: true,
    data: {
      ...RANK_DELTA,
      users: data.runners.map((entry) => ({
        user_id: entry.user_id, xp: 0, rank: entry.positions[now], previous_xp: 0, previous_rank: entry.positions[finished],
        rank_delta: (entry.positions[finished] ?? 0) - (entry.positions[now] ?? 0),
      })),
    },
  };
}

function renderBoard(entry = '/board', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/board" element={<BoardPage />} />
      <Route path="/runner/:id" element={<div>Runner card</div>} />
    </Routes>,
    { entry, width },
  );
}

/** Som i appen: laddningsgaten ligger över Board. */
function renderGatedBoard(entry: string, width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route element={<FirstBoardGate />}>
        <Route path="/board" element={<BoardPage />} />
      </Route>
    </Routes>,
    { entry, width },
  );
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;

let positionCalls: unknown[][];
let rankDeltaCalls: number;
let titleCalls: number;

beforeEach(() => {
  resetFakeBackend();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  positionCalls = [];
  rankDeltaCalls = 0;
  titleCalls = 0;
  handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
  handlers.getRankDelta = () => {
    rankDeltaCalls += 1;
    return rankDeltaOf(FIVE);
  };
  handlers.getUserTitles = () => {
    titleCalls += 1;
    return { success: true, data: [] };
  };
  handlers.getPositionHistory = (...args: unknown[]) => {
    positionCalls.push(args);
    return { success: true, data: FIVE };
  };
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getGroupBadges.mockRejectedValue(new Error('badges unavailable'));
  vi.mocked(loadPositionView).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('Board: the Position tab', () => {
  describe('the tab row', () => {
    it.each([['mobile', MOBILE], ['desktop', DESKTOP]])('has four tabs with Position last when the group has two or more members (%s)', async (_, width) => {
      renderBoard('/board', width);
      await screen.findByTestId('podium-1');

      expect(tabNames()).toEqual(['All-time', 'Week', 'Streaks', 'Position']);
      expect(selectedTab()).toBe('All-time');
    });

    it('has four tabs for a group of exactly two', async () => {
      handlers.getUsersWithRuns = () => ({ success: true, data: [JOEL, KARL] });
      renderBoard();
      await screen.findByTestId('podium-1');

      expect(tabNames()).toEqual(['All-time', 'Week', 'Streaks', 'Position']);
    });

    it('has three tabs, without Position, when the group has one member', async () => {
      handlers.getUsersWithRuns = () => ({ success: true, data: [JOEL] });
      renderBoard();
      await screen.findByTestId('podium-1');

      expect(tabNames()).toEqual(['All-time', 'Week', 'Streaks']);
    });

    it('selects Position from the address and labels the panel by that tab', async () => {
      renderBoard('/board?view=position');

      expect(await screen.findByRole('img', { name: /^Position over time, weeks/ })).toBeInTheDocument();
      expect(selectedTab()).toBe('Position');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Position' }).id);
      expect(screen.queryByTestId('podium-1')).toBeNull();
    });

    it('moves to Position on a click and writes ?view=position, and back to All-time', async () => {
      renderBoard('/board');
      await screen.findByTestId('podium-1');

      fireEvent.click(screen.getByRole('tab', { name: 'Position' }));
      await waitFor(() => expect(location()).toBe('/board?view=position'));
      expect(await screen.findByRole('img', { name: /^Position over time, weeks/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'All-time' }));
      await waitFor(() => expect(location()).toBe('/board?view=season'));
      expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
    });

    it('reaches Position from the keyboard: End goes to the last tab, ArrowRight from Streaks too, and ArrowRight from Position wraps to All-time', async () => {
      const user = userEvent.setup();
      renderBoard('/board?view=streaks');
      await screen.findByRole('table', { name: 'Streaks' });

      screen.getByRole('tab', { name: 'Streaks' }).focus();
      await user.keyboard('{ArrowRight}');
      expect(selectedTab()).toBe('Position');
      expect(screen.getByRole('tab', { name: 'Position' })).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(selectedTab()).toBe('All-time');
      await user.keyboard('{End}');
      await waitFor(() => expect(location()).toBe('/board?view=position'));
      expect(screen.getByRole('tab', { name: 'Position' })).toHaveFocus();
    });
  });

  describe('one member', () => {
    it('position view falls back to season with one member', async () => {
      handlers.getUsersWithRuns = () => ({ success: true, data: [JOEL] });
      renderBoard('/board?view=position');

      expect(await screen.findByTestId('podium-1')).toBeInTheDocument();
      expect(selectedTab()).toBe('All-time');
      expect(tabNames()).toEqual(['All-time', 'Week', 'Streaks']);
      expect(screen.queryByRole('img', { name: /^Position over time, weeks/ })).toBeNull();
      expect(positionCalls).toHaveLength(0);
      expect(loadPositionView).not.toHaveBeenCalled();
    });

    it('waits for the group before it chooses between Position and All-time, and asks for nothing meanwhile', async () => {
      handlers.getUsersWithRuns = () => new Promise(() => {});
      renderBoard('/board?view=position');

      expect(await screen.findByText('Loading position')).toBeInTheDocument();
      expect(screen.queryByTestId('podium-1')).toBeNull();
      expect(positionCalls).toHaveLength(0);
      expect(rankDeltaCalls).toBe(0);
    });

    it('lands on All-time with its own error card when the group cannot be loaded', async () => {
      handlers.getUsersWithRuns = () => ({ success: false, error: 'boom' });
      renderBoard('/board?view=position');

      expect(await screen.findByRole('alert', {}, SLOW)).toBeInTheDocument();
      expect(selectedTab()).toBe('All-time');
      expect(positionCalls).toHaveLength(0);
    });
  });

  describe('the data', () => {
    it('asks for no positions on the other tabs, and once, for eight weeks, when Position is selected', async () => {
      renderBoard('/board');
      await screen.findByTestId('podium-1');
      fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
      await screen.findByRole('table', { name: 'This week' });
      fireEvent.click(screen.getByRole('tab', { name: 'Streaks' }));
      await screen.findByRole('table', { name: 'Streaks' });
      expect(positionCalls).toHaveLength(0);

      fireEvent.click(screen.getByRole('tab', { name: 'Position' }));
      await screen.findByRole('img', { name: /^Position over time, weeks/ });

      expect(positionCalls).toEqual([[8]]);
    });

    it('shows the loading state while the positions load, and nothing of the other views', async () => {
      handlers.getPositionHistory = () => new Promise(() => {});
      renderBoard('/board?view=position');

      expect(await screen.findByText('Loading position')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /^Position over time, weeks/ })).toBeNull();
      expect(screen.queryByTestId('podium-1')).toBeNull();
    });

    it('shows an error card with Retry when the positions fail, and Retry asks again and draws the chart', async () => {
      let calls = 0;
      let failing = true;
      handlers.getPositionHistory = () => {
        calls += 1;
        return failing ? { success: false, error: 'boom' } : { success: true, data: FIVE };
      };
      renderBoard('/board?view=position');

      const alert = await screen.findByRole('alert', {}, SLOW);
      expect(within(alert).getByText(/Your data is safe/)).toBeInTheDocument();
      expect(calls).toBe(2); // första försöket + det snabba omförsöket
      failing = false;
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('img', { name: /^Position over time, weeks/ })).toBeInTheDocument();
      expect(calls).toBe(3);
    });
  });

  describe('the chunk', () => {
    it('is not requested on the other tabs, not by the pointer over them and not by their focus', async () => {
      renderBoard('/board');
      await screen.findByTestId('podium-1');

      await userEvent.hover(screen.getByRole('tab', { name: 'Week' }));
      screen.getByRole('tab', { name: 'Streaks' }).focus();

      expect(loadPositionView).not.toHaveBeenCalled();
    });

    it('is requested when the pointer moves over the Position tab, before it is clicked', async () => {
      renderBoard('/board');
      await screen.findByTestId('podium-1');

      await userEvent.hover(screen.getByRole('tab', { name: 'Position' }));

      expect(loadPositionView).toHaveBeenCalled();
      expect(positionCalls).toHaveLength(0);
    });

    it('is requested when the Position tab gets keyboard focus', async () => {
      renderBoard('/board');
      await screen.findByTestId('podium-1');

      screen.getByRole('tab', { name: 'Position' }).focus();

      expect(loadPositionView).toHaveBeenCalled();
    });

    it('is requested at once when Position is the selected view, in step with the positions', async () => {
      handlers.getPositionHistory = (...args: unknown[]) => {
        positionCalls.push(args);
        return new Promise(() => {});
      };
      renderBoard('/board?view=position');

      await screen.findByText('Loading position');
      await waitFor(() => expect(loadPositionView).toHaveBeenCalled());
      expect(positionCalls).toEqual([[8]]);
    });
  });

  describe('the modes', () => {
    it.each([[2], [6], [12]])('draws the chart and Current order for a group of %i on mobile and on desktop', async (size) => {
      const data = asMe(packOf(size));
      handlers.getUsersWithRuns = () => ({ success: true, data: groupOf(data) });
      handlers.getPositionHistory = () => ({ success: true, data });
      for (const width of [MOBILE, DESKTOP]) {
        const { container, unmount } = renderBoard('/board?view=position', width);

        expect(await screen.findByRole('img', { name: /^Position over time, weeks/ })).toBeInTheDocument();
        expect(container.querySelectorAll('.rq-board-position__line')).toHaveLength(size);
        expect(screen.getAllByRole('button', { name: /#\d/ })).toHaveLength(size);
        expect(screen.getByText('You')).toBeInTheDocument();
        unmount();
      }
    });

    it('draws a runner who joined in the middle of the period, with the week they joined', async () => {
      const data = asMe(twelve());
      handlers.getUsersWithRuns = () => ({ success: true, data: groupOf(data) });
      handlers.getPositionHistory = () => ({ success: true, data });
      renderBoard('/board?view=position');

      expect(await screen.findByRole('img', { name: /^Position over time, weeks/ })).toBeInTheDocument();
      expect(screen.getByText('Joined W30')).toBeInTheDocument();
    });

    it('draws 26 weeks, the longest period, in the chart and in the table', async () => {
      const weeks = Array.from({ length: 26 }, () => 1);
      const data = responseOf(weeksOf(26, 9), [runnerOf('u-karl', 'Karl Persson', weeks), runnerOf(ME.id, 'Joel Lindberg', weeks.map(() => 2))]);
      handlers.getUsersWithRuns = () => ({ success: true, data: [JOEL, KARL] });
      handlers.getPositionHistory = () => ({ success: true, data });
      renderBoard('/board?view=position');

      expect(await screen.findByRole('img', { name: /^Position over time, weeks 9 to 34/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
      expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(27);
    });

    it('explains a group with no finished week with the same text as the profile, in place of the chart', async () => {
      const data = responseOf(weeksOf(1, 40), [runnerOf('u-karl', 'Karl Persson', [1]), runnerOf(ME.id, 'Joel Lindberg', [2])]);
      handlers.getUsersWithRuns = () => ({ success: true, data: [JOEL, KARL] });
      handlers.getPositionHistory = () => ({ success: true, data });
      renderBoard('/board?view=position');

      expect(await screen.findByText(NO_FINISHED_WEEK_MESSAGE)).toBeInTheDocument();
      expect(NO_FINISHED_WEEK_MESSAGE).toBe('No finished week yet. Position shows where you stood at the end of each week.');
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Position over time' })).toBeInTheDocument();
    });

    it('offers nothing to pick in a group with no finished week: no hint, no buttons and no "Shown" tag, and the order stays as a list', async () => {
      const data = responseOf(weeksOf(1, 40), [runnerOf('u-karl', 'Karl Persson', [1]), runnerOf(ME.id, 'Joel Lindberg', [2])]);
      handlers.getUsersWithRuns = () => ({ success: true, data: [JOEL, KARL] });
      handlers.getPositionHistory = () => ({ success: true, data });
      renderBoard('/board?view=position');
      await screen.findByText(NO_FINISHED_WEEK_MESSAGE);

      expect(screen.queryByText('Pick a runner to lift their line.')).toBeNull();
      expect(screen.queryByText('Shown')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      const order = screen.getByRole('region', { name: 'Current order' });
      expect(within(order).getAllByRole('listitem').map((item) => item.textContent)).toEqual([expect.stringContaining('Karl Persson'), expect.stringContaining('Joel Lindberg')]);
      expect(within(order).getByText('You')).toBeInTheDocument();
    });
  });

  describe('the same standings as the arrows', () => {
    it('shows each runner, in the last finished week of the chart, where the arrow on Standings says they stood the week before', async () => {
      handlers.getRankDelta = () => {
        rankDeltaCalls += 1;
        return rankDeltaOf(FIVE);
      };
      renderBoard('/board');
      await screen.findByTestId('podium-1');

      // Standings: pilen på varje löpares kort eller rad, ur rank-delta (förra veckans placering minus nuvarande).
      const arrowOf = async (name: string) => {
        const row = screen.getByRole('button', { name }).closest('[data-testid^="podium-"], [role="row"]') as HTMLElement;
        const mark = await waitFor(() => {
          const found = row.querySelector('[aria-label^="Up "], [aria-label^="Down "], [aria-label="No change"]');
          expect(found).not.toBeNull();
          return found as HTMLElement;
        });
        return mark.textContent;
      };
      const now = FIVE.weeks.length - 1;
      const finished = FIVE.weeks.length - 2;
      const arrows = new Map<string, string | null>();
      for (const entry of FIVE.runners) arrows.set(entry.name, await arrowOf(entry.name));

      fireEvent.click(screen.getByRole('tab', { name: 'Position' }));
      await screen.findByRole('img', { name: /^Position over time, weeks/ });
      fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);

      for (const entry of FIVE.runners) {
        const delta = (entry.positions[finished] ?? 0) - (entry.positions[now] ?? 0);
        const row = rows.find((candidate) => within(candidate).getByRole('rowheader').textContent?.startsWith(entry.name));
        const cells = within(row as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent);
        expect(cells[finished], `${entry.name}: the last finished week in the table`).toBe(`#${entry.positions[finished]}`);
        expect(cells[now], `${entry.name}: this week so far in the table`).toBe(`#${entry.positions[now]}`);
        expect(arrows.get(entry.name), `${entry.name}: the arrow on Standings`).toBe(delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : '—');
      }
    });
  });

  describe('the surrounding page', () => {
    it('FirstBoardGate and the tour are unaffected by the new view', async () => {
      // Position-vyn: laddningsgaten väntar bara på gruppen (som Week och Streaks), inte på titlar, pilar och badge-minis som vyn inte ritar, och ingen tur startar.
      const position = renderGatedBoard('/board?view=position');
      expect(await screen.findByRole('img', { name: /^Position over time, weeks/ })).toBeInTheDocument();
      expect(rankDeltaCalls).toBe(0);
      expect(titleCalls).toBe(0);
      expect(badgesApi.getGroupBadges).not.toHaveBeenCalled();
      expect(screen.queryByTestId('feature-tour')).toBeNull();
      position.unmount();

      // Season-vyn: gaten väntar fortfarande in dekoren, podiet har sina pilar när det ritas, och touren startar med alla sina ankare på plats, med fyra flikar i raden.
      resetFakeBackend();
      handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
      handlers.getRankDelta = () => {
        rankDeltaCalls += 1;
        return rankDeltaOf(FIVE);
      };
      handlers.getUserTitles = () => {
        titleCalls += 1;
        return { success: true, data: [] };
      };
      handlers.getPositionHistory = () => ({ success: true, data: FIVE });
      badgesApi.getGroupBadges.mockResolvedValue({ members: [], holders: {}, member_count: PACK.length });
      const { container } = renderGatedBoard('/board');
      const first = await screen.findByTestId('podium-1');

      expect(rankDeltaCalls).toBeGreaterThan(0);
      expect(within(first).getByLabelText('Up 1 place')).toBeInTheDocument();
      expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_leaderboard_v2');
      expect(tabNames()).toEqual(['All-time', 'Week', 'Streaks', 'Position']);
      const selectors = TOUR_LEADERBOARD_V1.flatMap((step) => (step.element ? [step.element] : []));
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) expect(container.querySelectorAll(selector)).toHaveLength(1);

      // Och touren följer Season: den lämnar Board-vyn när man går till Position.
      fireEvent.click(screen.getByRole('tab', { name: 'Position' }));
      await screen.findByRole('img', { name: /^Position over time, weeks/ });
      expect(screen.queryByTestId('feature-tour')).toBeNull();
    });
  });
});
