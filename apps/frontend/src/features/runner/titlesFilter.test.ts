import { describe, expect, it } from 'vitest';
import type { HeldTitleRow, RunnerUpTitleRow, TitleRows } from './runnerModel';
import { filterTitleRows, titleFilterOptions } from './titlesFilter';

const held = (id: string, category: HeldTitleRow['category']): HeldTitleRow => ({ id, name: id, value: '1', category });
const runnerUp = (id: string, category: RunnerUpTitleRow['category']): RunnerUpTitleRow => ({ id, name: id, position: 2, holder: null, gap: null, value: '1', category });

// Data order on purpose differs from TITLE_CATEGORIES order (time, distance, pace, volume, elevation, consistency, ...).
const ROWS: TitleRows = {
  held: [held('streak', 'consistency'), held('long', 'distance'), held('night', 'time'), held('total', 'distance')],
  runnersUp: [runnerUp('fast', 'pace'), runnerUp('early', 'time')],
};

describe('titleFilterOptions', () => {
  it('is "All" plus the categories among the held and runner-up titles, in the fixed order of TITLE_CATEGORIES', () => {
    expect(titleFilterOptions(ROWS)).toEqual([
      { value: 'all', label: 'All' },
      { value: 'time', label: 'Time of day' },
      { value: 'distance', label: 'Distance' },
      { value: 'pace', label: 'Pace' },
      { value: 'consistency', label: 'Consistency' },
    ]);
  });

  it('lists a category once however many titles it has', () => {
    const options = titleFilterOptions({ held: [held('a', 'distance'), held('b', 'distance')], runnersUp: [] });
    expect(options.map((option) => option.value)).toEqual(['all', 'distance']);
  });

  it('is only "All" when there are no titles', () => {
    expect(titleFilterOptions({ held: [], runnersUp: [] })).toEqual([{ value: 'all', label: 'All' }]);
  });
});

describe('filterTitleRows', () => {
  it('keeps everything for "all", in the given order', () => {
    expect(filterTitleRows(ROWS, 'all')).toEqual(ROWS);
  });

  it('keeps only the held and the runner-up titles of the category, in the given order', () => {
    const distance = filterTitleRows(ROWS, 'distance');
    expect(distance.held.map((row) => row.id)).toEqual(['long', 'total']);
    expect(distance.runnersUp).toEqual([]);

    const time = filterTitleRows(ROWS, 'time');
    expect(time.held.map((row) => row.id)).toEqual(['night']);
    expect(time.runnersUp.map((row) => row.id)).toEqual(['early']);
  });

  it('keeps nothing for a category the runner has no title in', () => {
    expect(filterTitleRows(ROWS, 'weather')).toEqual({ held: [], runnersUp: [] });
  });
});
