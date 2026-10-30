import { describe, expect, it } from 'vitest';
import {
  buildPositionHistory,
  compareXpStandings,
  type PositionHistoryResponse,
  type PositionRunner,
  type PositionWeek,
} from '@runquest/shared';
import { buildPositionChart, chartHeight, rowSpacing, selectRunner } from './positionChartModel';
import { NO_FINISHED_WEEK_MESSAGE } from './positionTexts';

// Veckorna fyller på från 2026-10-26 (pågående) och bakåt; antalet styrs av testet, aldrig av en konstant i modellen.
function weeksOf(count: number): PositionWeek[] {
  return Array.from({ length: count }, (_, k) => ({
    start: `w${k}`,
    end: `w${k}e`,
    iso_week: 30 + k,
    iso_year: 2026,
    is_current_week: k === count - 1,
  }));
}

const runner = (id: string, name: string, positions: Array<number | null>, picture: string | null = null): PositionRunner => ({
  user_id: id,
  name,
  profile_picture: picture,
  member_since: '2026-01-01',
  positions,
});

const response = (weekCount: number, runners: PositionRunner[]): PositionHistoryResponse => ({
  as_of: '2026-10-27',
  weeks: weeksOf(weekCount),
  runners,
});

// Tre löpare över fyra veckor (tre avslutade och en pågående).
const trio = () =>
  response(4, [
    runner('u-me', 'Me Myself', [2, 1, 1, 1], 'https://img.test/me.png'),
    runner('u-karl', 'Karl Persson', [1, 2, 3, 2]),
    runner('u-ada', 'Ada', [3, 3, 2, 3]),
  ]);

// n löpare med unika placeringar 1..n i varje vecka.
const pack = (count: number, weekCount = 8) =>
  response(
    weekCount,
    Array.from({ length: count }, (_, i) => runner(`u-${i + 1}`, `Runner ${i + 1} Surname`, Array.from({ length: weekCount }, () => i + 1))),
  );

const OPTIONS = { meId: 'u-me', mobile: true } as const;

describe('lines and endpoints', () => {
  it('one line per runner in API order, and only the signed-in runner is marked isMe', () => {
    const model = buildPositionChart(trio(), OPTIONS);

    expect(model.mode).toBe('chart');
    expect(model.lines.map((line) => line.id)).toEqual(['u-me', 'u-karl', 'u-ada']);
    expect(model.lines.map((line) => line.isMe)).toEqual([true, false, false]);
    expect(model.lines.map((line) => line.position)).toEqual([1, 2, 3]);
  });

  it('nobody is marked isMe when the signed-in user is not in the pack', () => {
    const model = buildPositionChart(trio(), { meId: null, mobile: false });
    expect(model.lines.every((line) => !line.isMe)).toBe(true);
  });

  it('the model carries no colour per runner', () => {
    const model = buildPositionChart(trio(), OPTIONS);
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, inner]) => {
          keys.add(key);
          walk(inner);
        });
      }
    };
    walk(model);

    expect([...keys].filter((key) => /colou?r|stroke|fill|palette|hue/i.test(key))).toEqual([]);
    expect(JSON.stringify(model)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('the endpoint at the last finished week carries the picture, or the initials when the picture is missing', () => {
    const model = buildPositionChart(trio(), OPTIONS);
    const [me, karl, ada] = model.lines;

    expect(me.endpoint).toMatchObject({ kind: 'endpoint', weekIndex: 2, position: 1, pictureUrl: 'https://img.test/me.png', initials: 'MM' });
    expect(me.endpoint).toBe(me.points[2]);
    expect(karl.endpoint).toMatchObject({ weekIndex: 2, position: 3, pictureUrl: null, initials: 'KP' });
    expect(ada.endpoint).toMatchObject({ pictureUrl: null, initials: 'A' });
  });

  it('other weeks are plain dots and the week in progress is hollow', () => {
    const [me] = buildPositionChart(trio(), OPTIONS).lines;

    expect(me.points.map((point) => point.kind)).toEqual(['dot', 'dot', 'endpoint', 'hollow']);
    expect(me.points.map((point) => point.weekIndex)).toEqual([0, 1, 2, 3]);
    expect(me.points.filter((point) => point.kind === 'hollow')).toHaveLength(1);
    expect(me.points[3].weekIndex).toBe(3);
  });

  it('points carry the share of the width (0 to 1) and the pixel row of their placement', () => {
    const model = buildPositionChart(trio(), OPTIONS);
    const { rowHeight, padding } = model.geometry;
    const karl = model.lines[1];

    expect(karl.points.map((point) => point.x)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(karl.points.map((point) => point.y)).toEqual([1, 2, 3, 2].map((p) => padding + (p - 1) * rowHeight));
  });

  it('a runner who came in mid-period gets a line from the first placement only', () => {
    const data = response(5, [
      runner('u-1', 'Early Bird', [1, 1, 1, 1, 1]),
      runner('u-2', 'Late Comer', [null, null, 2, 2, 2]),
      runner('u-3', 'Fresh Face', [null, null, null, null, 2]),
    ]);
    const [, late, fresh] = buildPositionChart(data, OPTIONS).lines;

    expect(late.points.map((point) => point.weekIndex)).toEqual([2, 3, 4]);
    expect(late.points.map((point) => point.kind)).toEqual(['dot', 'endpoint', 'hollow']);
    // Kom in den här veckan: bara den pågående punkten finns, och ingen slutpunkt eftersom ingen vecka är avslutad för hen.
    expect(fresh.points.map((point) => point.kind)).toEqual(['hollow']);
    expect(fresh.endpoint).toBeNull();
  });

  it('the live placement is the last position of every line', () => {
    const model = buildPositionChart(trio(), OPTIONS);
    expect(model.lines.map((line) => line.points[line.points.length - 1].position)).toEqual(model.lines.map((line) => line.position));
  });
});

describe('selection', () => {
  it('selecting a runner dims the others and selecting again restores', () => {
    const base = buildPositionChart(trio(), OPTIONS);
    expect(base.selectedId).toBeNull();
    expect(base.lines.some((line) => line.dimmed || line.selected)).toBe(false);

    const picked = selectRunner(base, 'u-karl');
    expect(picked.selectedId).toBe('u-karl');
    expect(picked.lines.map((line) => [line.id, line.selected, line.dimmed])).toEqual([
      ['u-me', false, true],
      ['u-karl', true, false],
      ['u-ada', false, true],
    ]);
    expect(picked.order.map((entry) => [entry.selected, entry.dimmed])).toEqual([[false, true], [true, false], [false, true]]);

    const restored = selectRunner(picked, 'u-karl');
    expect(restored.selectedId).toBeNull();
    expect(restored.lines.some((line) => line.dimmed || line.selected)).toBe(false);
    expect(restored).toEqual(base);
  });

  it('selecting another runner moves the selection and ignores an unknown id', () => {
    const picked = selectRunner(buildPositionChart(trio(), OPTIONS), 'u-karl');

    expect(selectRunner(picked, 'u-ada').selectedId).toBe('u-ada');
    expect(selectRunner(picked, 'u-nobody')).toEqual(picked);
  });

  it('a selection given up front behaves like selecting it afterwards, and the selected line is painted last', () => {
    const upFront = buildPositionChart(trio(), { ...OPTIONS, selectedId: 'u-ada' });
    expect(upFront).toEqual(selectRunner(buildPositionChart(trio(), OPTIONS), 'u-ada'));
    // Paint order: the rest in API order, then me, then the selected runner on top. Lines themselves stay in API order.
    expect(upFront.paintOrder).toEqual(['u-karl', 'u-me', 'u-ada']);
    expect(upFront.lines.map((line) => line.id)).toEqual(['u-me', 'u-karl', 'u-ada']);
  });

  it('a selection that is not in the pack is dropped', () => {
    const model = buildPositionChart(trio(), { ...OPTIONS, selectedId: 'u-ghost' });
    expect(model.selectedId).toBeNull();
    expect(model.lines.some((line) => line.dimmed)).toBe(false);
  });
});

describe('height', () => {
  it('chart height for 1 runner has no gap to measure and keeps only the padding', () => {
    expect(chartHeight(1, true)).toBe(2 * buildPositionChart(pack(1), OPTIONS).geometry.padding);
    expect(chartHeight(1, false)).toBe(chartHeight(1, true));
    expect(rowSpacing(1, true)).toBeGreaterThanOrEqual(24);
  });

  it('chart height for 6 runners gives roomy rows on mobile and desktop', () => {
    expect(rowSpacing(6, true)).toBe(34);
    expect(rowSpacing(6, false)).toBe(44);
    const { padding } = buildPositionChart(pack(6), OPTIONS).geometry;
    expect(chartHeight(6, true)).toBe(2 * padding + 5 * 34);
    expect(chartHeight(6, false)).toBe(2 * padding + 5 * 44);
  });

  it('chart height for 12 runners is about 33 px per row on mobile and never tighter than 26 px on desktop, and it grows instead of scrolling', () => {
    expect(rowSpacing(12, true)).toBe(33);
    expect(rowSpacing(12, false)).toBeGreaterThanOrEqual(26);
    const { padding } = buildPositionChart(pack(12), OPTIONS).geometry;
    expect(chartHeight(12, true)).toBe(2 * padding + 11 * 33);
    expect(chartHeight(12, true)).toBeGreaterThan(chartHeight(6, true));
    expect(chartHeight(12, false)).toBeGreaterThan(chartHeight(6, false));
  });

  it('an array of runners counts the same as a number, and the model reports the same height', () => {
    const data = pack(12);
    expect(chartHeight(data.runners, true)).toBe(chartHeight(12, true));
    expect(buildPositionChart(data, OPTIONS).geometry).toEqual({
      rowHeight: 33,
      padding: expect.any(Number),
      height: chartHeight(12, true),
    });
  });

  it('no row is ever tighter than 24 px, however many runners', () => {
    for (const count of [1, 2, 6, 7, 12, 13, 20]) {
      expect(rowSpacing(count, true)).toBeGreaterThanOrEqual(24);
      expect(rowSpacing(count, false)).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('name labels and current order', () => {
  it('name labels at the line end never overlap: unique rows, at least one row apart', () => {
    for (const mobile of [true, false]) {
      const model = buildPositionChart(pack(12), { meId: 'u-1', mobile });
      const rows = model.lines.map((line) => line.labelY as number).sort((a, b) => a - b);

      expect(new Set(rows).size).toBe(12);
      for (let i = 1; i < rows.length; i += 1) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(model.geometry.rowHeight);
      expect(model.geometry.rowHeight).toBeGreaterThanOrEqual(24);
      expect(Math.max(...rows)).toBeLessThanOrEqual(model.geometry.height);
    }
  });

  it('the name at the line end is the first name, while the table and the aria text use the full name', () => {
    const model = buildPositionChart(trio(), OPTIONS);

    expect(model.lines.map((line) => line.label)).toEqual(['Me', 'Karl', 'Ada']);
    expect(model.lines.map((line) => line.name)).toEqual(['Me Myself', 'Karl Persson', 'Ada']);
    expect(model.table!.rows.map((row) => row.name)).toEqual(['Me Myself', 'Karl Persson', 'Ada']);
    expect(model.ariaLabel).toContain('Karl Persson');
    expect(model.ariaLabel).not.toMatch(/Karl #|Karl \(/);
  });

  it('current order equals the Standings order for the same users', () => {
    // Lika XP för att tie-break (namn, sedan id) ska synas; en medlem utan XP och två med samma namn och olika id.
    const users = [
      { id: 'u-3', name: 'Cecilia', profile_picture: null, total_xp: 500, created_at: '2025-01-01T00:00:00Z' },
      { id: 'u-1', name: 'anna', profile_picture: null, total_xp: 500, created_at: '2025-01-01T00:00:00Z' },
      { id: 'u-2', name: 'Berit', profile_picture: null, total_xp: 900, created_at: '2025-01-01T00:00:00Z' },
      { id: 'u-5', name: 'Doris', profile_picture: null, total_xp: 0, created_at: '2025-01-01T00:00:00Z' },
      { id: 'u-4', name: 'Doris', profile_picture: null, total_xp: 0, created_at: '2025-01-01T00:00:00Z' },
      { id: 'u-6', name: 'Eva', profile_picture: null, total_xp: 0, created_at: '2025-01-01T00:00:00Z' },
    ];
    const { response: history } = buildPositionHistory(users, [], new Date('2026-10-27T10:00:00Z'), 3);
    const standings = [...users].sort((a, b) => compareXpStandings({ id: a.id, name: a.name, xp: a.total_xp }, { id: b.id, name: b.name, xp: b.total_xp }));

    const model = buildPositionChart(history, { meId: 'u-4', mobile: true });

    expect(model.order.map((entry) => entry.id)).toEqual(standings.map((user) => user.id));
    expect(model.order.map((entry) => entry.id)).toEqual(history.runners.map((r) => r.user_id));
    expect(model.lines.map((line) => line.id)).toEqual(standings.map((user) => user.id));
    expect(model.table!.rows.map((row) => row.id)).toEqual(standings.map((user) => user.id));
    expect(model.order.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('the model keeps the API order and never sorts by itself', () => {
    // Medvetet i en annan ordning än placeringarna: ordningen är svarets, modellen lägger ingen egen sortering ovanpå.
    const data = response(2, [runner('u-b', 'Bo', [2, 2]), runner('u-a', 'Al', [1, 1])]);
    expect(buildPositionChart(data, OPTIONS).order.map((entry) => entry.id)).toEqual(['u-b', 'u-a']);
  });

  it('an order entry carries the placement, the avatar data, who is me and when the runner was first placed', () => {
    const data = response(4, [
      runner('u-me', 'Me Myself', [1, 1, 1, 1], 'https://img.test/me.png'),
      runner('u-new', 'Nina Newcomer', [null, null, 2, 2]),
      runner('u-fresh', 'Fred', [null, null, null, 3]),
    ]);
    const { order } = buildPositionChart(data, OPTIONS);

    expect(order[0]).toMatchObject({ id: 'u-me', name: 'Me Myself', position: 1, isMe: true, pictureUrl: 'https://img.test/me.png', initials: 'MM', firstPlacedWeek: null });
    expect(order[1]).toMatchObject({ id: 'u-new', position: 2, isMe: false, pictureUrl: null, initials: 'NN', firstPlacedWeek: 'W32' });
    // Hen som kom in den här veckan har ingen avslutad placering alls.
    expect(order[2]).toMatchObject({ id: 'u-fresh', firstPlacedWeek: 'W33', isNewcomer: true });
    expect(order.map((entry) => entry.isNewcomer)).toEqual([false, false, true]);
  });
});

describe('table', () => {
  it('rows per runner, columns per week, #N or a dash for null, and the week in progress is called "this week so far"', () => {
    const data = response(4, [runner('u-me', 'Me Myself', [null, 3, 1, 2]), runner('u-ada', 'Ada Lovelace', [1, 1, 2, 1])]);
    const table = buildPositionChart(data, OPTIONS).table!;

    expect(table.columns.map((column) => column.weekLabel)).toEqual(['W30', 'W31', 'W32', 'W33']);
    expect(table.columns.map((column) => column.header)).toEqual(['W30', 'W31', 'W32', 'this week so far']);
    expect(table.columns.map((column) => column.isCurrent)).toEqual([false, false, false, true]);
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['—', '#3', '#1', '#2'],
      ['#1', '#1', '#2', '#1'],
    ]);
    expect(table.rows[0]).toMatchObject({ id: 'u-me', name: 'Me Myself', isMe: true });
    expect(table.rows[0].cells.map((cell) => cell.position)).toEqual([null, 3, 1, 2]);
    expect(table.rows[0].cells.map((cell) => cell.isCurrent)).toEqual([false, false, false, true]);
    expect(table.hasEmptyCells).toBe(true);
    expect(table.caption).toBe('Position per week, weeks 30 to 33. Week 33 is this week so far.');
  });

  it('a dash is spoken as "not in the group yet" and the footnote explains it', () => {
    const data = response(4, [runner('u-me', 'Me Myself', [null, 3, 1, 2]), runner('u-ada', 'Ada Lovelace', [1, 1, 2, 1])]);
    const table = buildPositionChart(data, OPTIONS).table!;

    expect(table.rows[0].cells.map((cell) => cell.spokenText)).toEqual(['not in the group yet', '#3', '#1', '#2']);
    expect(table.rows[1].cells.map((cell) => cell.spokenText)).toEqual(['#1', '#1', '#2', '#1']);
    expect(table.footnote).toBe('— = not in the group yet');
  });

  it('a table without any empty cell says so', () => {
    const table = buildPositionChart(trio(), OPTIONS).table!;

    expect(table.hasEmptyCells).toBe(false);
    expect(table.footnote).toBeNull();
  });
});

describe('role img text', () => {
  it('names every runner with the current placement and full name, marks me, and calls the last week this week so far', () => {
    const model = buildPositionChart(trio(), OPTIONS);

    expect(model.ariaLabel).toBe(
      'Position over time, weeks 30 to 33. Week 33 is this week so far. Me Myself (you) #1, Karl Persson #2, Ada #3.',
    );
  });

  it('speaks the period as "weeks 30 to 33", and as "week 30" for a single week', () => {
    expect(buildPositionChart(trio(), OPTIONS).spokenRange).toBe('weeks 30 to 33');
    expect(buildPositionChart(response(1, [runner('u-me', 'Me', [1]), runner('u-bo', 'Bo', [2])]), OPTIONS).spokenRange).toBe('week 30');
  });

  it('twelve runners are all named', () => {
    const { ariaLabel } = buildPositionChart(pack(12), OPTIONS);
    for (let i = 1; i <= 12; i += 1) expect(ariaLabel).toContain(`Runner ${i} Surname #${i}`);
  });

  it('keeps the years on a period that crosses the ISO year boundary', () => {
    const data = response(2, [runner('u-1', 'Ann', [1, 1]), runner('u-2', 'Bo', [2, 2])]);
    data.weeks = [
      { start: '2026-12-21', end: '2026-12-27', iso_week: 52, iso_year: 2026, is_current_week: false },
      { start: '2026-12-28', end: '2027-01-03', iso_week: 53, iso_year: 2026, is_current_week: false },
      { start: '2027-01-04', end: '2027-01-10', iso_week: 1, iso_year: 2027, is_current_week: true },
    ];
    data.runners.forEach((r) => r.positions.unshift(r.positions[0]));
    const model = buildPositionChart(data, OPTIONS);

    expect(model.range).toBe('week 52, 2026 - week 1, 2027');
    expect(model.spokenRange).toBe('week 52, 2026 to week 1, 2027');
    expect(model.ariaLabel).toContain('week 52, 2026 to week 1, 2027');
    expect(model.ariaLabel).not.toContain(model.range);
    expect(model.ariaLabel).toContain('Week 1, 2027 is this week so far');
  });
});

describe('modes', () => {
  it('one runner gives hidden', () => {
    const model = buildPositionChart(response(4, [runner('u-me', 'Me', [1, 1, 1, 1])]), OPTIONS);

    expect(model.mode).toBe('hidden');
    expect(model.lines).toEqual([]);
    expect(model.table).toBeNull();
  });

  it('an empty pack gives hidden', () => {
    expect(buildPositionChart({ as_of: '2026-10-27', weeks: [], runners: [] }, OPTIONS).mode).toBe('hidden');
  });

  it('a response without any weeks gives hidden even with two or more runners, and never throws', () => {
    const data: PositionHistoryResponse = { as_of: '2026-10-27', weeks: [], runners: [runner('u-1', 'Ann', []), runner('u-2', 'Bo', [])] };
    const model = buildPositionChart(data, OPTIONS);

    expect(model.mode).toBe('hidden');
    expect(model.weeks).toEqual([]);
    expect(model.lines).toEqual([]);
    expect(model.order).toEqual([]);
    expect(model.table).toBeNull();
    expect(model.gridRows).toEqual([]);
    expect(model.ariaLabel).toBe('');
  });

  it('two or more runners without a finished week give no-finished-week, and the current order is still there', () => {
    const data = response(1, [runner('u-me', 'Me', [1]), runner('u-karl', 'Karl', [2])]);
    const model = buildPositionChart(data, OPTIONS);

    expect(model.mode).toBe('no-finished-week');
    expect(model.lines).toEqual([]);
    expect(model.order.map((entry) => entry.id)).toEqual(['u-me', 'u-karl']);
    expect(model.message).toBe(NO_FINISHED_WEEK_MESSAGE);
  });

  it('only no-finished-week carries a message; a chart and hidden have none', () => {
    expect(buildPositionChart(trio(), OPTIONS).message).toBeNull();
    expect(buildPositionChart(response(1, [runner('u-me', 'Me', [1])]), OPTIONS).message).toBeNull();
  });

  it('two runners with one finished week draw a chart', () => {
    const data = response(2, [runner('u-me', 'Me', [1, 1]), runner('u-karl', 'Karl', [2, 2])]);
    const model = buildPositionChart(data, OPTIONS);

    expect(model.mode).toBe('chart');
    expect(model.lines[0].points.map((point) => point.x)).toEqual([0, 1]);
  });

  it('twelve runners work, on mobile and desktop', () => {
    for (const mobile of [true, false]) {
      const model = buildPositionChart(pack(12), { meId: 'u-7', mobile });
      expect(model.mode).toBe('chart');
      expect(model.lines).toHaveLength(12);
      expect(model.order).toHaveLength(12);
      expect(model.table!.rows).toHaveLength(12);
      expect(model.lines.filter((line) => line.isMe).map((line) => line.id)).toEqual(['u-7']);
    }
  });

  it('the number of weeks follows the response, from 2 up to 26', () => {
    for (const count of [2, 3, 8, 26]) {
      const model = buildPositionChart(pack(3, count), OPTIONS);
      expect(model.weeks).toHaveLength(count);
      expect(model.table!.columns).toHaveLength(count);
      expect(model.lines[0].points).toHaveLength(count);
      expect(model.lines[0].points.map((point) => point.x)).toEqual(Array.from({ length: count }, (_, i) => i / (count - 1)));
    }
  });

  it('a runner without a live placement stays in the table with a dash and gets no label row', () => {
    const data = response(2, [runner('u-1', 'Ann', [1, 1]), runner('u-2', 'Bo', [2, null])]);
    const model = buildPositionChart(data, OPTIONS);

    expect(model.lines[1].labelY).toBeNull();
    expect(model.lines[1].position).toBeNull();
    expect(model.table!.rows[1].cells.map((cell) => cell.text)).toEqual(['#2', '—']);
    expect(model.ariaLabel).toContain('Bo (no placement)');
  });
});

describe('geometry for the components', () => {
  it('every week carries the same x as the points of that week, so axis labels line up with the dots', () => {
    for (const count of [2, 4, 8, 26]) {
      const model = buildPositionChart(pack(3, count), OPTIONS);

      expect(model.weeks.map((week) => week.x)).toEqual(Array.from({ length: count }, (_, i) => i / (count - 1)));
      for (const line of model.lines) {
        for (const point of line.points) expect(point.x).toBe(model.weeks[point.weekIndex].x);
      }
    }
  });

  it('week x runs from 0 for the oldest week to 1 for the week in progress', () => {
    const { weeks } = buildPositionChart(trio(), OPTIONS);
    expect(weeks[0].x).toBe(0);
    expect(weeks[weeks.length - 1].x).toBe(1);
  });

  it('grid rows sit where the points for that placement sit, one row per runner', () => {
    for (const mobile of [true, false]) {
      const model = buildPositionChart(pack(12), { meId: 'u-1', mobile });
      const { padding, rowHeight } = model.geometry;

      expect(model.gridRows).toHaveLength(12);
      expect(model.gridRows.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(model.gridRows.map((row) => row.y)).toEqual(Array.from({ length: 12 }, (_, k) => padding + k * rowHeight));
      for (const line of model.lines) {
        for (const point of line.points) expect(model.gridRows[point.position - 1].y).toBe(point.y);
        expect(model.gridRows[(line.position as number) - 1].y).toBe(line.labelY);
      }
      expect(model.gridRows[11].y + padding).toBe(model.geometry.height);
    }
  });

  it('grid rows are there for no-finished-week too, and none for hidden', () => {
    const two = response(1, [runner('u-1', 'Ann', [1]), runner('u-2', 'Bo', [2])]);
    expect(buildPositionChart(two, OPTIONS).gridRows.map((row) => row.position)).toEqual([1, 2]);
    expect(buildPositionChart(response(3, [runner('u-1', 'Ann', [1, 1, 1])]), OPTIONS).gridRows).toEqual([]);
  });
});
