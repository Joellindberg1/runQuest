import { describe, expect, it } from 'vitest';
import {
  dateRangeText, dayLabel, formatClock, formatCountdown, formatDayMonth, formatEventValue, formatKm, formatMetres, formatMinKm, ordinal,
  stockholmDate, weekdayOf, windowText,
} from './eventsFormat';
import { NOW } from './events.fixture';

describe('tider i Stockholm', () => {
  it('klockslag och kalenderdag följer Stockholm, inte UTC', () => {
    expect(formatClock('2026-10-02T16:00:00Z')).toBe('18:00');
    expect(stockholmDate('2026-10-02T22:30:00Z')).toBe('2026-10-03');
    expect(formatClock('2026-10-02T22:00:00Z')).toBe('00:00');
  });

  it('vintertid: UTC+1', () => {
    expect(formatClock('2026-11-02T16:00:00Z')).toBe('17:00');
  });

  it('veckodag ur kalenderdag och egna månadsnamn ("Sep", aldrig "Sept")', () => {
    expect(weekdayOf('2026-10-03')).toBe('Sat');
    expect(weekdayOf('2026-10-05')).toBe('Mon');
    expect(formatDayMonth('2026-09-04')).toBe('4 Sep');
    expect(formatDayMonth('2026-08-21')).toBe('21 Aug');
  });

  it('dayLabel: Today, Tomorrow, sedan veckodag', () => {
    expect(dayLabel('2026-10-02T22:00:00Z', NOW)).toBe('Tomorrow'); // lör 00:00 lokal
    expect(dayLabel('2026-10-02T16:00:00Z', NOW)).toBe('Today');
    expect(dayLabel('2026-10-04T22:01:00Z', NOW)).toBe('Mon');
  });
});

describe('formatCountdown', () => {
  it('grov enhet: dagar+timmar, timmar+minuter, minuter, <1m', () => {
    expect(formatCountdown(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h');
    expect(formatCountdown(6 * 3_600_000 + 14 * 60_000)).toBe('6h 14m');
    expect(formatCountdown(14 * 60_000 + 30_000)).toBe('14m');
    expect(formatCountdown(59_000)).toBe('<1m');
    expect(formatCountdown(0)).toBe('<1m');
  });
});

describe('windowText och dateRangeText', () => {
  it('samma dag: klockslag; hela dygnet: "all day"', () => {
    expect(windowText('2026-10-02T16:00:00Z', '2026-10-02T20:00:00Z')).toBe('18:00–22:00');
    expect(windowText('2026-10-01T22:00:00Z', '2026-10-02T21:59:00Z')).toBe('all day');
  });

  it('flera dagar: veckodag + klockslag i båda ändar', () => {
    expect(windowText('2026-10-04T22:01:00Z', '2026-10-11T21:59:00Z')).toBe('Mon 00:01 – Sun 23:59');
  });

  it('datum: en dag eller ett intervall', () => {
    expect(dateRangeText('2026-09-28T03:00:00Z', '2026-09-28T07:00:00Z')).toBe('28 Sep');
    expect(dateRangeText('2026-09-20T22:01:00Z', '2026-09-27T21:59:00Z')).toBe('21 Sep – 27 Sep');
  });
});

describe('mått', () => {
  it('km med en decimal, höjdmeter som heltal med tusentalsavgränsare, minimidistans utan onödig decimal', () => {
    expect(formatKm(10)).toBe('10.0 km');
    expect(formatMetres(1240.4)).toBe('1,240 m');
    expect(formatMinKm(5)).toBe('5 km');
    expect(formatMinKm(2.5)).toBe('2.5 km');
  });

  it('tävlingsvärdet följer måttet: km, annars höjdmeter', () => {
    expect(formatEventValue('km', 41.25)).toBe('41.3 km');
    expect(formatEventValue('elevation', 540)).toBe('540 m');
    expect(formatEventValue(null, 540)).toBe('540 m');
  });

  it('ordningstal', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
  });
});
