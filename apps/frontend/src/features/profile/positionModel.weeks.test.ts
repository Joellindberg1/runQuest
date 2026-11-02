import { describe, expect, it } from 'vitest';
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';
import { buildPositionProfileModel, type PositionProfileModel } from './positionModel';

// Position-fliken på profilen har två vyer: de senaste åtta veckorna och "All time" (upp till 104 veckor). Modellen följer svaret: den räknar Best, Lowest och Now på de veckor
// den fått, och gles etikettering och markörer styrs av antalet veckor.

const weeksOf = (count: number, firstIsoWeek = 1): PositionWeek[] =>
  Array.from({ length: count }, (_, i) => ({
    start: '2026-01-05',
    end: '2026-01-11',
    iso_week: firstIsoWeek + i,
    iso_year: 2026,
    is_current_week: i === count - 1,
  }));

const runner = (user_id: string, positions: Array<number | null>): PositionRunner => ({ user_id, name: user_id.toUpperCase(), profile_picture: null, member_since: null, positions });

const history = (positions: Array<number | null>): PositionHistoryResponse => ({
  as_of: '2026-08-26',
  weeks: weeksOf(positions.length),
  runners: [runner('me', positions), runner('other', positions.map(() => 1))],
});

const ready = (response: PositionHistoryResponse): Extract<PositionProfileModel, { mode: 'ready' }> => {
  const model = buildPositionProfileModel(response, 'me');
  if (model.mode !== 'ready') throw new Error(`expected ready, got ${model.mode}`);
  return model;
};

// 44 veckor: bäst (#1) tidigt, sämst (#6) i mitten, och de senaste åtta veckorna ligger på #3-#4.
const FORTY_FOUR = Array.from({ length: 44 }, (_, i) => (i < 5 ? 1 : i === 20 ? 6 : i >= 36 ? 3 + (i % 2) : 2));

describe('Best, Lowest and Now follow the chosen view', () => {
  it('All time counts every finished week, the last eight weeks only their own', () => {
    const allTime = ready(history(FORTY_FOUR));
    const lastEight = ready(history(FORTY_FOUR.slice(-8)));

    expect(allTime.stats.best).toMatchObject({ position: 1, weeks: 5, ofWeeks: 43 });
    expect(allTime.stats.lowest.position).toBe(6);
    expect(lastEight.stats.best).toMatchObject({ position: 3, ofWeeks: 7 });
    expect(lastEight.stats.lowest.position).toBe(4);
    expect(allTime.stats.now.position).toBe(lastEight.stats.now.position);
  });

  it('a group younger than the window counts the weeks it has', () => {
    const model = ready(history([2, 1, 3]));
    expect(model.columns).toHaveLength(3);
    expect(model.stats.best).toMatchObject({ position: 1, weeks: 1, ofWeeks: 2 });
  });
});

describe('many weeks (All time)', () => {
  const labelledOf = (weekCount: number) => ready(history(Array.from({ length: weekCount }, (_, i) => (i % 3) + 1))).columns.flatMap((column, index) => (column.labelled ? [index] : []));

  it('labels every week for 8 weeks and thins the labels for 26, 44 and 104 weeks, with the first week and the week in progress always labelled', () => {
    expect(labelledOf(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(labelledOf(26)).toEqual([0, 5, 9, 13, 17, 21, 25]);
    expect(labelledOf(44)).toEqual([0, 8, 15, 22, 29, 36, 43]);
    expect(labelledOf(104)).toEqual([0, 28, 43, 58, 73, 88, 103]);
  });

  it('a group younger than the window labels exactly the weeks it has', () => {
    expect(labelledOf(3)).toEqual([0, 1, 2]);
  });

  it('keeps every dot in the model and marks the ones that are drawn: the labelled weeks and the week in progress', () => {
    const model = ready(history(Array.from({ length: 44 }, (_, i) => (i % 3) + 1)));

    expect(model.dots).toHaveLength(44);
    expect(model.dots.filter((dot) => dot.marked).map((dot) => dot.column)).toEqual([0, 8, 15, 22, 29, 36, 43]);
    expect(model.line.solid).toHaveLength(43);
  });

  it('marks every dot up to 8 weeks', () => {
    const model = ready(history([2, 1, 3, 1, 2, 2, 1, 3]));
    expect(model.dots.every((dot) => dot.marked)).toBe(true);
  });

  it('keeps every week in the table and the sentence', () => {
    const model = ready(history(Array.from({ length: 104 }, (_, i) => (i % 3) + 1)));

    expect(model.table).toHaveLength(104);
    expect(model.columns).toHaveLength(104);
    expect(model.range).toBe('week 1-104');
  });
});
