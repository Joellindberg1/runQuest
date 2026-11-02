import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';
import { handlers, ME, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import type { ProfileStatView } from '../statsModel';
import { StatsPanel } from './StatsPanel';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// Position-fliken på profilen har två vyer, som Board: de senaste åtta veckorna (standard) och "All time" (taket, 104 veckor). Best, Lowest och Now räknas på vald vy.

const NOW = new Date('2026-10-04T10:00:00Z');
const ME_ROW = user({ id: ME.id, name: ME.name, total_xp: 5243, runs: [run({ id: 'm1', date: '2026-10-03', distance: 12 })] });

const weeksOf = (count: number): PositionWeek[] =>
  Array.from({ length: count }, (_, i) => ({ start: '2026-01-05', end: '2026-01-11', iso_week: 1 + i, iso_year: 2026, is_current_week: i === count - 1 }));
const runner = (id: string, positions: Array<number | null>): PositionRunner => ({ user_id: id, name: id, profile_picture: null, member_since: null, positions });
const historyOf = (mine: Array<number | null>): PositionHistoryResponse => ({
  as_of: '2026-10-04',
  weeks: weeksOf(mine.length),
  runners: [runner(ME.id, mine), runner('other', mine.map(() => 1))],
});

// Åtta veckor: bäst #3. Fyrtiofyra veckor: bäst #1 tidigt, sämst #6.
const EIGHT = historyOf([4, 3, 3, 4, 4, 3, 4, 3]);
const FORTY_FOUR = historyOf(Array.from({ length: 44 }, (_, i) => (i < 5 ? 1 : i === 20 ? 6 : i >= 36 ? 3 + (i % 2) : 2)));

const getPositionHistory = vi.fn();

function Host() {
  const [view, setView] = useState<ProfileStatView>('position');
  return <StatsPanel user={ME_ROW} now={NOW} isDesktop view={view} onChange={setView} label="Your stats" showPosition />;
}

const rangeSwitch = () => screen.getByRole('group', { name: 'Position range' });
const rangeButton = (name: string) => within(rangeSwitch()).getByRole('button', { name });
const chart = () => screen.getByRole('img', { name: /^Position in the group/ });
const stats = () => document.querySelector('.rq-profile-position__stats')!;

beforeEach(() => {
  resetFakeBackend();
  getPositionHistory.mockReset();
  getPositionHistory.mockImplementation((weeks: number) => Promise.resolve({ success: true, data: weeks === 104 ? FORTY_FOUR : EIGHT }));
  handlers.getPositionHistory = getPositionHistory;
});

describe('StatsPanel Position: the range switch', () => {
  it('has a switch named "Position range" above the chart, with "Last 8 weeks" chosen, and asks for eight weeks once', async () => {
    renderWithApp(<Host />, { entry: '/profile' });
    await screen.findByRole('img', { name: /^Position in the group/ });

    expect(within(rangeSwitch()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Last 8 weeks', 'All time']);
    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'false');
    expect(rangeSwitch().compareDocumentPosition(chart()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getPositionHistory).toHaveBeenCalledExactlyOnceWith(8);
    expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 8');
  });

  it('All time asks for 104 weeks and draws the weeks the answer has, with Best, Lowest and Now for that view', async () => {
    renderWithApp(<Host />, { entry: '/profile' });
    await screen.findByRole('img', { name: /^Position in the group/ });
    expect(stats()).toHaveTextContent('Best #3');
    expect(stats()).toHaveTextContent('Lowest #4');

    await userEvent.click(rangeButton('All time'));
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 44'));

    expect(getPositionHistory).toHaveBeenLastCalledWith(104);
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'true');
    expect(stats()).toHaveTextContent('Best #1 · 5 of 43 weeks');
    expect(stats()).toHaveTextContent('Lowest #6');
    expect(stats()).toHaveTextContent('Now #4');
  });

  it('keeps the old chart, marked busy, while the other range loads, and never an empty box', async () => {
    let finish: (value: { success: true; data: PositionHistoryResponse }) => void = () => undefined;
    getPositionHistory.mockImplementation((weeks: number) =>
      weeks === 104 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ success: true, data: EIGHT }),
    );
    renderWithApp(<Host />, { entry: '/profile' });
    await screen.findByRole('img', { name: /^Position in the group/ });

    await userEvent.click(rangeButton('All time'));

    await waitFor(() => expect(chart().closest('[aria-busy="true"]')).not.toBeNull());
    expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 8');
    expect(screen.queryByText('Loading position')).toBeNull();

    finish({ success: true, data: FORTY_FOUR });
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 44'));
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('is one tab stop and the arrows switch the view', async () => {
    renderWithApp(<Host />, { entry: '/profile' });
    await screen.findByRole('img', { name: /^Position in the group/ });

    expect(rangeButton('Last 8 weeks')).toHaveAttribute('tabindex', '0');
    expect(rangeButton('All time')).toHaveAttribute('tabindex', '-1');
    rangeButton('Last 8 weeks').focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(rangeButton('All time')).toHaveFocus();
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 44'));
    await userEvent.keyboard('{ArrowLeft}');
    expect(rangeButton('Last 8 weeks')).toHaveFocus();
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 8'));
  });

  it('is reset when the tab is opened again', async () => {
    renderWithApp(<Host />, { entry: '/profile' });
    await screen.findByRole('img', { name: /^Position in the group/ });
    await userEvent.click(rangeButton('All time'));
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 44'));

    await userEvent.click(screen.getByRole('tab', { name: 'Streak' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Position' }));

    await screen.findByRole('img', { name: /^Position in the group/ });
    expect(rangeButton('Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
    expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 8');
  });

  it('a failed All time shows the error card with Retry and keeps the switch, so Last 8 weeks is one click away', async () => {
    let failing = true;
    getPositionHistory.mockImplementation((weeks: number) => {
      if (weeks === 104) return Promise.resolve(failing ? { success: false, error: 'down' } : { success: true, data: FORTY_FOUR });
      return Promise.resolve({ success: true, data: EIGHT });
    });
    renderWithApp(<Host />, { entry: '/profile' });
    await screen.findByRole('img', { name: /^Position in the group/ });

    await userEvent.click(rangeButton('All time'));
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(screen.queryByRole('img', { name: /^Position in the group/ })).toBeNull();
    expect(rangeButton('All time')).toHaveAttribute('aria-pressed', 'true');

    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 44'));
    await userEvent.click(rangeButton('Last 8 weeks'));
    await waitFor(() => expect(chart().getAttribute('aria-label')).toContain('weeks 1 to 8'));
  });

  it.each([
    ['no finished week', historyOf([1])],
    ['a first week in the group', historyOf([null, null, 3])],
  ])('offers no switch when there is %s: both views would be the same', async (_label, data) => {
    getPositionHistory.mockResolvedValue({ success: true, data });
    renderWithApp(<Host />, { entry: '/profile' });

    await waitFor(() => expect(getPositionHistory).toHaveBeenCalled());
    await screen.findByText(/No finished week yet|First week in the group/);
    expect(screen.queryByRole('group', { name: 'Position range' })).toBeNull();
  });
});
