import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { setViewportWidth } from '@/test/viewport';
import { LandingFeatures } from './LandingFeatures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LandingFeatures', () => {
  it('funktionsrutnätet har sex kort i en lista med h3 per kort', () => {
    render(<LandingFeatures />);
    const section = screen.getByRole('region', { name: "What's in the game" });
    const cards = within(section).getAllByRole('listitem');
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Leaderboard', 'Titles', 'Challenges', 'Events', 'Strava sync', 'The journey',
    ]);
    expect(cards.map((card) => card.textContent?.slice(0, 2))).toEqual(['01', '02', '03', '04', '05', '06']);
  });

  it('är ett ankarmål för headerns Titles-länk', () => {
    render(<LandingFeatures />);
    expect(screen.getByRole('region', { name: "What's in the game" })).toHaveAttribute('id', 'features');
  });

  it.each([[390], [1440]])('funktionsrutnätet finns på både mobil och desktop (%i px)', (width) => {
    setViewportWidth(width);
    render(<LandingFeatures />);
    expect(within(screen.getByRole('region', { name: "What's in the game" })).getAllByRole('listitem')).toHaveLength(6);
  });
});
