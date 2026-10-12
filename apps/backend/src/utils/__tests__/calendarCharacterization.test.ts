/**
 * RUN-218 T2 — karaktäriseringstester för backendens datumkopior, skrivna INNAN de ersattes av packages/shared/src/calendar.ts.
 *
 * Kopiorna (utils/dateUtils.ts och titleEngines/_utils.ts) förväntas ge samma svar som shared-kopiorna i
 * packages/shared/src/__tests__/calendarCharacterization.test.ts. Etiketterna är de gamla namnen; efter sammanslagningen
 * pekar de på delade funktioner och tabellerna ska vara oförändrade.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import {
  addDaysToDate, at3amStockholm, mondayOf, todayStockholm, toStockholmDate, tomorrowStockholm, weekRange,
} from '../dateUtils.js';
import { daysBetween, dayOfWeek, getMondayKey, utcMinutes } from '../../titleEngines/_utils.js';

afterEach(() => { vi.useRealTimers(); });

const atInstant = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe('addDaysToDate (dateUtils)', () => {
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
    expect(addDaysToDate(day, days)).toBe(expected);
  });

  it('ogiltig indata kastar RangeError', () => {
    expect(() => addDaysToDate('inte-ett-datum', 1)).toThrow(RangeError);
    expect(() => addDaysToDate('2026-10-04T10:00:00Z', 1)).toThrow(RangeError);
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
  ['dateUtils.mondayOf', mondayOf],
  ['titleEngines/_utils.getMondayKey', getMondayKey],
] as Array<[string, (day: string) => string]>)('mondayOf — %s', (_label, monday) => {
  it.each(MONDAY_CASES)('%s -> %s', (day, expected) => {
    expect(monday(day)).toBe(expected);
  });
});

describe('daysBetween (titleEngines/_utils)', () => {
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

describe('dayOfWeek (titleEngines/_utils) — 0 = söndag', () => {
  it.each([
    ['2026-10-04', 0], ['2026-10-05', 1], ['2026-10-06', 2], ['2026-10-07', 3], ['2026-10-08', 4], ['2026-10-09', 5], ['2026-10-10', 6],
    ['2026-03-29', 0], ['2026-10-25', 0], ['2024-02-29', 4], ['2027-01-01', 5],
  ])('%s -> %i', (day, expected) => {
    expect(dayOfWeek(day)).toBe(expected);
  });
});

describe('utcMinutes (titleEngines/_utils) — klockslag ur siffrorna i start_time', () => {
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

  it('ogiltigt värde ger NaN', () => {
    expect(utcMinutes('inte-ett-datum')).toBeNaN();
  });

  // Dokumenterad avvikelse mot shared wallClockMinutes (som läser siffrorna rakt av): en verklig offset konverteras till UTC.
  // PostgREST levererar timestamptz som +00:00, så det slår aldrig in på riktig data. Flyttas i commiten som tar bort utcMinutes.
  it('nuvarande beteende: en verklig offset konverteras (08:00+02:00 är 06:00 UTC)', () => {
    expect(utcMinutes('2026-07-04T08:00:00+02:00')).toBe(360);
  });
});

describe('todayStockholm / tomorrowStockholm / toStockholmDate (dateUtils)', () => {
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
  ])('%s -> idag %s (och toStockholmDate ger samma)', (iso, today) => {
    atInstant(iso);
    expect(todayStockholm()).toBe(today);
    expect(toStockholmDate(iso)).toBe(today);
    expect(tomorrowStockholm()).toBe(addDaysToDate(today, 1));
  });
});

describe('at3amStockholm (dateUtils) — 03:00 Stockholm som UTC-ögonblick', () => {
  // Kopian tolkar middagens Stockholm-klockslag med `new Date(<lokal sträng>)`, alltså i PROCESSENS tidszon, och är bara
  // korrekt i en UTC-process (Railway). Den karaktäriseras därför i UTC; med TZ=Europe/Stockholm ger den 03:00Z året runt.
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each([
    ['2026-01-15', '2026-01-15T02:00:00.000Z'], // vinter, +1
    ['2026-07-01', '2026-07-01T01:00:00.000Z'], // sommar, +2
    ['2026-03-28', '2026-03-28T02:00:00.000Z'],
    ['2026-03-29', '2026-03-29T01:00:00.000Z'], // vårens DST-dag: 03:00 ligger efter växlingen
    ['2026-03-30', '2026-03-30T01:00:00.000Z'],
    ['2026-10-24', '2026-10-24T01:00:00.000Z'],
    ['2026-10-25', '2026-10-25T02:00:00.000Z'], // höstens DST-dag: 03:00 ligger efter växlingen (+1)
    ['2026-10-26', '2026-10-26T02:00:00.000Z'],
  ])('%s -> %s', (day, expected) => {
    expect(at3amStockholm(day).toISOString()).toBe(expected);
  });
});

describe('weekRange (dateUtils)', () => {
  it('veckan över sommartidsskiftena ger sju dagar och rätt måndag', () => {
    expect(weekRange('2026-03-29')).toEqual({ start: '2026-03-23', end: '2026-03-29', previous_start: '2026-03-16' });
    expect(weekRange('2026-10-25')).toEqual({ start: '2026-10-19', end: '2026-10-25', previous_start: '2026-10-12' });
    expect(weekRange('2027-01-03')).toEqual({ start: '2026-12-28', end: '2027-01-03', previous_start: '2026-12-21' });
  });
});
