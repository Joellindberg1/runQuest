import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { PositionHistoryResponse } from '@runquest/shared';
import type { User } from '@runquest/types';
import BoardPage from './BoardPage';
import { responseOf, runnerOf, weeksOf } from '@/features/leaderboard/positionBoard.fixture';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
const badgesApi = vi.hoisted(() => ({ getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Position-fliken på Board har två vyer: de senaste åtta veckorna (standard) och "All time" (taket, 104 veckor; servern beskär förledande tomma veckor).

const NOW = new Date('2026-10-04T10:00:00Z');
const SLOW = { timeout: 4000 };

const member = (id: string, name: string, xp: number): User => ({
  ...ME, id, name, total_xp: xp, total_km: 500, current_streak: 0, longest_streak: 0, runs: [], challenge_counts: {},
});
const GROUP = [member(ME.id, 'Joel Lindberg', 5243), member('u-karl', 'Karl Persson', 5539), member('u-adam', 'Adam Einstein', 4736)];

/** Svar för `weekCount` veckor, tre löpare; vecka 1 först. Den inloggade är ME. */
const historyOf = (weekCount: number): PositionHistoryResponse =>
  responseOf(weeksOf(weekCount, 1), [
    runnerOf('u-karl', 'Karl Persson', Array.from({ length: weekCount }, (_, i) => (i % 2 === 0 ? 1 : 2))),
    runnerOf(ME.id, 'Joel Lindberg', Array.from({ length: weekCount }, (_, i) => (i % 2 === 0 ? 2 : 1))),
    runnerOf('u-adam', 'Adam Einstein', Array.from({ length: weekCount }, () => 3)),
  ]);

const EIGHT = historyOf(8);
const FORTY_FOUR = historyOf(44);

const location = () => screen.getByTestId('location').textContent;
const rangeSwitch = () => screen.getByRole('group', { name: 'Position range' });
const rangeButton = (name: string) => within(rangeSwitch()).getByRole('button', { name });
const chartName = () => screen.getByRole('img', { name: /^Position over time, weeks/ }).getAttribute('aria-label') ?? '';

function renderBoard(entry = '/board?view=position') {
  return renderWithApp(
    <Routes>
      <Route path="/board" element={<BoardPage />} />
      <Route path="/runner/:id" element={<div>Runner card</div>} />
    </Routes>,
    { entry, width: 1280 },
  );
}

let positionCalls: unknown[][];

beforeEach(() => {
  resetFakeBackend();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  positionCalls = [];
  handlers.getUsersWithRuns = () => ({ success: true, data: GROUP });
  handlers.getPositionHistory = (...args: unknown[]) => {
    positionCalls.push(args);
    return { success: true, data: args[0] === 104 ? FORTY_FOUR : EIGHT };
  };
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getGroupBadges.mockRejectedValue(new Error('badges unavailable'));
});
afterEach(() => vi.useRealTimers());

describe('Board Position: the range switch', () => {
  it('has a switch named "Position range" above the chart, with "Last 8 weeks" chosen and "All time" next to it', async () => {
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });

    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'false');
    expect(within(rangeSwitch()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Last 8 weeks', 'All time']);
    expect(rangeSwitch().compareDocumentPosition(screen.getByRole('img', { name: /^Position over time, weeks/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(positionCalls).toEqual([[8]]);
    expect(chartName()).toContain('weeks 1 to 8');
  });

  it('shows the switch while the positions load, so the choice is there before the chart is', async () => {
    handlers.getPositionHistory = () => new Promise(() => {});
    renderBoard();

    expect(await screen.findByRole('group', { name: 'Position range' })).toBeInTheDocument();
    expect(screen.getByText('Loading position')).toBeInTheDocument();
    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
  });

  it('All time asks for the cap, 104 weeks, draws the weeks the answer has, and writes nothing to the address', async () => {
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });

    fireEvent.click(rangeButton('All time'));
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 44'));

    expect(positionCalls).toEqual([[8], [104]]);
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'true');
    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'false');
    expect(location()).toBe('/board?view=position');
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(45);
  });

  it('keeps the old chart, marked busy, while the other range loads, and never an empty box', async () => {
    let finish: (value: { success: true; data: PositionHistoryResponse }) => void = () => undefined;
    handlers.getPositionHistory = (...args: unknown[]) =>
      args[0] === 104 ? new Promise((resolve) => { finish = resolve; }) : { success: true, data: EIGHT };
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });

    fireEvent.click(rangeButton('All time'));

    await waitFor(() => expect(screen.getByRole('img', { name: /^Position over time, weeks 1 to 8/ }).closest('[aria-busy="true"]')).not.toBeNull());
    expect(screen.queryByText('Loading position')).toBeNull();
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'true');

    finish({ success: true, data: FORTY_FOUR });
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 44'));
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('goes back to the eight weeks from All time, and asks for the number of weeks of the chosen view each time', async () => {
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });
    fireEvent.click(rangeButton('All time'));
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 44'));

    fireEvent.click(rangeButton('Last 8 weeks'));

    await waitFor(() => expect(chartName()).toContain('weeks 1 to 8'));
    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
    // Testklientens gcTime är 0, så den första vyn ligger inte kvar i cachen här; att varje vy har sin egen cachepost prövas i usePositionHistory.test (frågenyckeln per antal veckor).
    expect(positionCalls.map((call) => call[0])).toEqual([8, 104, 8]);
  });

  it('is one tab stop and the arrows switch the view', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });

    expect(rangeButton('Last 8 weeks')).toHaveAttribute('tabindex', '0');
    expect(rangeButton('All time')).toHaveAttribute('tabindex', '-1');
    rangeButton('Last 8 weeks').focus();
    await user.keyboard('{ArrowRight}');

    expect(rangeButton('All time')).toHaveFocus();
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 44'));
    await user.keyboard('{ArrowLeft}');
    expect(rangeButton('Last 8 weeks')).toHaveFocus();
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 8'));
  });

  it('is reset when the tab is opened again', async () => {
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });
    fireEvent.click(rangeButton('All time'));
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 44'));

    fireEvent.click(screen.getByRole('tab', { name: 'Streaks' }));
    await screen.findByRole('table', { name: 'Streaks' });
    fireEvent.click(screen.getByRole('tab', { name: 'Position' }));

    await screen.findByRole('img', { name: /^Position over time, weeks/ });
    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
    expect(chartName()).toContain('weeks 1 to 8');
    expect(location()).toBe('/board?view=position');
  });

  it('a failed All time shows the error card with Retry and keeps the switch, so Last 8 weeks is one click away', async () => {
    let failing = true;
    handlers.getPositionHistory = (...args: unknown[]) => {
      positionCalls.push(args);
      if (args[0] === 104) return failing ? { success: false, error: 'boom' } : { success: true, data: FORTY_FOUR };
      return { success: true, data: EIGHT };
    };
    renderBoard();
    await screen.findByRole('img', { name: /^Position over time, weeks/ });

    fireEvent.click(rangeButton('All time'));
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(screen.queryByRole('img', { name: /^Position over time, weeks/ })).toBeNull();
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'true');

    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 44'));

    fireEvent.click(rangeButton('Last 8 weeks'));
    await waitFor(() => expect(chartName()).toContain('weeks 1 to 8'));
  });

  it('offers no switch to a group without a finished week: both views would be the same', async () => {
    const data = responseOf(weeksOf(1, 40), [runnerOf('u-karl', 'Karl Persson', [1]), runnerOf(ME.id, 'Joel Lindberg', [2])]);
    handlers.getUsersWithRuns = () => ({ success: true, data: GROUP.slice(0, 2) });
    handlers.getPositionHistory = () => ({ success: true, data });
    renderBoard();

    await screen.findByText('No finished week yet. Position shows where you stood at the end of each week.');
    expect(screen.queryByRole('group', { name: 'Position range' })).toBeNull();
  });
});
