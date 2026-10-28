import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Run } from '@runquest/types';
import { renderWithApp } from '@/test/renderApp';
import { run } from '../profile.fixture';
import { RunHistory } from './RunHistory';

// Vymodellens regler (formatering, null/0/NaN, ord för skärmläsare) provas i profileModel.test.ts; här provas kopplingen: vad kortet visar och när.

const TODAY = '2026-10-04';

const RUNS: Run[] = [
  run({ id: 'a', date: '2026-08-21', distance: 10, moving_time: 3130 }),
  run({ id: 'b', date: '2026-08-08', distance: 7.5, moving_time: 2407 }),
  run({ id: 'c', date: '2026-08-06', distance: 10, moving_time: 3210 }),
  run({ id: 'd', date: '2026-07-31', distance: 6, moving_time: null, is_treadmill: true }),
  run({ id: 'e', date: '2026-07-20', distance: 5, moving_time: 1500 }),
];

const renderHistory = (runs: Run[] = RUNS) => renderWithApp(<RunHistory runs={runs} today={TODAY} />);
const summary = () => screen.getByRole('group', { name: 'Time of the runs shown' });

describe('run history rows', () => {
  it('a row shows Time and pace with one screen reader sentence, and a dash with hidden text when the run has no time', () => {
    renderHistory();
    const rows = within(screen.getByRole('list', { name: 'Your runs' })).getAllByRole('listitem');
    expect(within(rows[0]).getByText('Time 52:10, pace 5:13 per kilometre')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Time')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('Total time')).toBeNull();
    expect(within(rows[3]).getByText('no time recorded')).toBeInTheDocument();
    expect(within(rows[3]).getAllByText('—')).toHaveLength(2);
  });
});

describe('run history summary', () => {
  it('run history summary follows the rows shown and updates on show all', async () => {
    const user = userEvent.setup();
    renderHistory();
    expect(within(summary()).getByText('Total time 2 hours 25 minutes 47 seconds, pace 5:18 per kilometre')).toBeInTheDocument();
    expect(within(summary()).getByText('2:25:47')).toBeInTheDocument();
    expect(within(summary()).getByText('5:18 /km')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all 5 runs' }));
    expect(within(summary()).getByText('Total time 2 hours 50 minutes 47 seconds, pace 5:15 per kilometre')).toBeInTheDocument();
    expect(within(summary()).getByText('2:50:47')).toBeInTheDocument();
    expect(within(summary()).getByText('5:15 /km')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(within(summary()).getByText('2:25:47')).toBeInTheDocument();
  });

  it('run history summary shows based on N of M runs only when some runs lack time', async () => {
    const user = userEvent.setup();
    renderHistory();
    expect(within(summary()).getByText('based on 3 of 4 runs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all 5 runs' }));
    expect(within(summary()).getByText('based on 4 of 5 runs')).toBeInTheDocument();
  });

  it('run history summary without a gap in the times does not say based on', () => {
    renderHistory(RUNS.filter((r) => r.id !== 'd'));
    expect(within(summary()).getByText('2:50:47')).toBeInTheDocument();
    expect(within(summary()).queryByText(/based on/)).toBeNull();
  });

  it('run history summary with no timed run shows dashes', () => {
    renderHistory(RUNS.map((r) => ({ ...r, moving_time: null })));
    expect(within(summary()).getAllByText('—')).toHaveLength(2);
    expect(within(summary()).getByText('Total time: no time recorded')).toBeInTheDocument();
  });

  it('run history summary never renders NaN', () => {
    const odd: Run[] = [
      run({ id: 'n1', date: '2026-08-21', moving_time: Number.NaN }),
      run({ id: 'n2', date: '2026-08-20', moving_time: undefined }),
      run({ id: 'n3', date: '2026-08-19', moving_time: 0 }),
      run({ id: 'n4', date: '2026-08-18', distance: 0, moving_time: 1800 }),
    ];
    const { container } = renderHistory(odd);
    expect(container.textContent).not.toMatch(/NaN|Infinity|0:00/);
  });
});
