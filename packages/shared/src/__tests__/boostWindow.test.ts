import { describe, it, expect } from 'vitest';
import { boostExpiresAt, boostRemaining, boostWindow, type BoostRow } from '../boostCalculation.js';
import { MS_DAY, STOCKHOLM_TZ, addDays, zoneClock } from '../calendar.js';
import { groupTimeZone } from '../groupTimeZone.js';

const NEW_YORK = 'America/New_York';
const daysBoost = (created_at: string, expires_at: string | null): BoostRow => ({ type: 'multiplier_days', created_at, expires_at });
const runsBoost = (created_at: string): BoostRow => ({ type: 'multiplier_runs', created_at, expires_at: null });
/** Så sparades expires_at före Stockholmsdygnen: skapad + n * 24 h. Befintliga rader i databasen har det värdet. */
const legacyExpires = (created: string, n: number): string => new Date(new Date(created).getTime() + n * MS_DAY).toISOString();
/** Så räknade runs.ts fönstret före Stockholmsdygnen: UTC-datumet ur tidsstämplarna. */
const legacyWindow = (created: string, expires: string | null) => ({ startDay: created.slice(0, 10), endDay: expires ? expires.slice(0, 10) : null });

describe('boostWindow', () => {
  it('a boost created 2026-10-19T23:30Z starts on 2026-10-20 in Stockholm', () => {
    const created = '2026-10-19T23:30:00.000Z';
    expect(boostWindow(daysBoost(created, legacyExpires(created, 3))).startDay).toBe('2026-10-20');
  });

  it('the window covers n + 1 calendar days, both ends included, as it did before', () => {
    const created = '2026-10-14T10:00:00.000Z';
    expect(boostWindow(daysBoost(created, legacyExpires(created, 3)))).toEqual({ startDay: '2026-10-14', endDay: '2026-10-17' });
  });

  it('a run boost has a start day and no end day', () => {
    expect(boostWindow(runsBoost('2026-10-19T23:30:00.000Z'))).toEqual({ startDay: '2026-10-20', endDay: null });
  });

  it('a day boost without expires_at has no end day', () => {
    expect(boostWindow(daysBoost('2026-10-14T10:00:00.000Z', null)).endDay).toBeNull();
  });

  it('another time zone through the group resolver moves the start day', () => {
    const created = '2026-10-20T02:30:00.000Z';
    const row = daysBoost(created, legacyExpires(created, 3));
    const stockholm = groupTimeZone('group-1');
    const newYork = groupTimeZone('group-1', () => NEW_YORK);

    expect(boostWindow(row, stockholm)).toEqual({ startDay: '2026-10-20', endDay: '2026-10-23' });
    expect(boostWindow(row, newYork)).toEqual({ startDay: '2026-10-19', endDay: '2026-10-22' });
  });

  it('is independent of the process time zone and defaults to Stockholm', () => {
    const created = '2026-12-09T23:30:00.000Z';
    const row = daysBoost(created, legacyExpires(created, 3));
    expect(boostWindow(row)).toEqual(boostWindow(row, STOCKHOLM_TZ));
    expect(boostWindow(row).startDay).toBe('2026-12-10');
  });
});

describe('old and new windows outside the gap', () => {
  // Hela året i halvtimmessteg, 1-7 dagar, inklusive båda sommartidsskiftena. "Utanför glappet" = skapad 02:00-22:00 svensk tid: då
  // ligger varken starten eller slutet (skapad + n * 24 h, även över ett skifte) på en annan dag i Stockholm än i UTC.
  const stepMs = 30 * 60_000;
  const yearStart = Date.UTC(2026, 0, 1);
  const yearEnd = Date.UTC(2027, 0, 1);

  it('are equal for every boost created 02:00-22:00 Stockholm time, so no existing boost changes', () => {
    const different: string[] = [];
    let checked = 0;
    for (let at = yearStart; at < yearEnd; at += stepMs) {
      const created = new Date(at);
      const hour = zoneClock(created).msIntoDay / 3_600_000;
      if (hour < 2 || hour >= 22) continue;
      for (let n = 1; n <= 7; n++) {
        const createdIso = created.toISOString();
        const expires = legacyExpires(createdIso, n);
        checked++;
        const now = boostWindow(daysBoost(createdIso, expires));
        const before = legacyWindow(createdIso, expires);
        if (now.startDay !== before.startDay || now.endDay !== before.endDay) different.push(`${createdIso} n=${n}`);
      }
    }
    expect(checked).toBeGreaterThan(50_000);
    expect(different).toEqual([]);
  });

  it('differ for a boost created 00:00-02:00 Stockholm time, which is the gap', () => {
    const created = '2026-10-19T23:30:00.000Z';
    const expires = legacyExpires(created, 3);
    expect(legacyWindow(created, expires)).toEqual({ startDay: '2026-10-19', endDay: '2026-10-22' });
    expect(boostWindow(daysBoost(created, expires))).toEqual({ startDay: '2026-10-20', endDay: '2026-10-23' });
  });
});

describe('boostRemaining', () => {
  const created = '2026-10-14T10:00:00.000Z';
  const row = daysBoost(created, legacyExpires(created, 3));

  it('counts the calendar days left, today included, to and including the end day', () => {
    expect(boostRemaining(row, new Date('2026-10-14T13:00:00.000Z'))).toBe(4);
    expect(boostRemaining(row, new Date('2026-10-16T08:00:00.000Z'))).toBe(2);
    expect(boostRemaining(row, new Date('2026-10-17T21:59:00.000Z'))).toBe(1);
  });

  it('is 0 from the first midnight after the end day, and never negative', () => {
    expect(boostRemaining(row, new Date('2026-10-17T22:00:00.000Z'))).toBe(0);
    expect(boostRemaining(row, new Date('2027-01-01T12:00:00.000Z'))).toBe(0);
  });

  it('turns over at the group midnight, not at the UTC one', () => {
    const afterStockholmMidnight = new Date('2026-10-16T22:30:00.000Z');
    expect(boostRemaining(row, afterStockholmMidnight)).toBe(1);
    expect(boostRemaining(row, afterStockholmMidnight, NEW_YORK)).toBe(2);
  });

  it('is null for a run boost and for a day boost without an end, which the client cannot count', () => {
    expect(boostRemaining(runsBoost(created), new Date('2026-10-15T10:00:00.000Z'))).toBeNull();
    expect(boostRemaining(daysBoost(created, null), new Date('2026-10-15T10:00:00.000Z'))).toBeNull();
  });
});

describe('boostExpiresAt', () => {
  it('lands on the same wall clock n calendar days later, so the window is n + 1 days', () => {
    const created = new Date('2026-10-14T10:00:00.000Z');
    const expires = boostExpiresAt(created, 3);
    expect(expires).toBe('2026-10-17T10:00:00.000Z');
    expect(boostWindow(daysBoost(created.toISOString(), expires))).toEqual({ startDay: '2026-10-14', endDay: addDays('2026-10-14', 3) });
  });

  it('keeps the window at n + 1 days across the spring change, where created + 72 h would reach a fifth day', () => {
    const created = new Date('2026-03-27T22:30:00.000Z');
    expect(boostWindow(daysBoost(created.toISOString(), legacyExpires(created.toISOString(), 3))).endDay).toBe('2026-03-31');
    const expires = boostExpiresAt(created, 3);
    expect(boostWindow(daysBoost(created.toISOString(), expires))).toEqual({ startDay: '2026-03-27', endDay: '2026-03-30' });
  });

  it('keeps the window at n + 1 days across the autumn change', () => {
    const created = new Date('2026-10-23T22:30:00.000Z');
    const window = boostWindow(daysBoost(created.toISOString(), boostExpiresAt(created, 5)));
    expect(window).toEqual({ startDay: '2026-10-24', endDay: '2026-10-29' });
  });

  it('follows the group time zone', () => {
    const created = new Date('2026-10-20T02:30:00.000Z');
    const expires = boostExpiresAt(created, 3, NEW_YORK);
    expect(boostWindow(daysBoost(created.toISOString(), expires), NEW_YORK)).toEqual({ startDay: '2026-10-19', endDay: '2026-10-22' });
  });

  it('throws on a length that is not a whole number of days, instead of storing a wrong end', () => {
    expect(() => boostExpiresAt(new Date('2026-10-14T10:00:00.000Z'), 1.5)).toThrow(RangeError);
    expect(() => boostExpiresAt(new Date('2026-10-14T10:00:00.000Z'), -1)).toThrow(RangeError);
  });
});
