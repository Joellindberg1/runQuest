import { describe, expect, it } from 'vitest';
import type { GroupEligibilityEntry, TitleLeaderboard } from '@/shared/services/backendApi';
import { TITLE_ENGINE_METRIC_KEYS } from './titleMetricKeys.fixture';
import {
  MAX_DISPLAYED, bestSoFar, buildChases, buildDisplayedRows, buildTitleRow, buildTitlesView, cleanSelection, formatDisplayPreview,
  heldTitleIds, sameSelection, summaryText, toggleDisplayed,
} from './titlesModel';

const ME = 'u-me';
const KARL = 'u-karl';

const person = (user_id: string, user_name: string, value: number, extra: object = {}) => ({
  user_id, user_name, value, earned_at: '', ...extra,
});
const runnerUp = (position: number, user_id: string, user_name: string, value: number) => ({ position, ...person(user_id, user_name, value) });

const title = (id: string, name: string, metric_key: string | undefined, over: Partial<TitleLeaderboard> = {}): TitleLeaderboard => ({
  id, name, description: `${name} rule`, unlock_requirement: 0, metric_key, holder: null, runners_up: [], ...over,
});

// Ett litet urval ur gruppen: en av mig, en av Karl med mig som #2, en olåst, en tid (ej linjär), en okänd nyckel.
const BATMAN = title('t-batman', 'The Batman', 'nightRunCount', {
  unlock_requirement: 7,
  holder: person(KARL, 'Karl Persson', 18),
  runners_up: [runnerUp(2, ME, 'Joel Lindberg', 7)],
});
const LUNCH = title('t-lunch', 'The Lunch Breaker', 'lunchRunCount', {
  unlock_requirement: 7,
  holder: person(ME, 'Joel Lindberg', 31),
  runners_up: [runnerUp(3, 'u-dan', 'Daniel Lindblad Lüthje', 9), runnerUp(2, 'u-adam', 'Adam Einstein', 13)],
});
const COMMUTER = title('t-commuter', 'The Early Commuter', 'maxWeekdayStreak', { unlock_requirement: 20 });
const KIPCHOGE = title('t-kip', 'The Kipchoge', 'fastestMarathon', {
  unlock_requirement: 250,
  holder: person('u-nick', 'Nicklas Von Elling', 540),
  runners_up: [runnerUp(2, ME, 'Joel Lindberg', 500)],
});
const FUTURE = title('t-future', 'The Newcomer', 'someFutureMetric', { holder: person(KARL, 'Karl Persson', 3.25) });
const BOARD = [BATMAN, LUNCH, COMMUTER, KIPCHOGE, FUTURE];

const eligibility = (userId: string, name: string, values: Record<string, number>): GroupEligibilityEntry => ({ userId, name, gender: null, values });
const ELIGIBILITY = [
  eligibility(ME, 'Joel Lindberg', { maxWeekdayStreak: 11, nightRunCount: 7 }),
  eligibility(KARL, 'Karl Persson', { maxWeekdayStreak: 14, nightRunCount: 18 }),
  eligibility('u-adam', 'Adam Einstein', { maxWeekdayStreak: 0 }),
];

describe('buildTitleRow', () => {
  it('innehavare, värde i rätt enhet och regeln ordagrant ur databasen', () => {
    const row = buildTitleRow(BATMAN, ELIGIBILITY, ME);
    expect(row).toMatchObject({
      id: 't-batman', name: 'The Batman', rule: 'The Batman rule', state: 'held', categoryId: 'time', icon: 'moon',
      holder: { name: 'Karl Persson', value: '18 runs', mine: false },
      bestSoFar: null, unlock: null,
    });
  });

  it('min titel: state mine och holder.mine', () => {
    const row = buildTitleRow(LUNCH, ELIGIBILITY, ME);
    expect(row.state).toBe('mine');
    expect(row.holder).toEqual({ name: 'Joel Lindberg', value: '31 runs', mine: true });
  });

  it('runner-ups #2/#3 sorteras på position (inte på ordningen från API:t) och markerar mig', () => {
    const lunch = buildTitleRow(LUNCH, ELIGIBILITY, ME);
    expect(lunch.runnersUp).toEqual([
      { position: 2, name: 'Adam Einstein', value: '13 runs', mine: false },
      { position: 3, name: 'Daniel Lindblad Lüthje', value: '9 runs', mine: false },
    ]);
    expect(buildTitleRow(BATMAN, ELIGIBILITY, ME).runnersUp).toEqual([{ position: 2, name: 'Joel Lindberg', value: '7 runs', mine: true }]);
  });

  it('positioner över 3 visas inte som runner-up', () => {
    const row = buildTitleRow({ ...BATMAN, runners_up: [runnerUp(4, 'x', 'X', 1), runnerUp(2, 'y', 'Y', 2)] }, [], ME);
    expect(row.runnersUp.map((runner) => runner.position)).toEqual([2]);
  });

  it('olåst titel: "nobody yet" (holder null), närmaste löpare ur eligibility även under tröskeln, och kravet', () => {
    const row = buildTitleRow(COMMUTER, ELIGIBILITY, ME);
    expect(row.state).toBe('unclaimed');
    expect(row.holder).toBeNull();
    expect(row.bestSoFar).toEqual({ name: 'Karl Persson', value: '14 weekdays' });
    expect(row.unlock).toBe('20 weekdays');
    expect(row.runnersUp).toEqual([]);
  });

  it('olåst titel utan någon framgång: ingen "best so far"', () => {
    const row = buildTitleRow(COMMUTER, [eligibility(ME, 'Joel', { maxWeekdayStreak: 0 })], ME);
    expect(row.bestSoFar).toBeNull();
  });

  it('en tid avkodas ur sorteringsvärdet', () => {
    expect(buildTitleRow(KIPCHOGE, ELIGIBILITY, ME).holder?.value).toBe('3h00m');
  });

  it('okänd metric_key: titeln är kvar (Other), bara talet visas (ingen påhittad enhet)', () => {
    const row = buildTitleRow(FUTURE, ELIGIBILITY, ME);
    expect(row.categoryId).toBe('other');
    expect(row.holder?.value).toBe('3.3');
  });

  it('King/Queen följer innehavarens kön', () => {
    const king = title('t-xp', 'XP King/Queen', 'totalKm', { holder: person(KARL, 'Karl', 900, { user_gender: 'male' }) });
    expect(buildTitleRow(king, [], ME).name).toBe('XP King');
  });

  it('saknad runners_up i svaret kraschar inte', () => {
    const odd = { ...BATMAN, runners_up: undefined } as unknown as TitleLeaderboard;
    expect(buildTitleRow(odd, [], ME).runnersUp).toEqual([]);
  });
});

describe('bestSoFar', () => {
  it('högst värde över 0; lika värden → första löparen', () => {
    expect(bestSoFar('x', [eligibility('a', 'A', { x: 5 }), eligibility('b', 'B', { x: 9 }), eligibility('c', 'C', { x: 9 })])).toEqual({ name: 'B', value: 9 });
  });

  it('ignorerar 0, negativa sentineller, NaN och saknade nycklar', () => {
    expect(bestSoFar('x', [eligibility('a', 'A', { x: 0 }), eligibility('b', 'B', { x: -999 }), eligibility('c', 'C', { x: NaN }), eligibility('d', 'D', {})])).toBeNull();
  });

  it('utan måttnyckel eller utan löpare: null', () => {
    expect(bestSoFar(undefined, ELIGIBILITY)).toBeNull();
    expect(bestSoFar('x', [])).toBeNull();
  });
});

describe('buildTitlesView', () => {
  it('räknarna är alla titlar i spel och mina — oberoende av filtret', () => {
    for (const filter of ['all', 'mine', 'unclaimed'] as const) {
      const view = buildTitlesView(BOARD, ELIGIBILITY, ME, filter);
      expect([view.inPlay, view.held]).toEqual([5, 1]);
    }
  });

  it('grupper i kategoriordning med antal, och Other sist', () => {
    const view = buildTitlesView(BOARD, ELIGIBILITY, ME, 'all');
    expect(view.groups.map((group) => [group.id, group.label, group.count])).toEqual([
      ['time', 'Time of day', '2 titles'],
      ['pace', 'Pace', '1 title'],
      ['consistency', 'Consistency', '1 title'],
      ['other', 'Other', '1 title'],
    ]);
  });

  it('Mine: bara titlar jag håller; tomma grupper utelämnas', () => {
    const view = buildTitlesView(BOARD, ELIGIBILITY, ME, 'mine');
    expect(view.groups.map((group) => [group.id, group.rows.map((row) => row.id)])).toEqual([['time', ['t-lunch']]]);
    expect(view.groups[0].count).toBe('1 title');
  });

  it('Unclaimed: bara titlar utan innehavare', () => {
    const view = buildTitlesView(BOARD, ELIGIBILITY, ME, 'unclaimed');
    expect(view.groups.map((group) => [group.id, group.rows.map((row) => row.id)])).toEqual([['consistency', ['t-commuter']]]);
  });

  it('inga titlar alls ger inga grupper', () => {
    expect(buildTitlesView([], [], ME, 'all')).toMatchObject({ inPlay: 0, held: 0, groups: [] });
  });

  it('utan inloggad användare håller ingen något', () => {
    expect(buildTitlesView(BOARD, ELIGIBILITY, null, 'all').held).toBe(0);
  });

  it('en titel per rad — ingen titel dubbleras eller försvinner över grupperna', () => {
    // Alla 21 motornycklar i en tänkt databas: varje titel hamnar i exakt en grupp.
    const all = TITLE_ENGINE_METRIC_KEYS.map((key) => title(`id-${key}`, key, key));
    const view = buildTitlesView(all, [], ME, 'all');
    const ids = view.groups.flatMap((group) => group.rows.map((row) => row.id));
    expect(ids.sort()).toEqual(all.map((entry) => entry.id).sort());
    expect(view.groups.find((group) => group.id === 'other')).toBeUndefined();
  });
});

describe('summaryText', () => {
  it('"21 in play · you hold 5"', () => {
    expect(summaryText({ inPlay: 21, held: 5 }, null)).toBe('21 in play · you hold 5');
  });

  it('desktop lägger till antalet på display', () => {
    expect(summaryText({ inPlay: 21, held: 5 }, 3)).toBe('21 in play · you hold 5 · 3 on display');
  });
});

describe('visning på leaderboarden', () => {
  const held = ['a', 'b', 'c', 'd'];

  it('heldTitleIds: titlar där jag är innehavare', () => {
    expect(heldTitleIds(BOARD, ME)).toEqual(['t-lunch']);
    expect(heldTitleIds(BOARD, null)).toEqual([]);
  });

  it('toggleDisplayed lägger till i klickordning och tar bort vid nytt klick', () => {
    expect(toggleDisplayed([], held, 'b')).toEqual(['b']);
    expect(toggleDisplayed(['b'], held, 'a')).toEqual(['b', 'a']);
    expect(toggleDisplayed(['b', 'a'], held, 'b')).toEqual(['a']);
  });

  it(`stannar vid ${MAX_DISPLAYED}: en fjärde läggs inte till`, () => {
    expect(toggleDisplayed(['a', 'b', 'c'], held, 'd')).toEqual(['a', 'b', 'c']);
  });

  it('en titel jag inte håller kan inte väljas', () => {
    expect(toggleDisplayed(['a'], held, 'zzz')).toEqual(['a']);
  });

  it('cleanSelection tappar förlorade titlar, dubbletter och överskott', () => {
    expect(cleanSelection(['a', 'lost', 'a', 'b', 'c', 'd'], held)).toEqual(['a', 'b', 'c']);
  });

  it('sameSelection jämför innehåll och ordning', () => {
    expect(sameSelection(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false);
  });

  it('buildDisplayedRows: position i valet, namn och värde; en titel som inte längre finns hoppas över', () => {
    const rows = BOARD.map((entry) => buildTitleRow(entry, [], ME));
    expect(buildDisplayedRows(['t-lunch', 'gone'], rows)).toEqual([{ id: 't-lunch', position: 1, name: 'The Lunch Breaker', value: '31 runs' }]);
  });

  it('formatDisplayPreview: som Board-kortets titelrad, med överflödesraden när jag håller fler än tre', () => {
    expect(formatDisplayPreview([], 0)).toBe('No titles selected');
    expect(formatDisplayPreview(['A'], 1)).toBe('A');
    expect(formatDisplayPreview(['A', 'B'], 2)).toBe('A & B');
    expect(formatDisplayPreview(['A', 'B', 'C'], 3)).toBe('A, B & C');
    expect(formatDisplayPreview(['A'], 5)).toBe('A & The one with too many names to mention!');
    expect(formatDisplayPreview(['A', 'B', 'C'], 5)).toBe('A, B, C & The one with too many names to mention!');
  });
});

describe('buildChases', () => {
  const hamster = title('t-ham', 'The Hamster', 'maxRunsOneWeek', {
    holder: person('u-adam', 'Adam Einstein', 10),
    runners_up: [runnerUp(2, ME, 'Joel Lindberg', 6)],
  });
  const weekend = title('t-wk', 'The Weekend Destroyer', 'weekendAvg', {
    holder: person(ME, 'Joel Lindberg', 38.4),
    runners_up: [runnerUp(2, KARL, 'Karl Persson', 35.3)],
  });
  const board = [hamster, weekend, COMMUTER, KIPCHOGE];

  it('de tre slagen, närmast först (avstånd relativt värdet: 8 % · 40 % · 45 %)', () => {
    const chases = buildChases(board, ELIGIBILITY, ME);
    expect(chases.map((chase) => [chase.title, chase.kind, chase.gap, chase.who])).toEqual([
      ['The Weekend Destroyer', 'ahead', '3.1 km', 'Karl Persson is closest behind you'],
      ['The Hamster', 'behind', '4 runs/wk', 'Adam Einstein is ahead of you'],
      ['The Early Commuter', 'unclaimed', '9 weekdays', 'Unclaimed — 20 weekdays unlocks it'],
    ]);
  });

  it('en tid (ej linjärt mått) ger ingen jakt, även om jag är #2', () => {
    expect(buildChases([KIPCHOGE], ELIGIBILITY, ME)).toEqual([]);
  });

  it('högst tre, närmast först', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      title(`t${index}`, `Title ${index}`, 'earlyRunCount', {
        holder: person('u-adam', 'Adam', 100),
        runners_up: [runnerUp(2, ME, 'Joel', 100 - (index + 1) * 10)],
      }),
    );
    const chases = buildChases(many, [], ME);
    expect(chases.map((chase) => chase.title)).toEqual(['Title 0', 'Title 1', 'Title 2']);
  });

  it('olåst titel utan mina värden eller utan krav: ingen jakt', () => {
    expect(buildChases([COMMUTER], [eligibility(ME, 'Joel', {})], ME)).toEqual([]);
    expect(buildChases([{ ...COMMUTER, unlock_requirement: 0 }], ELIGIBILITY, ME)).toEqual([]);
  });

  it('utan inloggad användare: inga jakter', () => {
    expect(buildChases(board, ELIGIBILITY, null)).toEqual([]);
  });
});
