import { describe, expect, it } from 'vitest';
import { BOARD_VIEWS, DEFAULT_BOARD_VIEW, boardViewsFor } from './boardViews';
import { MIN_MEMBERS_FOR_POSITION, showPositionTab } from './positionTab';

// Position-fliken är den fjärde delvyn och finns bara i en grupp på minst två (ADR 007 addendum 2026-10-26): antalet kommer ur users-with-runs som sidan
// redan har, aldrig ur positionssvaret, så att fliken kan döljas utan en extra hämtning.

describe('showPositionTab', () => {
  it('needs at least two members in the group', () => {
    expect(MIN_MEMBERS_FOR_POSITION).toBe(2);
    expect([0, 1].map(showPositionTab)).toEqual([false, false]);
    expect([2, 3, 6, 12].map(showPositionTab)).toEqual([true, true, true, true]);
  });
});

describe('BOARD_VIEWS', () => {
  it('lists Position last, after Streaks, and keeps Season as the default', () => {
    expect([...BOARD_VIEWS]).toEqual(['season', 'week', 'streaks', 'position']);
    expect(DEFAULT_BOARD_VIEW).toBe('season');
  });
});

describe('boardViewsFor', () => {
  it('has the four views in order, Position last, once the group has two members', () => {
    expect([...boardViewsFor(2)]).toEqual(['season', 'week', 'streaks', 'position']);
    expect(boardViewsFor(12).at(-1)).toBe('position');
  });

  it('leaves Position out for a group of one, so that ?view=position falls back like any unknown value', () => {
    expect([...boardViewsFor(1)]).toEqual(['season', 'week', 'streaks']);
    expect([...boardViewsFor(0)]).toEqual(['season', 'week', 'streaks']);
  });
});
