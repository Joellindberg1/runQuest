import { describe, expect, it } from 'vitest';
import { MAX_WEEK_LABELS, WEEK_LABEL_PITCH_PX, weekLabelBudget, weekTickIndexes, weekTickStride } from './positionWeekTicks';

describe('weekTickIndexes', () => {
  it('labels every week up to the default period of eight', () => {
    expect(MAX_WEEK_LABELS).toBe(8);
    expect(weekTickIndexes(1)).toEqual([0]);
    expect(weekTickIndexes(2)).toEqual([0, 1]);
    expect(weekTickIndexes(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('thins a longer period with equal steps from the week in progress, and always keeps the first week', () => {
    expect(weekTickIndexes(9)).toEqual([0, 2, 4, 6, 8]);
    expect(weekTickIndexes(26)).toEqual([0, 5, 9, 13, 17, 21, 25]);
    expect(weekTickIndexes(44)).toEqual([0, 8, 15, 22, 29, 36, 43]);
    expect(weekTickIndexes(104)).toEqual([0, 28, 43, 58, 73, 88, 103]);
  });

  it('keeps the gap between any two labels at least the stride, for every length from one to 104 weeks', () => {
    for (let weekCount = 1; weekCount <= 104; weekCount += 1) {
      const ticks = weekTickIndexes(weekCount);
      const stride = weekTickStride(weekCount);
      expect(ticks[0], `${weekCount} weeks: first`).toBe(0);
      expect(ticks.at(-1), `${weekCount} weeks: week in progress`).toBe(weekCount - 1);
      expect(ticks.length, `${weekCount} weeks: label count`).toBeLessThanOrEqual(MAX_WEEK_LABELS);
      ticks.slice(1).forEach((index, i) => expect(index - ticks[i], `${weekCount} weeks: gap before index ${index}`).toBeGreaterThanOrEqual(stride));
    }
  });

  it('gives no labels for no weeks', () => {
    expect(weekTickIndexes(0)).toEqual([]);
  });

  it('a narrow chart gets fewer labels than the eight a wide one gets, never closer than the stride, for a period over eight weeks', () => {
    expect(weekTickIndexes(44, 4)).toEqual([0, 28, 43]);
    expect(weekTickIndexes(44, 2)).toEqual([0, 43]);
    expect(weekTickIndexes(26, 5)).toEqual([0, 11, 18, 25]);
    for (const maxLabels of [2, 3, 4, 5, 6, 7, 8]) {
      for (const weekCount of [9, 12, 26, 44, 104]) {
        const ticks = weekTickIndexes(weekCount, maxLabels);
        const stride = weekTickStride(weekCount, maxLabels);
        expect(ticks.length, `${weekCount} weeks, room for ${maxLabels}`).toBeLessThanOrEqual(maxLabels);
        expect(ticks[0]).toBe(0);
        expect(ticks.at(-1)).toBe(weekCount - 1);
        ticks.slice(1).forEach((index, i) => expect(index - ticks[i]).toBeGreaterThanOrEqual(stride));
      }
    }
  });

  it('the default period of eight weeks (and anything shorter) keeps a label per week, whatever the room', () => {
    expect(weekTickIndexes(8, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(weekTickIndexes(3, 2)).toEqual([0, 1, 2]);
  });
});

describe('weekLabelBudget', () => {
  it('gives room for one label per pitch across the field, with one more for the end of the field, between two and eight', () => {
    expect(WEEK_LABEL_PITCH_PX).toBe(24);
    expect(weekLabelBudget(120)).toBe(6);
    expect(weekLabelBudget(175)).toBe(8);
    expect(weekLabelBudget(196)).toBe(8);
    expect(weekLabelBudget(612)).toBe(MAX_WEEK_LABELS);
    expect(weekLabelBudget(30)).toBe(2);
    expect(weekLabelBudget(1)).toBe(2);
  });

  it('is the full eight until the field has been measured', () => {
    expect(weekLabelBudget(0)).toBe(MAX_WEEK_LABELS);
  });
});
