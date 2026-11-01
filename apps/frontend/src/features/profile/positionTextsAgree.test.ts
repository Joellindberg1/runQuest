import { describe, expect, it } from 'vitest';
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';
import { buildPositionChart } from '@/features/leaderboard/positionChartModel';
import { CURRENT_WEEK_PHRASE, NOT_IN_GROUP_DASH, NOT_IN_GROUP_FOOTNOTE, NOT_IN_GROUP_SPOKEN, currentWeekSentence } from '@/features/leaderboard/positionTexts';
import { buildPositionProfileModel, type PositionGraphModel } from './positionModel';

// En sanning för positionstexterna: profilens och leaderboardens vymodell får samma svar och ska skriva perioden, den pågående veckan och
// tankstrecket på samma sätt. Texterna ägs av positionTexts/positionWeekLabels; testet fäller om en av modellerna börjar skriva egna.

const week = (iso_week: number, iso_year: number, is_current_week: boolean): PositionWeek => ({
  start: '2026-01-01',
  end: '2026-01-07',
  iso_week,
  iso_year,
  is_current_week,
});

const runner = (user_id: string, name: string, positions: Array<number | null>): PositionRunner => ({
  user_id,
  name,
  profile_picture: null,
  member_since: null,
  positions,
});

const response = (weeks: PositionWeek[], mine: Array<number | null>): PositionHistoryResponse => ({
  as_of: '2026-08-26',
  weeks,
  runners: [
    runner('me', 'Me Myself', mine),
    runner('karl', 'Karl Persson', weeks.map((_, i) => (i % 2 === 0 ? 2 : 1))),
    runner('ada', 'Ada Lovelace', weeks.map(() => 3)),
  ],
});

const inYear = (iso_week: number, last: number) => week(iso_week, 2026, iso_week === last);
const midYear = Array.from({ length: 8 }, (_, i) => inYear(27 + i, 34));
const yearEnd = [week(50, 2026, false), week(51, 2026, false), week(52, 2026, false), week(53, 2026, false), week(1, 2027, false), week(2, 2027, false), week(3, 2027, false), week(4, 2027, true)];

const CASES: Array<{ name: string; data: PositionHistoryResponse; spoken: string }> = [
  { name: 'eight weeks in the middle of a year with a runner who joined late', data: response(midYear, [null, null, 3, 2, 2, 1, 1, 2]), spoken: 'weeks 27 to 34' },
  { name: 'eight weeks across the year boundary with week 53', data: response(yearEnd, [null, 1, 2, 1, 3, 1, 1, 2]), spoken: 'week 50, 2026 to week 4, 2027' },
  { name: 'eight weeks across the year boundary where the runner has a placement every week', data: response(yearEnd, [2, 1, 2, 1, 3, 1, 1, 2]), spoken: 'week 50, 2026 to week 4, 2027' },
  { name: 'two weeks', data: response(midYear.slice(-2), [3, 2]), spoken: 'weeks 33 to 34' },
];

const both = (data: PositionHistoryResponse) => {
  const profile = buildPositionProfileModel(data, 'me') as PositionGraphModel;
  const board = buildPositionChart(data, { meId: 'me', mobile: true });
  expect(profile.mode).toBe('ready');
  expect(board.mode).toBe('chart');
  return { profile, board, table: board.table! };
};

describe.each(CASES)('the profile and the leaderboard model, $name', ({ data, spoken }) => {
  it('write the period the same way', () => {
    const { profile, board, table } = both(data);

    expect(profile.range).toBe(board.range);
    expect(profile.spokenRange).toBe(spoken);
    expect(board.spokenRange).toBe(spoken);
    expect(profile.summary.startsWith(`Position in the group, ${spoken}`)).toBe(true);
    expect(profile.tableCaption.startsWith(`Position per week, ${spoken}.`)).toBe(true);
    expect(table.caption.startsWith(`Position per week, ${spoken}.`)).toBe(true);
    expect(board.ariaLabel.startsWith(`Position over time, ${spoken}.`)).toBe(true);
    // Skärmläsaren får aldrig den visuella formen med bindestreck ("week 27-34").
    expect(`${profile.summary} ${profile.tableCaption} ${board.ariaLabel} ${table.caption}`).not.toContain(board.range);
  });

  it('call the week in progress the same thing, never "in progress"', () => {
    const { profile, board, table } = both(data);
    const last = board.weeks[board.weeks.length - 1];
    const sentence = currentWeekSentence(last.spoken);

    expect(profile.tableCaption).toContain(sentence);
    expect(board.ariaLabel).toContain(sentence);
    expect(table.caption).toContain(sentence);
    expect(table.caption).not.toContain('The last column');
    expect(profile.table.at(-1)?.note).toBe(CURRENT_WEEK_PHRASE);
    expect(table.columns.at(-1)?.header).toBe(CURRENT_WEEK_PHRASE);
    expect(profile.legend.endsWith(CURRENT_WEEK_PHRASE)).toBe(true);
    expect(profile.summary).toContain(`${CURRENT_WEEK_PHRASE} #`);
    expect(`${profile.summary} ${profile.tableCaption} ${board.ariaLabel} ${table.caption}`).not.toMatch(/in progress/i);
  });

  it('write the dash, speak it and explain it the same way', () => {
    const { profile, board, table } = both(data);
    const mine = table.rows.find((row) => row.id === 'me')!;

    expect(profile.table.map((row) => row.text)).toEqual(mine.cells.map((cell) => cell.text));
    expect(profile.table.map((row) => row.spokenText)).toEqual(mine.cells.map((cell) => cell.spokenText));
    expect(profile.tableFootnote).toBe(table.footnote);
    expect(table.hasEmptyCells).toBe(table.footnote !== null);
    // Alla rader i leaderboarden följer samma regel, inte bara min.
    for (const cell of table.rows.flatMap((row) => row.cells)) {
      expect(cell.text).toBe(cell.position === null ? NOT_IN_GROUP_DASH : `#${cell.position}`);
      expect(cell.spokenText).toBe(cell.position === null ? NOT_IN_GROUP_SPOKEN : `#${cell.position}`);
    }
    expect(board.mode).toBe('chart');
  });
});

describe('the dash texts', () => {
  it('are the shared ones: a runner who joined late has dashes and the footnote, a runner placed every week has neither', () => {
    const late = both(CASES[0].data);
    expect(late.profile.table.slice(0, 2).map((row) => row.text)).toEqual([NOT_IN_GROUP_DASH, NOT_IN_GROUP_DASH]);
    expect(late.profile.table.slice(0, 2).map((row) => row.spokenText)).toEqual([NOT_IN_GROUP_SPOKEN, NOT_IN_GROUP_SPOKEN]);
    expect(late.profile.tableFootnote).toBe(NOT_IN_GROUP_FOOTNOTE);
    expect(late.table.footnote).toBe(NOT_IN_GROUP_FOOTNOTE);

    const always = both(CASES[2].data);
    expect(always.profile.tableFootnote).toBeNull();
    expect(always.table.footnote).toBeNull();
  });
});
