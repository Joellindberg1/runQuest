/**
 * RUN-218 T2 — karaktäriseringstester för backendens datumkopior, skrivna INNAN de ersattes av packages/shared/src/calendar.ts.
 *
 * Kopiorna (utils/dateUtils.ts och titleEngines/_utils.ts) förväntas ge samma svar som shared-kopiorna i
 * packages/shared/src/__tests__/calendarCharacterization.test.ts. Etiketterna är de gamla namnen; efter sammanslagningen
 * pekar de på delade funktioner och tabellerna ska vara oförändrade.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { addDays, dayOfWeek, daysBetween, mondayOf, zoneDay } from '@runquest/shared';
import { weekRange } from '../dateUtils.js';
import { wallClockMinutes as utcMinutes } from '@runquest/shared';
import { earlyRunCountEngine } from '../../titleEngines/earlyRunCount.js';
import { lunchRunCountEngine } from '../../titleEngines/lunchRunCount.js';
import { nightRunCountEngine } from '../../titleEngines/nightRunCount.js';

afterEach(() => { vi.useRealTimers(); });

const atInstant = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe('addDays (was dateUtils.addDaysToDate)', () => {
  it.each([
    ['2026-10-04', 1, '2026-10-05'],
    ['2026-10-04', 0, '2026-10-04'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-28', 2, '2028-03-01'],
    ['2026-01-31', 30, '2026-03-02'],
    ['2026-10-04', -365, '2025-10-04'],
    ['2026-10-04', 400, '2027-11-08'],
    ['2026-03-28', 1, '2026-03-29'],
    ['2026-03-29', 1, '2026-03-30'],
    ['2026-03-30', -1, '2026-03-29'],
    ['2026-10-24', 1, '2026-10-25'],
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-10-26', -1, '2026-10-25'],
    ['2026-03-23', 7, '2026-03-30'],
    ['2026-10-19', 7, '2026-10-26'],
  ])('%s %i dagar -> %s', (day, days, expected) => {
    expect(addDays(day, days)).toBe(expected);
  });

  it('ogiltig indata kastar RangeError', () => {
    expect(() => addDays('inte-ett-datum', 1)).toThrow(RangeError);
    expect(() => addDays('2026-10-04T10:00:00Z', 1)).toThrow(RangeError);
  });
});

const MONDAY_CASES: Array<[string, string]> = [
  ['2026-09-28', '2026-09-28'],
  ['2026-09-29', '2026-09-28'],
  ['2026-09-30', '2026-09-28'],
  ['2026-10-01', '2026-09-28'],
  ['2026-10-02', '2026-09-28'],
  ['2026-10-03', '2026-09-28'],
  ['2026-10-04', '2026-09-28'], // söndag
  ['2026-10-05', '2026-10-05'],
  ['2026-01-01', '2025-12-29'],
  ['2027-01-03', '2026-12-28'],
  ['2024-03-01', '2024-02-26'],
  ['2024-02-29', '2024-02-26'],
  ['2026-03-29', '2026-03-23'],
  ['2026-03-30', '2026-03-30'],
  ['2026-10-25', '2026-10-19'],
  ['2026-10-26', '2026-10-26'],
];

describe.each([
  ['dateUtils.mondayOf (legacy)', mondayOf],
  ['titleEngines/_utils.getMondayKey (legacy)', mondayOf],
] as Array<[string, (day: string) => string]>)('mondayOf — %s', (_label, monday) => {
  it.each(MONDAY_CASES)('%s -> %s', (day, expected) => {
    expect(monday(day)).toBe(expected);
  });
});

describe('daysBetween (was titleEngines/_utils)', () => {
  it.each([
    ['2026-10-04', '2026-10-04', 0],
    ['2026-10-04', '2026-10-05', 1],
    ['2026-10-05', '2026-10-04', -1],
    ['2026-09-30', '2026-10-01', 1],
    ['2025-12-31', '2026-01-01', 1],
    ['2028-02-28', '2028-03-01', 2],
    ['2027-02-28', '2027-03-01', 1],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-01-01', '2027-01-01', 365],
    ['2028-01-01', '2029-01-01', 366],
  ])('%s -> %s = %i', (from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });

  it('ogiltig indata ger NaN', () => {
    expect(daysBetween('x', 'y')).toBeNaN();
  });
});

describe('dayOfWeek (was titleEngines/_utils) — 0 = söndag', () => {
  it.each([
    ['2026-10-04', 0], ['2026-10-05', 1], ['2026-10-06', 2], ['2026-10-07', 3], ['2026-10-08', 4], ['2026-10-09', 5], ['2026-10-10', 6],
    ['2026-03-29', 0], ['2026-10-25', 0], ['2024-02-29', 4], ['2027-01-01', 5],
  ])('%s -> %i', (day, expected) => {
    expect(dayOfWeek(day)).toBe(expected);
  });
});

describe('utcMinutes (was titleEngines/_utils) — klockslag ur siffrorna i start_time', () => {
  it.each([
    ['2026-07-04T05:30:00Z', 330],
    ['2026-01-10T04:00:00+00:00', 240],
    ['2026-07-04T00:00:00Z', 0],
    ['2026-07-04T23:59:00Z', 1439],
    ['2026-07-04T21:30:00.000Z', 1290],
    ['2026-03-29T02:30:00Z', 150], // vårens "hoppade" timme: väggklockan konverteras aldrig
  ])('%s -> %i', (startTime, expected) => {
    expect(utcMinutes(startTime)).toBe(expected);
  });

  // utcMinutes gav NaN för ogiltiga värden (och räknades därför aldrig av motorerna); wallClockMinutes ger null och motorerna
  // kollar det, så resultatet är detsamma. Här fastslås det på motornivå.
  it('ogiltiga start_time räknas inte av klockslagsmotorerna', () => {
    const runs = ['inte-ett-datum', '2026-07-04', '2026-07-04T24:00:00Z'].map((start_time) => (
      { date: '2026-07-04', distance_km: 5, start_time }
    ));
    const stats = { totalKm: 0, longestStreak: 0 };
    expect(earlyRunCountEngine.calculate(runs, stats)).toBe(0);
    expect(lunchRunCountEngine.calculate(runs, stats)).toBe(0);
    expect(nightRunCountEngine.calculate(runs, stats)).toBe(0);
  });

  // Dokumenterad skillnad (RUN-218): utcMinutes konverterade en verklig offset till UTC (08:00+02:00 -> 360), shared
  // wallClockMinutes läser siffrorna rakt av (-> 480), som badgemotorn alltid gjort. PostgREST levererar timestamptz som
  // +00:00 och Strava-importen skriver Z, så en verklig offset förekommer inte i riktig data.
  it('en verklig offset ändrar inte siffrorna (08:00+02:00 är 08:00 väggklocka)', () => {
    expect(utcMinutes('2026-07-04T08:00:00+02:00')).toBe(480);
  });
});

describe('zoneDay (the day of an instant in the default zone)', () => {
  it.each([
    ['2026-10-04T22:30:00Z', '2026-10-05'],
    ['2026-10-04T21:59:59Z', '2026-10-04'],
    ['2026-12-31T23:30:00Z', '2027-01-01'],
    ['2026-12-31T22:59:59Z', '2026-12-31'],
    ['2026-03-28T22:59:59Z', '2026-03-28'],
    ['2026-03-28T23:00:00Z', '2026-03-29'],
    ['2026-10-24T21:59:59Z', '2026-10-24'],
    ['2026-10-24T22:00:00Z', '2026-10-25'],
    ['2026-10-25T22:59:59Z', '2026-10-25'],
    ['2026-10-25T23:00:00Z', '2026-10-26'],
    ['2028-02-28T23:30:00Z', '2028-02-29'],
  ])('%s -> idag %s (dagen och morgondagen)', (iso, today) => {
    atInstant(iso);
    expect(zoneDay(new Date())).toBe(today);
    expect(zoneDay(new Date(iso))).toBe(today);
    expect(addDays(zoneDay(new Date()), 1)).toBe(addDays(today, 1));
  });
});

describe('weekRange (dateUtils)', () => {
  it('veckan över sommartidsskiftena ger sju dagar och rätt måndag', () => {
    expect(weekRange('2026-03-29')).toEqual({ start: '2026-03-23', end: '2026-03-29', previous_start: '2026-03-16' });
    expect(weekRange('2026-10-25')).toEqual({ start: '2026-10-19', end: '2026-10-25', previous_start: '2026-10-12' });
    expect(weekRange('2027-01-03')).toEqual({ start: '2026-12-28', end: '2027-01-03', previous_start: '2026-12-21' });
  });
});
