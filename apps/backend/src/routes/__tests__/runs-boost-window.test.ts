/**
 * Boostfönstret i XP-omräkningen räknas i gruppens dygn (boostWindow i shared), inte i UTC-dygn.
 *
 * XP-kedja mot fakeDb: femkilometersrundor varannan dag (varje runda är streakdag 1, multiplikator 1.0 → 30 XP; med +0.2 → 35 XP).
 * Förväntade värden för boostar skapade mitt på dagen är DE FÖRE ÄNDRINGEN: ändras de är det ett fynd, inte ett test att rätta.
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

import { MS_DAY } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { reprocessRunsFromDate } from '../runs.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  setGroupTimeZoneSource();
});

const run = (date: string): Row => ({ id: `run-${date}`, user_id: 'user-1', date, distance: 5, streak_day: 1, xp_gained: 0 });
const everyOtherDay = ['2026-10-17', '2026-10-19', '2026-10-21', '2026-10-23', '2026-10-25'];

/** Så sparades expires_at före ändringen, och så ser varje befintlig rad i databasen ut: skapad + n * 24 h. */
const expiresAfter = (created: string, days: number) => new Date(new Date(created).getTime() + days * MS_DAY).toISOString();
const daysBoost = (created_at: string, days: number, over: Row = {}): Row => ({
  user_id: 'user-1', type: 'multiplier_days', delta: 0.2, remaining: null, created_at, expires_at: expiresAfter(created_at, days), ...over,
});
const runsBoost = (created_at: string, charges: number, over: Row = {}): Row => ({
  user_id: 'user-1', type: 'multiplier_runs', delta: 0.2, remaining: charges, created_at, expires_at: null, ...over,
});

async function reprocess(boosts: Row[], extra: Record<string, Row[]> = {}, dates = everyOtherDay): Promise<Row[]> {
  const tables: Record<string, Row[]> = { runs: dates.map(run), user_boosts: boosts, ...extra };
  vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables, { autoIds: true }).client as any);
  await reprocessRunsFromDate('user-1', dates[0]);
  return tables.runs;
}

const xpByDate = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.date, r.xp_gained]));

describe('reprocessRunsFromDate — boostfönstret i gruppens dygn', () => {
  it('a boost created 2026-10-19T23:30Z starts on 2026-10-20 in the XP calculation', async () => {
    // 01:30 svensk tid den 20:e. Före ändringen räknades den 19:e (UTC-dygnet) som startdag och rundan den 19:e fick boosten.
    const rows = await reprocess([daysBoost('2026-10-19T23:30:00.000Z', 3)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 30, '2026-10-21': 35, '2026-10-23': 35, '2026-10-25': 30 });
  });

  it('a boost created in the middle of the day gives the XP it gave before the change', async () => {
    // 12:00 svensk tid den 18:e, 3 dagar: fönstret 18-21 (n + 1 dagar), alltså rundorna den 19:e och 21:a.
    const rows = await reprocess([daysBoost('2026-10-18T10:00:00.000Z', 3)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it('a loser boost created mid-day lowers the same runs as before', async () => {
    const rows = await reprocess([daysBoost('2026-10-18T10:00:00.000Z', 3, { delta: -0.1 })]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 27, '2026-10-21': 27, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it('a run boost created mid-day is spent on the same runs as before', async () => {
    const rows = await reprocess([runsBoost('2026-10-18T10:00:00.000Z', 2)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it('a run boost created 2026-10-19T23:30Z is first spent on the run of 2026-10-20 or later', async () => {
    const rows = await reprocess([runsBoost('2026-10-19T23:30:00.000Z', 2)]);
    expect(xpByDate(rows)).toEqual({ '2026-10-17': 30, '2026-10-19': 30, '2026-10-21': 35, '2026-10-23': 35, '2026-10-25': 30 });
  });

  it('the group of the duel decides the time zone: another zone through the resolver moves the start day', async () => {
    // 04:30 svensk tid den 20:e men 22:30 den 19:e i New York.
    const boost = daysBoost('2026-10-20T02:30:00.000Z', 3, { challenges: { group_id: 'ny-group' } });

    const stockholm = await reprocess([boost]);
    expect(xpByDate(stockholm)).toEqual({ '2026-10-17': 30, '2026-10-19': 30, '2026-10-21': 35, '2026-10-23': 35, '2026-10-25': 30 });

    setGroupTimeZoneSource((groupId) => (groupId === 'ny-group' ? 'America/New_York' : undefined));
    const newYork = await reprocess([boost]);
    expect(xpByDate(newYork)).toEqual({ '2026-10-17': 30, '2026-10-19': 35, '2026-10-21': 35, '2026-10-23': 30, '2026-10-25': 30 });
  });

  it('the duel group wins over the active membership', async () => {
    setGroupTimeZoneSource((groupId) => (groupId === 'ny-group' ? 'America/New_York' : undefined));
    const boost = daysBoost('2026-10-20T02:30:00.000Z', 3, { challenges: { group_id: 'ny-group' } });
    const rows = await reprocess([boost], { group_members: [{ user_id: 'user-1', group_id: 'other-group', role: 'member', left_at: null }] });
    expect(xpByDate(rows)['2026-10-19']).toBe(35);
  });

  it('falls back to the active membership when the boost has no duel group', async () => {
    setGroupTimeZoneSource((groupId) => (groupId === 'ny-group' ? 'America/New_York' : undefined));
    const boost = daysBoost('2026-10-20T02:30:00.000Z', 3);
    const rows = await reprocess([boost], { group_members: [{ user_id: 'user-1', group_id: 'ny-group', role: 'member', left_at: null }] });
    expect(xpByDate(rows)['2026-10-19']).toBe(35);
  });

  it('counts in the default zone when there is neither a duel group nor a membership', async () => {
    setGroupTimeZoneSource(() => 'America/New_York');
    const rows = await reprocess([daysBoost('2026-10-20T02:30:00.000Z', 3)]);
    expect(xpByDate(rows)['2026-10-19']).toBe(30);
  });

  it('does not read the membership when every boost has a duel group', async () => {
    const db = createFakeDb({ runs: everyOtherDay.map(run), user_boosts: [daysBoost('2026-10-18T10:00:00.000Z', 3, { challenges: { group_id: 'g1' } })] }, { autoIds: true });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await reprocessRunsFromDate('user-1', everyOtherDay[0]);
    expect(db.queries.some((q) => q.table === 'group_members')).toBe(false);
  });
});
