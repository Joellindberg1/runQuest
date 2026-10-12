/**
 * RUN-216 T2 — karaktärisering av multiplikatortrappan i reprocessRunsFromDate (streak_day per runda).
 *
 * Skrivna FÖRE flytten till shared och gröna både före och efter: de låser prod-beteendet (seed från rundan före
 * fromDate, glapp >1 dag nollställer, samma dag behåller dagen, multiplikator/XP följer streak_day).
 * Ingen XP-regel ändras av RUN-216 — värdena här är dagens.
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

const run = (id: string, date: string, over: Row = {}): Row => ({
  id, user_id: 'user-1', date, distance: 5, streak_day: 1, xp_gained: 0, ...over,
});

/** Kör omräkningen mot en fake-db och returnerar rundorna efteråt (muteras på plats av update). */
async function reprocess(runs: Row[], fromDate: string): Promise<Row[]> {
  const tables: Record<string, Row[]> = { runs, user_boosts: [] };
  const db = createFakeDb(tables, { autoIds: true });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  await reprocessRunsFromDate('user-1', fromDate);
  return tables.runs;
}

const streakDays = (rows: Row[]) => rows.map((r) => r.streak_day);

describe('reprocessRunsFromDate — streak_day-trappan (karaktärisering)', () => {
  it('startar på 1, räknar upp per dag i rad, nollställer efter glapp och behåller dagen för flera rundor samma dag', async () => {
    const rows = await reprocess([
      run('a', '2026-10-01'), run('b', '2026-10-02'), run('c', '2026-10-03'),
      run('d', '2026-10-05'), run('e', '2026-10-06'), run('f', '2026-10-06'),
      run('g', '2026-10-20'),
    ], '2026-10-01');
    expect(streakDays(rows)).toEqual([1, 2, 3, 1, 2, 2, 1]);
  });

  it('seedas från streak_day på rundan närmast före fromDate när den är dagen innan', async () => {
    const rows = await reprocess([
      run('prev', '2026-09-30', { streak_day: 6 }),
      run('a', '2026-10-01'), run('b', '2026-10-02'), run('c', '2026-10-04'),
    ], '2026-10-01');
    expect(streakDays(rows)).toEqual([6, 7, 8, 1]);
  });

  it('seedas inte när rundan före fromDate ligger mer än en dag bort', async () => {
    const rows = await reprocess([
      run('prev', '2026-09-28', { streak_day: 4 }),
      run('a', '2026-10-01'), run('b', '2026-10-02'),
    ], '2026-10-01');
    expect(streakDays(rows)).toEqual([4, 1, 2]);
  });

  it('ett glapp på exakt två dagar bryter (dag-diff 2), en dag emellan räknas inte som i rad', async () => {
    const rows = await reprocess([run('a', '2026-10-01'), run('b', '2026-10-03'), run('c', '2026-10-04')], '2026-10-01');
    expect(streakDays(rows)).toEqual([1, 1, 2]);
  });

  it('går över månads- och årsskifte', async () => {
    const rows = await reprocess([
      run('a', '2026-12-30'), run('b', '2026-12-31'), run('c', '2027-01-01'), run('d', '2027-01-02'),
    ], '2026-12-30');
    expect(streakDays(rows)).toEqual([1, 2, 3, 4]);
  });

  it('går över sommartidsskiftet (2026-10-25) utan att tappa en dag', async () => {
    const rows = await reprocess([
      run('a', '2026-10-24'), run('b', '2026-10-25'), run('c', '2026-10-26'),
    ], '2026-10-24');
    expect(streakDays(rows)).toEqual([1, 2, 3]);
  });

  it('en ensam runda utan föregående börjar på 1 oavsett det lagrade värdet', async () => {
    const rows = await reprocess([run('a', '2026-10-01', { streak_day: 9 })], '2026-10-01');
    expect(streakDays(rows)).toEqual([1]);
  });

  it('multiplikator och XP följer trappan (1.0 → 1.1 från dag 5 → 1.2 från dag 15)', async () => {
    const dates = Array.from({ length: 16 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const rows = await reprocess(dates.map((d, i) => run(`r${i}`, d)), '2026-09-01');

    expect(streakDays(rows)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(rows.map((r) => r.multiplier)).toEqual([
      1, 1, 1, 1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.2, 1.2,
    ]);
    // 5 km: base 15 + 2/km = 25, distansbonus 5 → floor(25 * mult + 5)
    expect(rows.map((r) => r.xp_gained)).toEqual([
      30, 30, 30, 30, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 35, 35,
    ]);
  });
});
