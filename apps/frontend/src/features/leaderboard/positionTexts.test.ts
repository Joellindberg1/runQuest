import { describe, expect, it } from 'vitest';
import {
  CURRENT_WEEK_PHRASE,
  NOT_IN_GROUP_DASH,
  NOT_IN_GROUP_FOOTNOTE,
  NOT_IN_GROUP_SPOKEN,
  currentWeekSentence,
  placementText,
  spokenPlacementText,
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
});
