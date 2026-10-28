import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { zoneDay } from '@runquest/shared';
import { ME } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '../profile.fixture';
import { Heatmap } from './Heatmap';

// 12:00 i Stockholm, 2026-10-04. Den inloggade (ME) är någon annan än löparen som ritas.
const NOW = new Date('2026-10-04T10:00:00Z');

const runner = user({
  id: 'u-karl',
  name: 'Karl Persson',
  total_xp: 5539,
  current_streak: 2,
  longest_streak: 9,
  runs: [
    run({ id: 'k1', user_id: 'u-karl', date: '2026-10-03', distance: 12 }),
    run({ id: 'k2', user_id: 'u-karl', date: '2026-10-02', distance: 5 }),
    run({ id: 'k3', user_id: 'u-karl', date: '2026-09-20', distance: 8 }),
  ],
});

describe('Heatmap', () => {
  it("renders another user's runs from its props", () => {
    expect(ME.id).not.toBe(runner.id);
    renderWithApp(<Heatmap user={runner} today={zoneDay(NOW)} now={NOW} isDesktop />);

    // Sammanfattningen och summan kommer ur Karls rundor, inte ur den inloggades.
    expect(screen.getByRole('region', { name: /^Run heatmap: 3 runs on 3 of \d+ days$/ })).toBeInTheDocument();
    expect(screen.getByText(/^runs in the last \d+ months$/).previousElementSibling).toHaveTextContent('3');
    expect(screen.getByRole('img', { name: '2026-10-03 · 12.0 km · 1 run' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2026-09-20 · 8.0 km · 1 run' })).toBeInTheDocument();
    expect(screen.getByText('longest streak').nextElementSibling).toHaveTextContent('9');
    expect(screen.getByText('current streak').nextElementSibling).toHaveTextContent('2');
  });
});
