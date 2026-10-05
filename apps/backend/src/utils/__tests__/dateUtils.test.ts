import { describe, it, expect, afterEach, vi } from 'vitest';
import { mondayOf, weekRange, isIsoCalendarDate, todayStockholm } from '../dateUtils.js';

afterEach(() => { vi.useRealTimers(); });

describe('mondayOf', () => {
  it('ger måndagen för veckans alla dagar (söndag hör till veckan som slutar)', () => {
    expect(mondayOf('2026-09-28')).toBe('2026-09-28'); // mån
    expect(mondayOf('2026-09-30')).toBe('2026-09-28'); // ons
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // sön
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // nästa mån
  });

  it('hanterar årsskifte och skottår', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // tors
    expect(mondayOf('2024-03-01')).toBe('2024-02-26'); // fre i skottår
  });

  it('hanterar veckorna med sommartidsskifte (29 mars och 25 oktober 2026)', () => {
    expect(mondayOf('2026-03-29')).toBe('2026-03-23');
    expect(mondayOf('2026-03-30')).toBe('2026-03-30');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
  });
});

describe('weekRange', () => {
  it('ger start (mån), end (sön) och previous_start för datumets vecka', () => {
    expect(weekRange('2026-10-01')).toEqual({ start: '2026-09-28', end: '2026-10-04', previous_start: '2026-09-21' });
  });

  it('ger 7 dagar även över sommartidsskifte', () => {
    expect(weekRange('2026-03-25')).toEqual({ start: '2026-03-23', end: '2026-03-29', previous_start: '2026-03-16' });
    expect(weekRange('2026-10-22')).toEqual({ start: '2026-10-19', end: '2026-10-25', previous_start: '2026-10-12' });
  });

  it('ger rätt vecka över årsskifte', () => {
    expect(weekRange('2026-01-02')).toEqual({ start: '2025-12-29', end: '2026-01-04', previous_start: '2025-12-22' });
  });
});

describe('veckogräns i Stockholm-tid (todayStockholm → weekRange)', () => {
  function weekStartAt(iso: string): string {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    return weekRange(todayStockholm()).start;
  }

  it('vinter: söndag 23:30 Stockholm (22:30 UTC) är fortfarande föregående vecka', () => {
    expect(weekStartAt('2026-01-04T22:30:00Z')).toBe('2025-12-29');
  });

  it('vinter: söndag 23:30 UTC är redan måndag 00:30 Stockholm = ny vecka', () => {
    expect(weekStartAt('2026-01-04T23:30:00Z')).toBe('2026-01-05');
  });

  it('sommar: söndag 23:30 Stockholm (21:30 UTC) är fortfarande föregående vecka', () => {
    expect(weekStartAt('2026-07-05T21:30:00Z')).toBe('2026-06-29');
  });

  it('sommar: söndag 22:30 UTC är måndag 00:30 Stockholm = ny vecka', () => {
    expect(weekStartAt('2026-07-05T22:30:00Z')).toBe('2026-07-06');
  });
});

describe('isIsoCalendarDate', () => {
  it('accepterar riktiga YYYY-MM-DD', () => {
    expect(isIsoCalendarDate('2026-09-28')).toBe(true);
    expect(isIsoCalendarDate('2024-02-29')).toBe(true);
  });

  it('avvisar fel format och omöjliga datum', () => {
    expect(isIsoCalendarDate('2026-9-28')).toBe(false);
    expect(isIsoCalendarDate('2026-02-30')).toBe(false);
    expect(isIsoCalendarDate('2025-02-29')).toBe(false);
    expect(isIsoCalendarDate('2026-13-01')).toBe(false);
    expect(isIsoCalendarDate('not-a-date')).toBe(false);
    expect(isIsoCalendarDate('')).toBe(false);
  });
});
