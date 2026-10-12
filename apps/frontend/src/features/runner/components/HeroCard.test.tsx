import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RunnerHero } from '../runnerModel';
import { HeroCard } from './HeroCard';

const hero = (runs: number): RunnerHero => ({
  id: 'u-1', name: 'Karl Persson', level: 3, ringTurn: 0.4, rank: 2, runs, xpToNext: 120, nextLevel: 4,
});

describe('HeroCard — rundor i singular och plural (RUN-140)', () => {
  it.each([
    [0, '#2 in the group · 0 runs'],
    [1, '#2 in the group · 1 run'],
    [2, '#2 in the group · 2 runs'],
    [1234, '#2 in the group · 1 234 runs'],
  ])('%i rundor visas som "%s"', (runs, expected) => {
    render(<HeroCard hero={hero(runs)} cells={[]} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
