import { describe, expect, it } from 'vitest';
import { MAX_WEEK_LABELS, weekTickIndexes } from './positionWeekTicks';

describe('weekTickIndexes', () => {
  it('labels every week up to the default period of eight', () => {
    expect(MAX_WEEK_LABELS).toBe(8);
    expect(weekTickIndexes(1)).toEqual([0]);
    expect(weekTickIndexes(2)).toEqual([0, 1]);
    expect(weekTickIndexes(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('thins a longer period from the week in progress backwards, so the last label is always there', () => {
    expect(weekTickIndexes(9)).toEqual([0, 2, 4, 6, 8]);
    const long = weekTickIndexes(26);
    expect(long.at(-1)).toBe(25);
    expect(long.length).toBeLessThanOrEqual(MAX_WEEK_LABELS);
    const steps = new Set(long.slice(1).map((index, i) => index - long[i]));
    expect(steps.size).toBe(1);
  });

  it('gives no labels for no weeks', () => {
    expect(weekTickIndexes(0)).toEqual([]);
  });
});
