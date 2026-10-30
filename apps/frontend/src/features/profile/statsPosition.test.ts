import { describe, expect, it } from 'vitest';
import { showPositionTab } from '@/features/leaderboard/positionTab';
import { POSITION_VIEW, statViewsFor, STAT_VIEWS } from './statsModel';

// Position-fliken (femte fliken) hör till profilens statistikpanel men visas bara för en grupp på minst två: antalet kommer ur users-with-runs,
// aldrig ur positionssvaret (ADR 007 addendum 2026-10-26), så att fliken kan döljas utan en extra hämtning.

describe('showPositionTab', () => {
  it('needs at least two members in the group', () => {
    expect([0, 1].map(showPositionTab)).toEqual([false, false]);
    expect([2, 3, 6, 12].map(showPositionTab)).toEqual([true, true, true, true]);
  });
});

describe('statViewsFor', () => {
  it('lists the five views in the designed order with Position last once the group has two members', () => {
    expect([...statViewsFor(2)]).toEqual(['distance', 'streak', 'fun', 'consistency', 'position']);
    expect(statViewsFor(6).at(-1)).toBe(POSITION_VIEW);
  });

  it('leaves Position out for a group of one, so that ?view=position falls back like any unknown value', () => {
    expect([...statViewsFor(1)]).toEqual([...STAT_VIEWS]);
    expect(statViewsFor(1)).not.toContain(POSITION_VIEW);
  });
});
