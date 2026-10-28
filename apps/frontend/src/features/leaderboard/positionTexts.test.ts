import { describe, expect, it } from 'vitest';
import {
  CURRENT_WEEK_PHRASE,
  NOT_IN_GROUP_DASH,
  NOT_IN_GROUP_FOOTNOTE,
  NOT_IN_GROUP_SPOKEN,
  currentWeekSentence,
  placementText,
  spokenPlacementText,
  spokenRange,
} from './positionTexts';

describe('positionTexts', () => {
  it('owns the phrase for the week in progress, the dash, its spoken text and the footnote', () => {
    expect(CURRENT_WEEK_PHRASE).toBe('this week so far');
    expect(NOT_IN_GROUP_DASH).toBe('—');
    expect(NOT_IN_GROUP_SPOKEN).toBe('not in the group yet');
    expect(NOT_IN_GROUP_FOOTNOTE).toBe('— = not in the group yet');
  });

  it('writes a placement as #N and a week without one as the dash', () => {
    expect(placementText(3)).toBe('#3');
    expect(placementText(null)).toBe('—');
  });

  it('speaks a week without a placement as "not in the group yet"', () => {
    expect(spokenPlacementText(3)).toBe('#3');
    expect(spokenPlacementText(null)).toBe('not in the group yet');
  });

  it('names the week in progress with a capital letter, also with a year across the year boundary', () => {
    expect(currentWeekSentence('week 34')).toBe('Week 34 is this week so far.');
    expect(currentWeekSentence('week 1, 2027')).toBe('Week 1, 2027 is this week so far.');
  });

  describe('spokenRange', () => {
    const weeksOf = (year: number, first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => ({ iso_week: first + i, iso_year: year }));

    it('reads a period in the middle of a year as "weeks 27 to 34"', () => {
      expect(spokenRange(weeksOf(2026, 27, 34))).toBe('weeks 27 to 34');
      expect(spokenRange(weeksOf(2026, 33, 34))).toBe('weeks 33 to 34');
    });

    it('names the years across the year boundary: "week 52, 2026 to week 1, 2027", also over week 53', () => {
      expect(spokenRange([...weeksOf(2026, 50, 53), ...weeksOf(2027, 1, 4)])).toBe('week 50, 2026 to week 4, 2027');
      expect(spokenRange([{ iso_week: 53, iso_year: 2026 }, { iso_week: 1, iso_year: 2027 }])).toBe('week 53, 2026 to week 1, 2027');
    });

    it('reads a single week as "week 34" and no weeks as nothing', () => {
      expect(spokenRange(weeksOf(2026, 34, 34))).toBe('week 34');
      expect(spokenRange([{ iso_week: 1, iso_year: 2027 }])).toBe('week 1');
      expect(spokenRange([])).toBe('');
    });
  });
});
