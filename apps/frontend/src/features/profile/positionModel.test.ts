import { describe, expect, it } from 'vitest';
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';
import { buildPositionProfileModel, type PositionProfileModel } from './positionModel';

// Veckor ur svaret, aldrig en egen kalender: modellen får exakt de veckor API:t skickar (1–26), måndag första veckan 2026-07-06 = vecka 28.
const weeksOf = (count: number, firstIsoWeek = 28, isoYear = 2026): PositionWeek[] =>
  Array.from({ length: count }, (_, i) => ({
    start: `2026-07-${String(6 + i * 7).padStart(2, '0')}`,
    end: `2026-07-${String(12 + i * 7).padStart(2, '0')}`,
    iso_week: firstIsoWeek + i,
    iso_year: isoYear,
    is_current_week: i === count - 1,
  }));

const runner = (user_id: string, positions: Array<number | null>): PositionRunner => ({
  user_id,
  name: user_id.toUpperCase(),
  profile_picture: null,
  member_since: null,
  positions,
});

/** Svar där "me" har `positions` och resten av gruppen fylls ut till `members` löpare (de är bara statister). */
const history = (positions: Array<number | null>, members = 6, weeks = weeksOf(positions.length)): PositionHistoryResponse => ({
  as_of: '2026-08-26',
  weeks,
  runners: [runner('me', positions), ...Array.from({ length: members - 1 }, (_, i) => runner(`other-${i}`, positions.map(() => null)))],
});

const ready = (response: PositionHistoryResponse): Extract<PositionProfileModel, { mode: 'ready' }> => {
  const model = buildPositionProfileModel(response, 'me');
  if (model.mode !== 'ready') throw new Error(`expected ready, got ${model.mode}`);
  return model;
};

describe('Best, Lowest and Now', () => {
  it('best and lowest ignore the current week and null weeks', () => {
    // Avslutade: null, 3, 2, 2, 5. Den pågående veckan (#1) och null-veckan får aldrig bli Best eller Lowest.
    const { stats } = ready(history([null, 3, 2, 2, 5, 1]));

    expect(stats.best).toEqual({ position: 2, weeks: 2, ofWeeks: 4, text: 'Best #2 · 2 of 4 weeks' });
    expect(stats.lowest).toEqual({ position: 5, text: 'Lowest #5' });
  });

  it('the best placement reads as "Best #1 · 6 of 7 weeks" with the week count taken from finished weeks only', () => {
    const { stats } = ready(history([1, 1, 2, 1, 1, 1, 1, 3]));

    expect(stats.best.text).toBe('Best #1 · 6 of 7 weeks');
    expect(stats.best).toMatchObject({ position: 1, weeks: 6, ofWeeks: 7 });
    expect(stats.lowest.position).toBe(2);
  });

  it('one finished week reads in the singular', () => {
    expect(ready(history([2, 4])).stats.best.text).toBe('Best #2 · 1 of 1 week');
  });

  it('now is the live position', () => {
    const { stats } = ready(history([1, 1, 1, 4]));

    expect(stats.now).toEqual({ position: 4, text: 'Now #4' });
    // Live-veckan på #4 sänker inte Lowest (bara avslutade veckor räknas).
    expect(stats.lowest.position).toBe(1);
  });
});

describe('axis', () => {
  it('axis range is padded by one, clamped to the group size and at least three rows', () => {
    const axisOf = (positions: Array<number | null>, members: number) => ready(history(positions, members)).axis;

    expect(axisOf([1, 2, 1, 2], 6)).toEqual({ first: 1, last: 3, rows: 3 });
    expect(axisOf([4, 5, 4, 5], 6)).toEqual({ first: 3, last: 6, rows: 4 });
    expect(axisOf([1, 2, 1, 2], 2)).toEqual({ first: 1, last: 2, rows: 2 });
    // Mitt i spannet: min-1 till max+1.
    expect(axisOf([3, 4, 5, 4], 12)).toEqual({ first: 2, last: 6, rows: 5 });
    // Alla på samma plats: tre rader, längst ned i gruppen växer den uppåt.
    expect(axisOf([6, 6, 6], 6)).toEqual({ first: 4, last: 6, rows: 3 });
    expect(axisOf([3, 3, 3], 12)).toEqual({ first: 2, last: 4, rows: 3 });
  });

  it('the live position takes part in the axis, so the hollow dot always fits', () => {
    expect(ready(history([1, 1, 1, 5], 8)).axis).toEqual({ first: 1, last: 6, rows: 6 });
  });

  it('every dot sits on a row inside the axis, counted from the top row', () => {
    const model = ready(history([1, 2, 5, 3], 6));
    expect(model.axis).toEqual({ first: 1, last: 6, rows: 6 });
    expect(model.dots.map((dot) => dot.row)).toEqual([0, 1, 4, 2]);
  });

  it('grid rows and week labels exist, with no axis numbers in the model', () => {
    const model = ready(history([1, 2, 1, 2], 6));

    expect(model.gridRows).toBe(model.axis.rows);
    expect(model.columns.map((column) => column.visual)).toEqual(['W28', 'W29', 'W30', 'W31']);
    expect(model.columns.map((column) => column.spoken)).toEqual(['week 28', 'week 29', 'week 30', 'week 31']);
    expect(model.columns.map((column) => column.current)).toEqual([false, false, false, true]);
    expect(JSON.stringify(model.axis)).not.toMatch(/label/i);
  });
});

describe('dots', () => {
  it('a finished week at #1 is filled, every dot has a ring and the week in progress is hollow', () => {
    const { dots } = ready(history([1, 2, 1, 1]));

    expect(dots.map((dot) => dot.filled)).toEqual([true, false, true, false]);
    expect(dots.map((dot) => dot.ring)).toEqual([true, true, true, true]);
    expect(dots.map((dot) => dot.hollow)).toEqual([false, false, false, true]);
  });

  it('the live week at #1 stays hollow, not filled', () => {
    const last = ready(history([2, 2, 1])).dots.at(-1);
    expect(last).toMatchObject({ column: 2, position: 1, filled: false, hollow: true, ring: true });
  });

  it('null weeks get no dot', () => {
    const { dots } = ready(history([null, null, 3, 2, 1]));
    expect(dots.map((dot) => dot.column)).toEqual([2, 3, 4]);
  });
});

describe('line', () => {
  it('starts at the first week with a placement, draws nothing before it and keeps the live leg dashed', () => {
    const model = ready(history([null, null, 4, 3, 3, 2]));

    expect(model.line.solid).toEqual([
      { column: 2, position: 4 },
      { column: 3, position: 3 },
      { column: 4, position: 3 },
    ]);
    expect(model.line.dashed).toEqual({ from: { column: 4, position: 3 }, to: { column: 5, position: 2 } });
  });

  it('a runner who joined mid-period counts only the weeks with a placement in Best and Lowest', () => {
    const { stats } = ready(history([null, null, 4, 3, 3, 2]));

    expect(stats.best).toMatchObject({ position: 3, weeks: 2, ofWeeks: 3 });
    expect(stats.lowest.position).toBe(4);
    expect(stats.now.position).toBe(2);
  });

  it('a runner with a single finished placement has a solid line of one point and a dashed leg to now', () => {
    const model = ready(history([null, 3, 2]));

    expect(model.line.solid).toEqual([{ column: 1, position: 3 }]);
    expect(model.line.dashed).toEqual({ from: { column: 1, position: 3 }, to: { column: 2, position: 2 } });
  });
});

describe('modes', () => {
  it('a new runner has only the live placement and shows the first-week text', () => {
    const model = buildPositionProfileModel(history([null, null, null, 2]), 'me');

    expect(model).toEqual({ mode: 'new-runner', message: 'First week in the group. Position appears after your first week' });
  });

  it('fewer than two members hides the tab', () => {
    expect(buildPositionProfileModel(history([1, 1, 1], 1), 'me')).toEqual({ mode: 'hidden' });
  });

  it('a runner who is not in the response hides the tab', () => {
    expect(buildPositionProfileModel(history([1, 1, 1]), 'someone-else')).toEqual({ mode: 'hidden' });
  });

  it('an empty period hides the tab and never invents weeks', () => {
    expect(buildPositionProfileModel({ as_of: '2026-08-26', weeks: [], runners: [runner('me', []), runner('b', [])] }, 'me')).toEqual({ mode: 'hidden' });
  });

  it('two members but no finished week says so', () => {
    expect(buildPositionProfileModel(history([2]), 'me')).toEqual({
      mode: 'no-finished-week',
      message: 'No finished week yet. Position shows where you stood at the end of each week.',
    });
  });

  it('one member wins over no finished week: the tab is hidden', () => {
    expect(buildPositionProfileModel(history([1], 1), 'me')).toEqual({ mode: 'hidden' });
  });

  it('a runner without a live placement hides the tab', () => {
    expect(buildPositionProfileModel(history([1, 2, null]), 'me')).toEqual({ mode: 'hidden' });
  });
});

describe('member threshold', () => {
  it('exactly two members with one finished week is ready, one member is hidden', () => {
    expect(buildPositionProfileModel(history([2, 1], 2), 'me').mode).toBe('ready');
    expect(buildPositionProfileModel(history([1, 1], 1), 'me').mode).toBe('hidden');
  });
});

describe('period length', () => {
  it('works from two weeks up to the cap of 26 and never assumes eight', () => {
    const two = ready(history([2, 1]));
    expect(two.columns).toHaveLength(2);
    expect(two.stats.best).toMatchObject({ position: 2, weeks: 1, ofWeeks: 1 });

    const many = Array.from({ length: 26 }, (_, i) => (i % 3) + 1);
    const model = ready(history(many));
    expect(model.columns).toHaveLength(26);
    expect(model.dots).toHaveLength(26);
    expect(model.table).toHaveLength(26);
    expect(model.stats.best.ofWeeks).toBe(25);
  });

  it('labels come from the shared week labels, with years when the period crosses the year boundary', () => {
    const weeks: PositionWeek[] = [
      { start: '2026-12-21', end: '2026-12-27', iso_week: 52, iso_year: 2026, is_current_week: false },
      { start: '2026-12-28', end: '2027-01-03', iso_week: 53, iso_year: 2026, is_current_week: false },
      { start: '2027-01-04', end: '2027-01-10', iso_week: 1, iso_year: 2027, is_current_week: true },
    ];
    const model = ready(history([2, 1, 3], 6, weeks));

    expect(model.columns.map((column) => column.visual)).toEqual(['W52', 'W53', 'W1']);
    expect(model.columns[1].spoken).toBe('week 53, 2026');
    expect(model.summary).toBe('Position in the group, week 52, 2026 to week 1, 2027: week 52, 2026 #2, week 53, 2026 #1, this week so far #3');
  });
});

describe('text alternative', () => {
  it('reads the whole line as one sentence ending in this week so far', () => {
    const { summary } = ready(history([1, 1, 2, 2], 6, weeksOf(4, 27)));

    expect(summary).toBe('Position in the group, weeks 27 to 30: week 27 #1, week 28 #1, week 29 #2, this week so far #2');
  });

  it('says where the sentence starts when weeks before the runner had a placement are left out', () => {
    const { summary } = ready(history([null, null, 3, 2], 6, weeksOf(4, 27)));

    expect(summary).toBe('Position in the group, weeks 27 to 30, from week 29: week 29 #3, this week so far #2');
  });

  it('the sentence needs no "from" when the runner has a placement every week', () => {
    expect(ready(history([3, 2], 6, weeksOf(2, 27))).summary).toBe('Position in the group, weeks 27 to 28: week 27 #3, this week so far #2');
  });

  it('the sentence names the years across the year boundary and still says where it starts', () => {
    const weeks: PositionWeek[] = [
      { start: '2026-12-21', end: '2026-12-27', iso_week: 52, iso_year: 2026, is_current_week: false },
      { start: '2026-12-28', end: '2027-01-03', iso_week: 53, iso_year: 2026, is_current_week: false },
      { start: '2027-01-04', end: '2027-01-10', iso_week: 1, iso_year: 2027, is_current_week: true },
    ];
    expect(ready(history([null, 1, 3], 6, weeks)).summary).toBe(
      'Position in the group, week 52, 2026 to week 1, 2027, from week 53, 2026: week 53, 2026 #1, this week so far #3',
    );
  });

  it('table rows carry week, position and the note for the week in progress', () => {
    const { table } = ready(history([null, 3, 1, 2], 6, weeksOf(4, 27)));

    expect(table).toEqual([
      { week: 'W27', spoken: 'week 27', position: null, text: '—', spokenText: 'not in the group yet', current: false, note: null },
      { week: 'W28', spoken: 'week 28', position: 3, text: '#3', spokenText: '#3', current: false, note: null },
      { week: 'W29', spoken: 'week 29', position: 1, text: '#1', spokenText: '#1', current: false, note: null },
      { week: 'W30', spoken: 'week 30', position: 2, text: '#2', spokenText: '#2', current: true, note: 'this week so far' },
    ]);
  });

  it('gives the table a caption and, only when it has dashes, a footnote that explains them', () => {
    const joined = ready(history([null, 3, 1, 2], 6, weeksOf(4, 27)));
    expect(joined.tableCaption).toBe('Position per week, W27 to W30. W30 is this week so far.');
    expect(joined.tableFootnote).toBe('— = not in the group yet');

    const always = ready(history([3, 1, 2], 6, weeksOf(3, 27)));
    expect(always.tableCaption).toBe('Position per week, W27 to W29. W29 is this week so far.');
    expect(always.tableFootnote).toBeNull();
  });

  it('names the week in progress in the legend', () => {
    expect(ready(history([1, 2, 3], 6, weeksOf(3, 32))).legend).toBe('W34 · this week so far');
  });
});
