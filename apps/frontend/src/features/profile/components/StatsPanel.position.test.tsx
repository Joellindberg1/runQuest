import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';
import { handlers, ME, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import type { StatView } from '../statsModel';
import { StatsPanel } from './StatsPanel';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// Position-fliken i profilens statistikpanel: femte fliken, hämtning bara när den är vald, och lägena laddning, fel, hidden, no-finished-week, new-runner och ready.

const NOW = new Date('2026-10-04T10:00:00Z');
const ME_ROW = user({ id: ME.id, name: ME.name, total_xp: 5243, runs: [run({ id: 'm1', date: '2026-10-03', distance: 12 })] });

const week = (isoWeek: number, current: boolean): PositionWeek => ({
  start: '2026-07-06',
  end: '2026-07-12',
  iso_week: isoWeek,
  iso_year: 2026,
  is_current_week: current,
});
const weeksOf = (count: number): PositionWeek[] => Array.from({ length: count }, (_, i) => week(27 + i, i === count - 1));
const runner = (id: string, positions: Array<number | null>): PositionRunner => ({ user_id: id, name: id, profile_picture: null, member_since: null, positions });
const historyOf = (mine: Array<number | null>, others = 1): PositionHistoryResponse => ({
  as_of: '2026-10-04',
  weeks: weeksOf(mine.length),
  runners: [runner(ME.id, mine), ...Array.from({ length: others }, (_, i) => runner(`other-${i}`, mine.map(() => null)))],
});

const getPositionHistory = vi.fn();

// Värden äger `view` (profilen: adressen); här ett lokalt tillstånd, så att flikklick faktiskt byter flik.
function Host({ initial, showPosition, onChange }: { initial: StatView; showPosition: boolean; onChange: (view: StatView) => void }) {
  const [view, setView] = useState(initial);
  return (
    <StatsPanel
      user={ME_ROW}
      now={NOW}
      isDesktop
      view={view}
      onChange={(next) => {
        onChange(next);
        setView(next);
      }}
      label="Your stats"
      showPosition={showPosition}
    />
  );
}

function renderPanel(view: StatView, { showPosition = true }: { showPosition?: boolean } = {}) {
  const onChange = vi.fn();
  renderWithApp(<Host initial={view} showPosition={showPosition} onChange={onChange} />, { entry: '/profile' });
  return { onChange };
}

beforeEach(() => {
  resetFakeBackend();
  getPositionHistory.mockReset();
  handlers.getPositionHistory = getPositionHistory;
});

describe('StatsPanel — the Position tab', () => {
  it('has five tabs in the order Distance, Streak, Fun facts, Consistency, Position', () => {
    renderPanel('distance');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Distance', 'Streak', 'Fun facts', 'Consistency', 'Position']);
  });

  it('keeps the four original tabs when the host does not ask for Position', () => {
    renderPanel('distance', { showPosition: false });

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Distance', 'Streak', 'Fun facts', 'Consistency']);
  });

  it('reports a click on Position to the host', async () => {
    const { onChange } = renderPanel('distance');

    await userEvent.click(screen.getByRole('tab', { name: 'Position' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('position');
  });

  it('sends no position request on the other tabs and one request for eight weeks when Position is selected', async () => {
    getPositionHistory.mockResolvedValue({ success: true, data: historyOf([1, 1, 2]) });
    renderPanel('distance');
    for (const name of ['Streak', 'Fun facts', 'Consistency', 'Distance']) {
      await userEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    }
    expect(getPositionHistory).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'Position' }));

    await screen.findByRole('img', { name: /^Position in the group/ });
    expect(getPositionHistory).toHaveBeenCalledExactlyOnceWith(8);
  });

  it('draws the chart for the runner of the profile, in a tabpanel labelled by the Position tab', async () => {
    getPositionHistory.mockResolvedValue({ success: true, data: historyOf([1, 1, 2, 1]) });
    renderPanel('position');

    const chart = await screen.findByRole('img', { name: /^Position in the group, weeks 27 to 30/ });

    const panel = screen.getByRole('tabpanel');
    expect(panel).toContainElement(chart);
    expect(panel).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Position' }).id);
    expect(screen.getByRole('tab', { name: 'Position' })).toHaveAttribute('aria-selected', 'true');
    expect(panel.querySelector('.rq-profile-position__stats')).toHaveTextContent('Best #1 · 2 of 3 weeks');
    expect(panel.querySelector('.rq-profile-position__stats')).toHaveTextContent('Now #1');
  });

  it('shows the track loader while the position history is on its way', async () => {
    getPositionHistory.mockReturnValue(new Promise(() => {}));
    renderPanel('position');

    expect(await screen.findByText('Loading position')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Position in the group/ })).toBeNull();
  });

  it('shows an error card with Retry when the position history fails, and Retry fetches again', async () => {
    getPositionHistory.mockResolvedValue({ success: false, error: 'down' });
    renderPanel('position');

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(within(alert).getByRole('heading', { name: "Couldn't load your position" })).toBeInTheDocument();
    const callsBefore = getPositionHistory.mock.calls.length;

    getPositionHistory.mockResolvedValue({ success: true, data: historyOf([1, 2]) });
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    await screen.findByRole('img', { name: /^Position in the group/ });
    expect(getPositionHistory.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('draws nothing but an empty panel in the hidden mode (the runner has no live placement)', async () => {
    getPositionHistory.mockResolvedValue({ success: true, data: historyOf([1, null]) });
    renderPanel('position');

    await waitFor(() => expect(getPositionHistory).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('tabpanel')).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains that there is no finished week yet when only the current week exists', async () => {
    getPositionHistory.mockResolvedValue({ success: true, data: historyOf([1]) });
    renderPanel('position');

    expect(await screen.findByText('No finished week yet. Position shows where you stood at the end of each week.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Position in the group/ })).toBeNull();
  });

  it('says that the first week in the group is not over when the runner has no finished week of their own', async () => {
    getPositionHistory.mockResolvedValue({ success: true, data: historyOf([null, null, 3]) });
    renderPanel('position');

    expect(await screen.findByText('First week in the group. Position appears after your first week')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Position in the group/ })).toBeNull();
  });
});
