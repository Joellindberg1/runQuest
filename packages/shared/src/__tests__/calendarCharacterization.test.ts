/**
 * RUN-218 T2 — karaktäriseringstester för datumaritmetiken, skrivna INNAN kopiorna slogs ihop till calendar.ts.
 *
 * Varje begrepp (addDays, mondayOf, daysBetween, Stockholm-dagen, midnatt) fanns i flera kopior med olika namn. Tabellerna
 * nedan körs mot varje kopia för sig och förväntar exakt samma svar, så att en kopia som skiljer sig syns. De gröna
 * värdena låser beteendet som sammanslagningen inte får ändra; efter sammanslagningen pekar alla etiketter på samma funktion.
 */
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, mondayOf, stockholmDay, stockholmMidnightIso } from '../calendar.js';
import { buildXpLedger } from '../xpLedger.js';

const ADD_DAYS: Array<[string, (day: string, days: number) => string]> = [
  ['activity.addDaysToDay (legacy)', addDays],
  ['leaderboard.addDaysToCalendarDate (legacy)', addDays],
];

const MONDAY_OF: Array<[string, (day: string) => string]> = [
  ['leaderboard.mondayOfCalendarDate (legacy)', mondayOf],
];

const DAYS_BETWEEN: Array<[string, (from: string, to: string) => number]> = [
  ['streak.calendarDaysBetween (legacy)', daysBetween],
];

describe.each(ADD_DAYS)('addDays — %s', (_label, add) => {
  it.each([
    ['2026-10-04', 1, '2026-10-05'],
    ['2026-10-04', 0, '2026-10-04'],
    ['2026-10-31', 1, '2026-11-01'], // månadsskifte
    ['2026-12-31', 1, '2027-01-01'], // årsskifte
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'], // skottår
    ['2028-02-28', 2, '2028-03-01'],
    ['2026-01-31', 30, '2026-03-02'],
    ['2026-10-04', -365, '2025-10-04'],
    ['2026-10-04', 400, '2027-11-08'],
    ['2026-03-28', 1, '2026-03-29'], // sommartid börjar 2026-03-29
    ['2026-03-29', 1, '2026-03-30'],
    ['2026-03-30', -1, '2026-03-29'],
    ['2026-10-24', 1, '2026-10-25'], // sommartid slutar 2026-10-25
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-10-26', -1, '2026-10-25'],
    ['2026-03-23', 7, '2026-03-30'], // en vecka över sommartidsskiftet
    ['2026-10-19', 7, '2026-10-26'],
  ])('%s %i dagar -> %s', (day, days, expected) => {
    expect(add(day, days)).toBe(expected);
  });

  it('ogiltig indata kastar RangeError (ingen tyst NaN-sträng)', () => {
    expect(() => add('inte-ett-datum', 1)).toThrow(RangeError);
    expect(() => add('2026-10-04T10:00:00Z', 1)).toThrow(RangeError);
  });
});

describe.each(MONDAY_OF)('mondayOf — %s', (_label, monday) => {
  it.each([
    ['2026-09-28', '2026-09-28'], // mån
    ['2026-09-29', '2026-09-28'],
    ['2026-09-30', '2026-09-28'],
    ['2026-10-01', '2026-09-28'],
    ['2026-10-02', '2026-09-28'],
    ['2026-10-03', '2026-09-28'], // lör
    ['2026-10-04', '2026-09-28'], // sön hör till veckan som slutar, inte till nästa
    ['2026-10-05', '2026-10-05'],
    ['2026-01-01', '2025-12-29'], // årsskifte bakåt
    ['2027-01-03', '2026-12-28'], // söndag över årsskifte
    ['2024-03-01', '2024-02-26'], // skottår
    ['2024-02-29', '2024-02-26'],
    ['2026-03-29', '2026-03-23'], // sommartidsdagen (söndag)
    ['2026-03-30', '2026-03-30'],
    ['2026-10-25', '2026-10-19'], // sommartid slutar (söndag)
    ['2026-10-26', '2026-10-26'],
  ])('%s -> %s', (day, expected) => {
    expect(monday(day)).toBe(expected);
  });
});

describe.each(DAYS_BETWEEN)('daysBetween — %s', (_label, between) => {
  it.each([
    ['2026-10-04', '2026-10-04', 0],
    ['2026-10-04', '2026-10-05', 1],
    ['2026-10-05', '2026-10-04', -1],
    ['2026-09-30', '2026-10-01', 1],
    ['2025-12-31', '2026-01-01', 1],
    ['2028-02-28', '2028-03-01', 2], // skottår
    ['2027-02-28', '2027-03-01', 1],
    ['2026-03-28', '2026-03-30', 2], // över vårens DST-dag: 47 h, men 2 kalenderdagar
    ['2026-10-24', '2026-10-26', 2], // över höstens: 49 h, men 2 kalenderdagar
    ['2026-01-01', '2027-01-01', 365],
    ['2028-01-01', '2029-01-01', 366],
  ])('%s -> %s = %i', (from, to, expected) => {
    expect(between(from, to)).toBe(expected);
  });

  it('ogiltig indata ger NaN', () => {
    expect(between('x', 'y')).toBeNaN();
    expect(between('2026-10-04', 'inte-ett-datum')).toBeNaN();
  });
});

describe('stockholmDay (streak.ts)', () => {
  it.each([
    ['2026-10-04T22:30:00Z', '2026-10-05'], // sommartid: UTC-kvällen är redan nästa Stockholm-dag
    ['2026-10-04T21:59:59Z', '2026-10-04'],
    ['2026-12-31T23:30:00Z', '2027-01-01'], // vintertid
    ['2026-12-31T22:59:59Z', '2026-12-31'],
    ['2026-03-28T22:59:59Z', '2026-03-28'], // vårens gräns
    ['2026-03-28T23:00:00Z', '2026-03-29'],
    ['2026-10-24T21:59:59Z', '2026-10-24'], // höstens gräns
    ['2026-10-24T22:00:00Z', '2026-10-25'],
    ['2026-10-25T22:59:59Z', '2026-10-25'],
    ['2026-10-25T23:00:00Z', '2026-10-26'],
    ['2028-02-28T23:30:00Z', '2028-02-29'],
    ['2026-07-01T12:00:00Z', '2026-07-01'],
  ])('%s -> %s', (iso, expected) => {
    expect(stockholmDay(new Date(iso))).toBe(expected);
  });

  it('ogiltigt ögonblick kastar RangeError', () => {
    expect(() => stockholmDay(new Date('inte-ett-datum'))).toThrow(RangeError);
  });
});

describe('Stockholm-dagen i XP-liggaren (xpLedger.toStockholmDay) — samma dag som stockholmDay', () => {
  const entry = (at: string) => ({
    entry_id: 'e', user_id: 'u', event_id: 'ev', event_type: 'participation' as const,
    xp_awarded: 10, qualified_at: at, settled_at: null, ends_at: at,
  });

  it.each([
    '2026-10-04T22:30:00Z', '2026-10-04T21:59:59Z', '2026-12-31T23:30:00Z', '2026-03-28T22:59:59Z', '2026-03-28T23:00:00Z',
    '2026-10-24T21:59:59Z', '2026-10-24T22:00:00Z', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z', '2028-02-28T23:30:00Z',
  ])('%s', (iso) => {
    const [row] = buildXpLedger([], [entry(iso)]);
    expect(row.date).toBe(stockholmDay(new Date(iso)));
  });
});

describe('stockholmMidnightIso (activity.ts)', () => {
  it.each([
    ['2026-01-15', '2026-01-14T23:00:00.000Z'],
    ['2026-07-01', '2026-06-30T22:00:00.000Z'],
    ['2026-03-28', '2026-03-27T23:00:00.000Z'],
    ['2026-03-29', '2026-03-28T23:00:00.000Z'], // DST-dagen: midnatt ligger före växlingen
    ['2026-03-30', '2026-03-29T22:00:00.000Z'],
    ['2026-10-24', '2026-10-23T22:00:00.000Z'],
    ['2026-10-25', '2026-10-24T22:00:00.000Z'],
    ['2026-10-26', '2026-10-25T23:00:00.000Z'],
    ['2027-01-01', '2026-12-31T23:00:00.000Z'],
  ])('%s -> %s', (day, expected) => {
    expect(stockholmMidnightIso(day)).toBe(expected);
  });

  it('är första ögonblicket i Stockholm-dagen: en millisekund tidigare tillhör dagen innan, i alla årets 365 dagar', () => {
    let day = '2026-01-01';
    for (let i = 0; i < 365; i += 1) {
      const start = Date.parse(stockholmMidnightIso(day));
      expect(stockholmDay(new Date(start))).toBe(day);
      expect(stockholmDay(new Date(start - 1))).toBe(addDays(day, -1));
      day = addDays(day, 1);
    }
  });
});
