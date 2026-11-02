import { describe, expect, it } from 'vitest';
import { buildPositionChart } from './positionChartModel';
import { responseOf, runnerOf, weeksOf } from './positionBoard.fixture';

// Position-vyn "All time" ger upp till 104 veckor; en grupp yngre än fönstret ger färre (servern beskär förledande veckor). Modellen följer svaret.

const OPTIONS = { meId: 'u-me', mobile: true } as const;
const flat = (placement: number, weekCount: number) => Array.from({ length: weekCount }, () => placement);

/** Tre löpare som står stilla på plats 1-3 under `weekCount` veckor. */
const pack = (weekCount: number) =>
  responseOf(weeksOf(weekCount), [
    runnerOf('u-me', 'Me Myself', flat(1, weekCount)),
    runnerOf('u-2', 'Bo Berg', flat(2, weekCount)),
    runnerOf('u-3', 'Cia Dahl', flat(3, weekCount)),
  ]);

const labelledOf = (weekCount: number) => buildPositionChart(pack(weekCount), OPTIONS).weeks.flatMap((week, index) => (week.labelled ? [index] : []));

describe('many weeks (All time)', () => {
  it('labels every week for 8 weeks and thins the labels for 26, 44 and 104 weeks, with the first week and the week in progress always labelled', () => {
    expect(labelledOf(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(labelledOf(26)).toEqual([0, 5, 9, 13, 17, 21, 25]);
    expect(labelledOf(44)).toEqual([0, 8, 15, 22, 29, 36, 43]);
    expect(labelledOf(104)).toEqual([0, 28, 43, 58, 73, 88, 103]);
  });

  it('labels fewer weeks, and marks fewer, when the chart is narrow (a smaller label budget)', () => {
    const model = buildPositionChart(pack(44), { ...OPTIONS, maxWeekLabels: 4 });

    expect(model.weeks.flatMap((week, index) => (week.labelled ? [index] : []))).toEqual([0, 28, 43]);
    expect(model.lines[0].points.filter((point) => point.marked).map((point) => point.weekIndex)).toEqual([0, 28, 42, 43]);
  });

  it('eight weeks are all labelled with room for eight, and thinned when the chart is narrow', () => {
    const labelled = (maxWeekLabels: number) => buildPositionChart(pack(8), { ...OPTIONS, maxWeekLabels }).weeks.flatMap((week, index) => (week.labelled ? [index] : []));

    expect(labelled(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(labelled(6)).toEqual([0, 3, 5, 7]);
    expect(labelled(2)).toEqual([0, 7]);
  });

  it('a group younger than the window labels exactly the weeks it has', () => {
    expect(labelledOf(3)).toEqual([0, 1, 2]);
    expect(labelledOf(2)).toEqual([0, 1]);
  });

  it('draws a marker for a finished week only where the week is labelled, and always for the endpoint and the week in progress', () => {
    const [line] = buildPositionChart(pack(44), OPTIONS).lines;
    const marked = line.points.filter((point) => point.marked).map((point) => point.weekIndex);

    expect(marked).toEqual([0, 8, 15, 22, 29, 36, 42, 43]);
    expect(line.points).toHaveLength(44);
    expect(line.points.find((point) => point.kind === 'endpoint')?.marked).toBe(true);
    expect(line.points.find((point) => point.kind === 'hollow')?.marked).toBe(true);
  });

  it('every week has a marker up to 8 weeks', () => {
    const [line] = buildPositionChart(pack(8), OPTIONS).lines;
    expect(line.points.every((point) => point.marked)).toBe(true);
  });

  it('the table, the order and the spoken text keep every week however many there are', () => {
    const model = buildPositionChart(pack(104), OPTIONS);

    expect(model.weeks).toHaveLength(104);
    expect(model.table!.columns).toHaveLength(104);
    expect(model.table!.rows.every((row) => row.cells.length === 104)).toBe(true);
    expect(model.range).toBe('week 27-130');
    expect(model.lines[0].points).toHaveLength(104);
  });

  it('a runner who came in late in a long period gets a line from the first placement only, with markers where the labelled weeks are', () => {
    const late = Array.from({ length: 44 }, (_, week) => (week < 20 ? null : 1));
    const model = buildPositionChart(responseOf(weeksOf(44), [runnerOf('u-me', 'Me Myself', late), runnerOf('u-2', 'Bo Berg', flat(2, 44))]), OPTIONS);
    const me = model.lines[0];

    expect(me.points[0].weekIndex).toBe(20);
    expect(me.points.filter((point) => point.marked).map((point) => point.weekIndex)).toEqual([22, 29, 36, 42, 43]);
    expect(model.order[0].firstPlacedWeek).toBe('W47');
  });
});
