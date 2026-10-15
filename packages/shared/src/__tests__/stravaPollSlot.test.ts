import { describe, expect, it } from 'vitest';
import { STRAVA_POLL_INTERVAL_HOURS, nextStravaPollSlot } from '../index.js';

// The poll cron fires at wall-clock 00:00 and 12:00 in Europe/Stockholm. The next slot is a clock time, never "now plus the interval".
// Stockholm is UTC+2 in summer (CEST) and UTC+1 in winter (CET).

const next = (iso: string, hours?: number): string => nextStravaPollSlot(new Date(iso), hours).toISOString();

describe('the next strava poll slot', () => {
  it('the interval the slots follow is the shared constant', () => {
    expect(STRAVA_POLL_INTERVAL_HOURS).toBe(12);
  });

  it('a moment exactly on a slot gives the slot one interval later, not the same slot', () => {
    expect(next('2026-10-14T10:00:00.000Z')).toBe('2026-10-14T22:00:00.000Z'); // 12:00 CEST -> 00:00 CEST
    expect(next('2026-10-14T22:00:00.000Z')).toBe('2026-10-15T10:00:00.000Z'); // 00:00 CEST -> 12:00 CEST
  });

  it('a moment between slots gives the next clock slot, not now plus the interval', () => {
    // 14:37 CEST: now + 12 h would be 02:37, the cron fires at 00:00.
    expect(next('2026-10-14T12:37:00.000Z')).toBe('2026-10-14T22:00:00.000Z');
    // 03:10 CEST: the next slot is 12:00 the same day.
    expect(next('2026-10-14T01:10:00.000Z')).toBe('2026-10-14T10:00:00.000Z');
  });

  it('one millisecond before a slot gives that slot, and one millisecond after gives the one after', () => {
    expect(next('2026-10-14T09:59:59.999Z')).toBe('2026-10-14T10:00:00.000Z');
    expect(next('2026-10-14T10:00:00.001Z')).toBe('2026-10-14T22:00:00.000Z');
  });

  it('the day boundary is Stockholm midnight, not UTC midnight', () => {
    // 23:30 UTC on the 14th is 01:30 CEST on the 15th: the next slot is 12:00 CEST (10:00 UTC), not 00:00 UTC.
    expect(next('2026-10-14T23:30:00.000Z')).toBe('2026-10-15T10:00:00.000Z');
  });

  it('winter time: slots are 11:00 and 23:00 UTC', () => {
    expect(next('2026-01-15T05:00:00.000Z')).toBe('2026-01-15T11:00:00.000Z');
    expect(next('2026-01-15T11:00:00.000Z')).toBe('2026-01-15T23:00:00.000Z');
  });

  describe('daylight saving nights keep the wall-clock time', () => {
    it('2026-10-25, clocks go back: the night is 13 hours between 00:00 and 12:00', () => {
      expect(next('2026-10-24T22:00:00.000Z')).toBe('2026-10-25T11:00:00.000Z'); // 00:00 CEST -> 12:00 CET (+13 h)
      expect(next('2026-10-25T00:30:00.000Z')).toBe('2026-10-25T11:00:00.000Z'); // 02:30 CEST, first time
      expect(next('2026-10-25T01:30:00.000Z')).toBe('2026-10-25T11:00:00.000Z'); // 02:30 CET, second time
      expect(next('2026-10-25T11:00:00.000Z')).toBe('2026-10-25T23:00:00.000Z'); // 12:00 CET -> 00:00 CET
    });

    it('2026-03-29, clocks go forward: the night is 11 hours between 00:00 and 12:00', () => {
      expect(next('2026-03-28T23:00:00.000Z')).toBe('2026-03-29T10:00:00.000Z'); // 00:00 CET -> 12:00 CEST (+11 h)
      expect(next('2026-03-29T00:30:00.000Z')).toBe('2026-03-29T10:00:00.000Z'); // 01:30 CET
      expect(next('2026-03-29T01:30:00.000Z')).toBe('2026-03-29T10:00:00.000Z'); // 03:30 CEST
      expect(next('2026-03-29T10:00:00.000Z')).toBe('2026-03-29T22:00:00.000Z'); // 12:00 CEST -> 00:00 CEST
    });
  });

  it('another interval that divides 24 follows its own slots', () => {
    expect(next('2026-10-14T10:00:00.000Z', 6)).toBe('2026-10-14T16:00:00.000Z'); // 12:00 CEST -> 18:00 CEST
    expect(next('2026-10-14T16:00:00.000Z', 6)).toBe('2026-10-14T22:00:00.000Z'); // 18:00 CEST -> 00:00 CEST
  });

  it('an interval that does not divide 24, or is shorter than three hours, is rejected', () => {
    expect(() => nextStravaPollSlot(new Date('2026-10-14T10:00:00.000Z'), 5)).toThrow(RangeError);
    expect(() => nextStravaPollSlot(new Date('2026-10-14T10:00:00.000Z'), 2)).toThrow(RangeError);
  });
});
