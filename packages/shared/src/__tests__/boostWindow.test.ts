import { describe, it, expect } from 'vitest';
import { boostRemaining, boostWindow, legacyBoostWindow, planBoostWindow, type BoostRow } from '../boostCalculation.js';
import { MS_DAY, addDays, daysBetween, zoneMidnightIso } from '../calendar.js';
import { groupTimeZone } from '../groupTimeZone.js';

const NEW_YORK = 'America/New_York';
const stored = (start_date: string, end_date: string | null, type = 'multiplier_days'): BoostRow => ({
  type, created_at: '2026-10-20T03:00:00.000Z', expires_at: null, start_date, end_date,
});
/** Så sparades en gammal rad: created_at och expires_at = skapad + n * 24 h, inga sparade dagar. */
const oldRow = (created: string, n: number, type = 'multiplier_days'): BoostRow => ({
  type, created_at: created, expires_at: type === 'multiplier_days' ? new Date(new Date(created).getTime() + n * MS_DAY).toISOString() : null,
});

describe('boostWindow', () => {
  it('reads the stored window as it is', () => {
    expect(boostWindow(stored('2026-10-20', '2026-10-22'))).toEqual({ startDay: '2026-10-20', endDay: '2026-10-22' });
  });

  it('a stored run boost has a start day and no end day', () => {
    expect(boostWindow(stored('2026-10-20', null, 'multiplier_runs'))).toEqual({ startDay: '2026-10-20', endDay: null });
  });

  it('a row without a stored window keeps the UTC window it had before, which is what migration 059 backfills', () => {
    const created = '2026-10-19T23:30:00.000Z'; // 01:30 svensk tid den 20:e: glappet
    expect(boostWindow(oldRow(created, 3))).toEqual({ startDay: '2026-10-19', endDay: '2026-10-22' });
    expect(legacyBoostWindow(oldRow(created, 3))).toEqual({ startDay: '2026-10-19', endDay: '2026-10-22' });
  });

  it('an old mid-day boost covers the days it covered before, n + 1', () => {
    expect(boostWindow(oldRow('2026-10-14T10:00:00.000Z', 3))).toEqual({ startDay: '2026-10-14', endDay: '2026-10-17' });
  });

  it('an old day boost without expires_at has no end day, and an old run boost has a start day only', () => {
    expect(boostWindow({ type: 'multiplier_days', created_at: '2026-10-14T10:00:00.000Z', expires_at: null }).endDay).toBeNull();
    expect(boostWindow(oldRow('2026-10-14T10:00:00.000Z', 2, 'multiplier_runs'))).toEqual({ startDay: '2026-10-14', endDay: null });
  });

  it('a stored window wins over created_at and expires_at', () => {
    const row: BoostRow = { type: 'multiplier_days', created_at: '2026-10-01T10:00:00.000Z', expires_at: '2026-10-04T10:00:00.000Z', start_date: '2026-10-20', end_date: '2026-10-22' };
    expect(boostWindow(row)).toEqual({ startDay: '2026-10-20', endDay: '2026-10-22' });
  });
});

describe('planBoostWindow', () => {
  const now = new Date('2026-10-20T01:00:00.000Z');

  it('a 3-day boost covers exactly 3 calendar days, starting the day after the last day of the duel', () => {
    const plan = planBoostWindow({ type: 'multiplier_days', days: 3, delta: 0.2, duelEndDay: '2026-10-19', now });
    expect(plan).toEqual({ startDay: '2026-10-20', endDay: '2026-10-22', expiresAt: zoneMidnightIso('2026-10-23') });
    expect(plan.expiresAt).toBe('2026-10-22T22:00:00.000Z'); // 00:00 den 23:e svensk sommartid: slutet av slutdagen
  });

  it('a run boost counts from the same start and has no end', () => {
    expect(planBoostWindow({ type: 'multiplier_runs', days: 3, delta: 0.2, duelEndDay: '2026-10-19', now })).toEqual({ startDay: '2026-10-20', endDay: null, expiresAt: null });
  });

  it('is exactly n calendar days for n from 1 to 14 on every start day of the year, including both clock changes', () => {
    for (let offset = 0; offset < 365; offset++) {
      const duelEndDay = addDays('2026-01-01', offset);
      for (const n of [1, 2, 3, 5, 7, 10, 14]) {
        const { startDay, endDay } = planBoostWindow({ type: 'multiplier_days', days: n, delta: 0.1, duelEndDay, now });
        expect(startDay).toBe(addDays(duelEndDay, 1));
        expect(daysBetween(startDay!, endDay!) + 1).toBe(n);
      }
    }
  });

  it('keeps 3 calendar days across the spring and the autumn change and ends at the local midnight after the end day', () => {
    const spring = planBoostWindow({ type: 'multiplier_days', days: 3, delta: 0.2, duelEndDay: '2026-03-27', now });
    expect(spring).toEqual({ startDay: '2026-03-28', endDay: '2026-03-30', expiresAt: '2026-03-30T22:00:00.000Z' });
    const autumn = planBoostWindow({ type: 'multiplier_days', days: 3, delta: 0.2, duelEndDay: '2026-10-23', now });
    expect(autumn).toEqual({ startDay: '2026-10-24', endDay: '2026-10-26', expiresAt: '2026-10-26T23:00:00.000Z' });
  });

  it('another time zone through the group resolver moves the end of the window and the start day when there is no duel day', () => {
    const newYork = groupTimeZone('g1', () => NEW_YORK);
    const withDuel = planBoostWindow({ type: 'multiplier_days', days: 3, delta: 0.2, duelEndDay: '2026-10-19', now, timeZone: newYork });
    expect(withDuel).toEqual({ startDay: '2026-10-20', endDay: '2026-10-22', expiresAt: '2026-10-23T04:00:00.000Z' });

    const lateEvening = new Date('2026-10-20T02:30:00.000Z'); // 04:30 den 20:e i Stockholm, 22:30 den 19:e i New York
    expect(planBoostWindow({ type: 'multiplier_days', days: 3, delta: 0.2, duelEndDay: null, now: lateEvening }).startDay).toBe('2026-10-20');
    expect(planBoostWindow({ type: 'multiplier_days', days: 3, delta: 0.2, duelEndDay: null, now: lateEvening, timeZone: newYork }).startDay).toBe('2026-10-19');
  });

  it('falls back to the day of now when the duel has no readable end day', () => {
    expect(planBoostWindow({ type: 'multiplier_days', days: 2, delta: 0.2, duelEndDay: 'soon', now }).startDay).toBe('2026-10-20');
  });

  it('gives no window to a boost that is neither a day nor a run boost', () => {
    expect(planBoostWindow({ type: 'xp_flat', days: null, delta: 50, duelEndDay: '2026-10-19', now })).toEqual({ startDay: null, endDay: null, expiresAt: null });
  });

  it('throws on a length that is not a whole number of days of at least 1, so it can be checked before a duel is claimed', () => {
    for (const days of [null, 1.5, 0, -2, Number.NaN]) {
      expect(() => planBoostWindow({ type: 'multiplier_days', days, delta: 0.2, duelEndDay: '2026-10-19', now })).toThrow(RangeError);
      expect(() => planBoostWindow({ type: 'multiplier_runs', days, delta: 0.2, duelEndDay: '2026-10-19', now })).toThrow(RangeError);
    }
  });

  it('gives a boost without effect (delta 0) and without a valid length no window instead of an error', () => {
    expect(planBoostWindow({ type: 'multiplier_days', days: null, delta: 0, duelEndDay: '2026-10-19', now })).toEqual({ startDay: null, endDay: null, expiresAt: null });
  });
});

describe('boostRemaining', () => {
  const row = stored('2026-10-20', '2026-10-22'); // en ny 3-dagarsboost

  it('shows 3 days on its start day and before it', () => {
    expect(boostRemaining(row, new Date('2026-10-18T10:00:00.000Z'))).toBe(3);
    expect(boostRemaining(row, new Date('2026-10-19T21:00:00.000Z'))).toBe(3); // 23:00 den 19:e svensk tid
    expect(boostRemaining(row, new Date('2026-10-20T10:00:00.000Z'))).toBe(3);
  });

  it('counts down one day per local midnight, today included, until the end day', () => {
    expect(boostRemaining(row, new Date('2026-10-21T10:00:00.000Z'))).toBe(2);
    expect(boostRemaining(row, new Date('2026-10-22T21:59:00.000Z'))).toBe(1);
  });

  it('is 0 from the first midnight after the end day, and never negative', () => {
    expect(boostRemaining(row, new Date('2026-10-22T22:00:00.000Z'))).toBe(0);
    expect(boostRemaining(row, new Date('2027-01-01T12:00:00.000Z'))).toBe(0);
  });

  it('turns over at the midnight of the group time zone, not at the UTC one', () => {
    const afterStockholmMidnight = new Date('2026-10-21T22:30:00.000Z');
    expect(boostRemaining(row, afterStockholmMidnight)).toBe(1);
    expect(boostRemaining(row, afterStockholmMidnight, NEW_YORK)).toBe(2);
  });

  it('counts an old boost in the days of its old window', () => {
    const old = oldRow('2026-10-14T10:00:00.000Z', 3);
    expect(boostRemaining(old, new Date('2026-10-14T13:00:00.000Z'))).toBe(4);
    expect(boostRemaining(old, new Date('2026-10-17T20:00:00.000Z'))).toBe(1);
    expect(boostRemaining(old, new Date('2026-10-17T22:00:00.000Z'))).toBe(0);
  });

  it('is null for a run boost and for a day boost without an end, which the client cannot count', () => {
    expect(boostRemaining(stored('2026-10-20', null, 'multiplier_runs'), new Date('2026-10-20T10:00:00.000Z'))).toBeNull();
    expect(boostRemaining({ type: 'multiplier_days', created_at: '2026-10-14T10:00:00.000Z', expires_at: null }, new Date('2026-10-20T10:00:00.000Z'))).toBeNull();
  });
});
