import { describe, expect, it } from 'vitest';
import { positionWeekLabels } from './positionWeekLabels';

const weeksOf = (year: number, first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, i) => ({ iso_week: first + i, iso_year: year }));

describe('positionWeekLabels', () => {
  it('reads weeks as W27 visually and as "week 27" for screen readers, with the range as "week 27–34"', () => {
    const { labels, range } = positionWeekLabels(weeksOf(2026, 27, 34));

    expect(labels).toHaveLength(8);
    expect(labels[0]).toEqual({ visual: 'W27', spoken: 'week 27' });
    expect(labels[7]).toEqual({ visual: 'W34', spoken: 'week 34' });
    expect(range).toBe('week 27–34');
  });

  it('week labels across the year boundary', () => {
    const weeks = [...weeksOf(2026, 50, 53), ...weeksOf(2027, 1, 4)];
    const { labels, range } = positionWeekLabels(weeks);

    expect(labels.map((label) => label.visual)).toEqual(['W50', 'W51', 'W52', 'W53', 'W1', 'W2', 'W3', 'W4']);
    expect(labels[3].spoken).toBe('week 53, 2026');
    expect(labels[4].spoken).toBe('week 1, 2027');
    expect(range).toBe('week 50, 2026 – week 4, 2027');
  });

  it('week labels for a period shorter than eight weeks', () => {
    const three = positionWeekLabels(weeksOf(2026, 32, 34));
    expect(three.labels.map((label) => label.visual)).toEqual(['W32', 'W33', 'W34']);
    expect(three.range).toBe('week 32–34');

    const one = positionWeekLabels(weeksOf(2026, 34, 34));
    expect(one.labels).toEqual([{ visual: 'W34', spoken: 'week 34' }]);
    expect(one.range).toBe('week 34');
  });

  it('a period longer than eight weeks gets every label and the real end of the range', () => {
    const within = positionWeekLabels(weeksOf(2026, 1, 26));
    expect(within.labels).toHaveLength(26);
    expect(within.labels[25]).toEqual({ visual: 'W26', spoken: 'week 26' });
    expect(within.range).toBe('week 1–26');

    const across = positionWeekLabels([...weeksOf(2026, 35, 53), ...weeksOf(2027, 1, 7)]);
    expect(across.labels).toHaveLength(26);
    expect(across.labels[8].spoken).toBe('week 43, 2026');
    expect(across.labels[25]).toEqual({ visual: 'W7', spoken: 'week 7, 2027' });
    expect(across.range).toBe('week 35, 2026 – week 7, 2027');
  });

  it('an empty period gives no labels and no range, and never invents weeks', () => {
    expect(positionWeekLabels([])).toEqual({ labels: [], range: '' });
  });

  it('a short period that still crosses the year boundary keeps the years on every label', () => {
    const { labels, range } = positionWeekLabels([{ iso_week: 53, iso_year: 2026 }, { iso_week: 1, iso_year: 2027 }]);

    expect(labels.map((label) => label.spoken)).toEqual(['week 53, 2026', 'week 1, 2027']);
    expect(range).toBe('week 53, 2026 – week 1, 2027');
  });
});
