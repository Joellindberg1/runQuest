/**
 * RUN-99 T4 — grupplösa grenen i calculateUserTotals hämtar run_weather i runs-selecten, så att
 * Stormborn/Iceborn räknas även för användare utan grupp (som gruppvägen i enhancedTitleService).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 1) }));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: vi.fn(async () => null) }));
const processAllUsersTitles = vi.fn(async (..._args: unknown[]) => undefined);
const processUserTitlesAfterRun = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = processAllUsersTitles; processUserTitlesAfterRun = processUserTitlesAfterRun; },
}));

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { toRunData } from '../../titleEngines/_utils.js';
import { stormRunCountEngine } from '../../titleEngines/stormRunCount.js';
import { coldRunCountEngine } from '../../titleEngines/coldRunCount.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], rpc: { update_all_title_leaderboards: () => ({ data: null, error: null }) } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('calculateUserTotals — grupplös gren och väder', () => {
  it('grupplös användare: väderfält når motorerna', async () => {
    const db = use({
      activity_log: [],
      users: [{ id: 'u1', group_id: null, event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0 }],
      runs: [
        { id: 'r1', user_id: 'u1', date: '2026-01-01', distance: 5, xp_gained: 10,
          run_weather: { temperature_c: '-12.5', wind_speed_ms: 4, wind_gusts_ms: '14.2' } },
        { id: 'r2', user_id: 'u1', date: '2026-01-02', distance: 7, xp_gained: 14, run_weather: null },
        { id: 'r3', user_id: 'u1', date: '2026-01-03', distance: 6, xp_gained: 12,
          run_weather: [{ temperature_c: 5, wind_speed_ms: 1, wind_gusts_ms: 3 }] },
      ],
    });

    await calculateUserTotals('u1');

    // selecten ber om väderkolumnerna (fakeDb projicerar inte, så frågan är vad som bevisar det)
    const runsSelect = db.queries.find((q) => q.table === 'runs' && q.filters.some((f) => f.column === 'user_id'));
    expect(runsSelect?.select).toContain('run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)');
    expect(runsSelect?.select).toContain('moving_time'); // befintliga kolumner kvar

    // raderna som skickas till motorerna blir RunData med väder via toRunData
    const [, runs] = processUserTitlesAfterRun.mock.calls[0] as [string, any[]];
    const runData = runs.map(toRunData);
    expect(runData.map((r) => r.temperature_c)).toEqual([-12.5, null, 5]);
    expect(runData.map((r) => r.wind_gusts_ms)).toEqual([14.2, null, 3]);

    const stats = { totalKm: 18, longestStreak: 1 };
    expect(stormRunCountEngine.calculate(runData, stats)).toBe(1);
    expect(coldRunCountEngine.calculate(runData, stats)).toBe(2);
    expect(processAllUsersTitles).not.toHaveBeenCalled();
  });
});
