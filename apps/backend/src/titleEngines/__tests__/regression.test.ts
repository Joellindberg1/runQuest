/**
 * RUN-98 T4 — regressionstest för titelmotorerna (första motortestet, ADR 001).
 *
 * De 20 motorernas värden på en fast fixtur är HÅRDKODADE, räknade med mappningen och motorerna som de såg ut
 * INNAN ramverksändringen (väderfält, ctx). Ändras ett värde här har motorernas beteende ändrats — inte bara
 * mappningen. Fixturen körs dessutom genom den gamla mappningen (kopierad nedan) och den nya (toRunData), med
 * och utan run_weather, så att väderfälten bevisligen inte rubbar något.
 *
 * Klockan fryses: maxKmRolling30 läser "förra kalendermånaden" ur systemklockan.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { titleEngineRegistry } from '../index.js';
import { toRunData } from '../_utils.js';
import { EnhancedTitleService } from '../../services/enhancedTitleService.js';
import type { RunData, UserStats } from '../types.js';
import { FIXTURE_ROWS, FIXTURE_STATS, type FixtureRow } from './regressionFixture.js';

// Räknat på ORÖRD kod, inte på den nya: `git archive 57c0f21 apps/backend/src/titleEngines` (före RUN-98) extraherat
// utanför repot, fixturen kopierad dit och körd genom den gamla mappningen (legacyMap nedan) och de gamla motorerna
// med TZ=UTC och systemtid 2026-07-15 (→ förra månaden = juni, 6 × 7 km = 42).
// Fixturen når bestDoubleDayKm:s kvalificerade gren (2026-08-15: 9 + 8,5 km, 12 h emellan → 17,5)
// och lastRunOfWeek:s fallback (söndag 2026-08-16 utan start_time → 2026-08-16T23:00:00Z = 1786921200).
const EXPECTED: Record<string, number> = {
  longestRun: 42.5,
  totalKm: 306.25,
  longestStreak: 7,
  weekendAvg: 24.900000000000002,
  nightRunCount: 2,
  earlyRunCount: 3,
  lunchRunCount: 4,
  maxRunsOneWeek: 8,
  longestRunAfterBreak14: 42.5,
  longestRunAfterBreak30: 15.5,
  maxWeekdayStreak: 8,
  bestDoubleDayKm: 17.5,
  fastestMarathon: 480,
  fastestHalfMarathon: 245,
  lastRunOfWeek: 1786921200,
  maxKmRolling30: 42,
  totalElevationGain: 2823.5,
  bestSingleRunElevation: 520,
  fastest5km: 35,
  avgPaceStdDev: 395.1211132107885,
};

// Den handskrivna mappningen som fanns i enhancedTitleService före RUN-98 (identisk på båda ställena).
const legacyMap = (r: any): RunData => ({
  date: r.date,
  distance_km: parseFloat(r.distance_km) || 0,
  start_time: r.start_time ?? null,
  total_elevation_gain: r.total_elevation_gain ?? null,
  pace_std_dev: r.pace_std_dev ?? null,
  moving_time: r.moving_time ?? null,
});

const stats: UserStats = { ...FIXTURE_STATS };

// Motorer som tillkommit efter RUN-98 har egna tester (t.ex. winterKm.test.ts) och ingår inte i de 20 fasta värdena.
const ADDED_AFTER_RUN98 = ['winterKm', 'stormRunCount', 'coldRunCount'];
const withoutNewer = (values: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(values).filter(([key]) => !ADDED_AFTER_RUN98.includes(key)));

function valuesFrom(runData: RunData[], ctx?: { now: Date }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, engine] of titleEngineRegistry) out[key] = engine.calculate(runData, stats, ctx);
  return withoutNewer(out);
}

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC'; // weekendAvg läser getDay() i lokal tid
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('titelmotorernas regression', () => {
  it('registret har de 20 förväntade motorerna (plus de som tillkommit senare)', () => {
    expect([...titleEngineRegistry.keys()].sort()).toEqual([...Object.keys(EXPECTED), ...ADDED_AFTER_RUN98].sort());
    expect(titleEngineRegistry.size).toBe(23);
  });

  it('de 20 befintliga motorerna ger oförändrade värden på en fast fixtur (gamla mappningen)', () => {
    expect(valuesFrom(FIXTURE_ROWS.map(legacyMap))).toEqual(EXPECTED);
  });

  it('de 20 befintliga motorerna ger oförändrade värden på en fast fixtur (nya toRunData)', () => {
    expect(valuesFrom(FIXTURE_ROWS.map(toRunData))).toEqual(EXPECTED);
  });

  it('… även när varje runda har run_weather (objekt eller array) och motorerna får ctx', () => {
    const withWeather: FixtureRow[] = FIXTURE_ROWS.map((r, i) => ({
      ...r,
      run_weather: i % 2 === 0
        ? { temperature_c: -12.5, wind_speed_ms: '8.0', wind_gusts_ms: 14.1 }
        : [{ temperature_c: 21.3, wind_speed_ms: 2.2, wind_gusts_ms: null }],
    }));
    const ctx = { now: new Date('2026-07-15T12:00:00Z') };
    expect(valuesFrom(withWeather.map(toRunData), ctx)).toEqual(EXPECTED);
  });

  it('toRunData ger samma värden som den gamla mappningen för alla fält som fanns i den ursprungliga mappningen', () => {
    for (const r of FIXTURE_ROWS) {
      const { temperature_c, wind_speed_ms, wind_gusts_ms, is_treadmill, ...legacyFields } = toRunData(r);
      expect(legacyFields).toEqual(legacyMap(r));
      expect([temperature_c, wind_speed_ms, wind_gusts_ms, is_treadmill]).toEqual([null, null, null, null]);
    }
  });

  it('EnhancedTitleService.calculateUserValues (slutpunkten group-eligibility) ger samma värden', () => {
    const values = new EnhancedTitleService().calculateUserValues(FIXTURE_ROWS, stats.totalKm, stats.longestStreak);
    expect(withoutNewer(values)).toEqual(EXPECTED);
  });
});
