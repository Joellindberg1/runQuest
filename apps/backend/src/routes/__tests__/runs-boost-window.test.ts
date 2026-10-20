/**
 * Boostens sparade fönster i XP-omräkningen (reprocessRunsFromDate läser user_boosts.start_date/end_date, migration 059).
 *
 * XP-kedja mot fakeDb: femkilometersrundor varannan dag (varje runda är streakdag 1, multiplikator 1.0 → 30 XP; med +0.2 → 35 XP).
 * Förväntade värden för GAMLA boostar (skapade före ändringen, med eller utan backfyllda dagar) är DE FÖRE ÄNDRINGEN: ändras de är det ett fynd,
 * inte ett test att rätta. De hämtades ur koden före 059 (a430bf43) och jämfördes där mot backfyllet i PGlite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../../services/xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { MS_DAY, addDays } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { reprocessRunsFromDate } from '../runs.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const run = (date: string): Row => ({ id: `run-${date}`, user_id: 'user-1', date, distance: 5, streak_day: 1, xp_gained: 0 });
const everyOtherDay = ['2026-10-17', '2026-10-19', '2026-10-21', '2026-10-23', '2026-10-25'];

/** Så sparades expires_at före ändringen, och så ser varje befintlig rad i databasen ut: skapad + n * 24 h. */
const expiresAfter = (created: string, days: number) => new Date(new Date(created).getTime() + days * MS_DAY).toISOString();
/** En gammal dagsboost. `backfilled` lägger på det migration 059 skriver: UTC-dagarna ur created_at och expires_at. */
const oldDaysBoost = (created_at: string, days: number, backfilled: boolean, delta = 0.2): Row => {
  const expires_at = expiresAfter(created_at, days);
  return {
    user_id: 'user-1', type: 'multiplier_days', delta, remaining: null, created_at, expires_at,
    ...(backfilled ? { start_date: created_at.slice(0, 10), end_date: expires_at.slice(0, 10) } : {}),
  };
};
const oldRunsBoost = (created_at: string, charges: number, backfilled: boolean): Row => ({
  user_id: 'user-1', type: 'multiplier_runs', delta: 0.2, remaining: charges, created_at, expires_at: null,
  ...(backfilled ? { start_date: created_at.slice(0, 10), end_date: null } : {}),
});
/** En ny boost, skriven av settleChallenge med det sparade fönstret. */
const newDaysBoost = (start_date: string, days: number, delta = 0.2): Row => ({
  user_id: 'user-1', type: 'multiplier_days', delta, remaining: null, created_at: '2026-10-20T01:00:00.000Z', expires_at: null,
  start_date, end_date: addDays(start_date, days - 1),
});
const newRunsBoost = (start_date: string, charges: number): Row => ({
  user_id: 'user-1', type: 'multiplier_runs', delta: 0.2, remaining: charges, created_at: '2026-10-20T01:00:00.000Z', expires_at: null, start_date, end_date: null,
});

async function reprocess(boosts: Row[], dates = everyOtherDay, extra: Record<string, Row[]> = {}, fromDate = dates[0]) {
  const tables: Record<string, Row[]> = { runs: dates.map(run), user_boosts: boosts, ...extra };
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  await reprocessRunsFromDate('user-1', fromDate);
  return { rows: tables.runs, db };
}

const xpByDate = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.date, r.xp_gained]));

/** Vilka dagar boosten gav XP på: rundornas XP med boosten minus utan den. */
async function boostedDays(boosts: Row[], dates: string[]): Promise<string[]> {
  const without = (await reprocess([], dates)).rows.map((r) => r.xp_gained as number);
  const withBoost = (await reprocess(boosts, dates)).rows;
  return withBoost.filter((r, i) => r.xp_gained !== without[i]).map((r) => r.date as string);
}
const daily = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));

describe('reprocessRunsFromDate — gamla boostar behåller sin XP', () => {
  // Förväntade värden ur koden före 059 (UTC-fönstret): en boost skapad 01:30 svensk tid den 20:e har startdag 19 och slutdag 22.
  it.each([false, true])('a boost created 2026-10-19T23:30Z (00-02 Swedish time) keeps its UTC window 19-22 (backfilled: %s)', async (backfilled) => {
    const { rows } = await reprocess([oldDaysBoost('2026-10-19T23:30:00.000Z', 3, backfilled)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it.each([false, true])('a boost created in the middle of the day gives the XP it gave before (backfilled: %s)', async (backfilled) => {
    const { rows } = await reprocess([oldDaysBoost('2026-10-18T10:00:00.000Z', 3, backfilled)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it.each([false, true])('a loser boost created mid-day lowers the same runs as before (backfilled: %s)', async (backfilled) => {
    const { rows } = await reprocess([oldDaysBoost('2026-10-18T10:00:00.000Z', 3, backfilled, -0.1)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 27, '2026-10-21': 27, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it.each([false, true])('a run boost created mid-day is spent on the same runs as before (backfilled: %s)', async (backfilled) => {
    const { rows } = await reprocess([oldRunsBoost('2026-10-18T10:00:00.000Z', 2, backfilled)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it.each([false, true])('a run boost created 2026-10-19T23:30Z is spent from the UTC day 19, as before (backfilled: %s)', async (backfilled) => {
    const { rows } = await reprocess([oldRunsBoost('2026-10-19T23:30:00.000Z', 2, backfilled)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it('an old boost is not moved by the time zone of its group: its window is stored, not counted', async () => {
    const { setGroupTimeZoneSource } = await import('../../utils/groupTimeZone.js');
    setGroupTimeZoneSource(() => 'America/New_York');
    try {
      const { rows } = await reprocess([oldDaysBoost('2026-10-19T23:30:00.000Z', 3, true)]);
      expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
    } finally {
      setGroupTimeZoneSource();
    }
  });
});

describe('reprocessRunsFromDate — nya boostar ger exakt det som står', () => {
  it('a new 3-day boost gives XP on exactly 3 calendar days, starting on the stored start day', async () => {
    const dates = daily('2026-10-17', 9);
    expect(await boostedDays([newDaysBoost('2026-10-20', 3)], dates)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it.each([1, 2, 5, 7])('a new %i-day boost gives XP on exactly %i days', async (n) => {
    const dates = daily('2026-10-10', 20);
    expect(await boostedDays([newDaysBoost('2026-10-13', n)], dates)).toEqual(daily('2026-10-13', n));
  });

  it('gives XP on exactly 3 days across the spring and the autumn clock change', async () => {
    expect(await boostedDays([newDaysBoost('2026-03-28', 3)], daily('2026-03-25', 9))).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(await boostedDays([newDaysBoost('2026-10-24', 3)], daily('2026-10-21', 9))).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('a new run boost is spent on the first n runs from the stored start day', async () => {
    const dates = daily('2026-10-17', 9);
    expect(await boostedDays([newRunsBoost('2026-10-20', 2)], dates)).toEqual(['2026-10-20', '2026-10-21']);
    // Rundor före startdagen förbrukar ingen laddning.
    expect(await boostedDays([newRunsBoost('2026-10-20', 3)], ['2026-10-18', '2026-10-19', '2026-10-22', '2026-10-24', '2026-10-26'])).toEqual(['2026-10-22', '2026-10-24', '2026-10-26']);
  });

  it('the stored window wins over created_at and expires_at', async () => {
    const boost = { ...newDaysBoost('2026-10-20', 3), created_at: '2026-10-01T10:00:00.000Z', expires_at: '2026-10-04T10:00:00.000Z' };
    expect(await boostedDays([boost], daily('2026-10-17', 9))).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('counts the charges of a run boost spent before the recalculation window, from the stored start day', async () => {
    const dates = daily('2026-10-17', 9);
    // Omräkning från den 20:e: rundan den 19:e förbrukade en av tre laddningar före fönstret, så två återstår.
    const without = (await reprocess([], dates, {}, '2026-10-20')).rows;
    const withBoost = (await reprocess([newRunsBoost('2026-10-19', 3)], dates, {}, '2026-10-20')).rows;
    expect(withBoost.filter((r, i) => r.xp_gained !== without[i].xp_gained).map((r) => r.date)).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('reads the stored window columns from user_boosts', async () => {
    const { db } = await reprocess([]);
    const read = db.queries.find((q) => q.table === 'user_boosts')!;
    expect(read.select).toContain('start_date');
    expect(read.select).toContain('end_date');
  });
});
