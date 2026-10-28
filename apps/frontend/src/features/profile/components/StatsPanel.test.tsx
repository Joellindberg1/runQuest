import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import type { StatView } from '../statsModel';
import { StatsPanel } from './StatsPanel';

// 12:00 i Stockholm, 2026-10-04.
const NOW = new Date('2026-10-04T10:00:00Z');

const runner = user({
  id: 'u-karl',
  name: 'Karl Persson',
  total_xp: 5539,
  runs: [run({ id: 'k1', user_id: 'u-karl', date: '2026-10-03', distance: 12 }), run({ id: 'k2', user_id: 'u-karl', date: '2026-10-01', distance: 5 })],
});

function renderPanel(view: StatView, props: { label?: string; dataTour?: string } = {}) {
  const onChange = vi.fn();
  renderWithApp(<StatsPanel user={runner} now={NOW} isDesktop view={view} onChange={onChange} label={props.label ?? 'Runner stats'} dataTour={props.dataTour} />, {
    entry: '/profile?view=streak',
  });
  return onChange;
}

describe('StatsPanel', () => {
  it('shows the view its host passes in and reports a tab click without touching the address', async () => {
    const onChange = renderPanel('fun');

    // Adressen säger streak, men värden säger fun: panelen läser inte adressen.
    expect(screen.getByRole('tab', { name: 'Fun facts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Longest gap between runs');

    await userEvent.click(screen.getByRole('tab', { name: 'Consistency' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('consistency');
    expect(screen.getByTestId('location')).toHaveTextContent('/profile?view=streak');
    expect(screen.getByRole('tab', { name: 'Fun facts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('names the region and the tab row from its label prop', () => {
    renderPanel('distance', { label: 'Runner stats' });

    expect(screen.getByRole('region', { name: 'Runner stats' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Runner stats' })).toBeInTheDocument();
  });

  it('puts the tour anchor on the card only when the host passes one', () => {
    const { unmount } = renderWithApp(<StatsPanel user={runner} now={NOW} isDesktop view="distance" onChange={vi.fn()} label="Your stats" dataTour="profile-stats" />);
    expect(screen.getByRole('region', { name: 'Your stats' })).toHaveAttribute('data-tour', 'profile-stats');
    unmount();

    renderWithApp(<StatsPanel user={runner} now={NOW} isDesktop view="distance" onChange={vi.fn()} label="Runner stats" />);
    expect(screen.getByRole('region', { name: 'Runner stats' })).not.toHaveAttribute('data-tour');
  });
});
