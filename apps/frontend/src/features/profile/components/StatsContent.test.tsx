import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import type { StatRow, StatView } from '../statsModel';
import { StatsContent } from './StatsContent';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// 12:00 i Stockholm, 2026-10-04.
const NOW = new Date('2026-10-04T10:00:00Z');
const SLOW = { timeout: 4000 };

const runner = user({
  id: 'u-karl',
  name: 'Karl Persson',
  total_xp: 5539,
  runs: [run({ id: 'k1', user_id: 'u-karl', date: '2026-10-03', distance: 12 }), run({ id: 'k2', user_id: 'u-karl', date: '2026-10-01', distance: 5 })],
});
const EXTRA: StatRow = { label: 'Extra row', value: '9', tone: 'default' };

function renderContent(view: StatView, extraFunRows?: readonly StatRow[]) {
  return renderWithApp(<StatsContent user={runner} now={NOW} isDesktop view={view} extraFunRows={extraFunRows} />, { width: 1280 });
}

describe('StatsContent', () => {
  it('draws only the content of the view it is given, with no tab row and no panel of its own', async () => {
    renderContent('distance');

    expect(screen.getByLabelText('Distance', { selector: 'dl' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.queryByLabelText('Fun facts', { selector: 'dl' })).toBeNull();
  });

  it('draws the activity map for the consistency view', () => {
    renderContent('consistency');

    expect(screen.getByRole('region', { name: /^Run heatmap: 2 runs on 2 of \d+ days$/ })).toBeInTheDocument();
  });

  it('draws the streak rows once the tiers are loaded', async () => {
    renderContent('streak');

    await waitFor(() => expect(screen.getByLabelText('Streak', { selector: 'dl' })).toBeInTheDocument(), SLOW);
  });

  it('adds the extra rows after the fun facts and to no other view', () => {
    const { unmount } = renderContent('fun', [EXTRA]);
    const labels = within(screen.getByLabelText('Fun facts', { selector: 'dl' })).getAllByRole('term').map((term) => term.textContent);
    expect(labels.at(-1)).toBe('Extra row');
    expect(labels).toContain('Longest gap between runs');
    unmount();

    renderContent('distance', [EXTRA]);
    expect(screen.queryByText('Extra row')).toBeNull();
  });

  it('draws the plain fun facts without extra rows', () => {
    renderContent('fun');

    expect(screen.queryByText('Extra row')).toBeNull();
    expect(within(screen.getByLabelText('Fun facts', { selector: 'dl' })).getAllByRole('term')).toHaveLength(4);
  });
});
