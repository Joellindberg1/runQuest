/**
 * Kontraktstest: titelmotorerna läser klockslag ur runs.start_time som lokal väggklocka (getUTC*, falskt Z),
 * oavsett processens tidszon. Inga motorändringar bakom det här — testet vaktar att ingen "fixar" motorerna
 * till att konvertera tidszon och därmed flyttar rundor mellan klockslagsgrupperna.
 * Ligger i __tests__ så att frontendens driftvakt (som skannar titleEngines/*.ts) inte räknar den som en motor.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { RunData, UserStats } from '../types.js';import { earlyRunCountEngine } from '../earlyRunCount.js';
import { nightRunCountEngine } from '../nightRunCount.js';
import { lunchRunCountEngine } from '../lunchRunCount.js';
import { bestDoubleDayKmEngine } from '../bestDoubleDayKm.js';

const stats: UserStats = { totalKm: 0, longestStreak: 0 };
const at = (startTime: string | null, extra: Partial<RunData> = {}): RunData => ({
  date: (startTime ?? '2026-07-04').slice(0, 10), distance_km: 5, start_time: startTime, ...extra,
});

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const zones = ['America/Los_Angeles', 'Europe/Stockholm', 'Asia/Tokyo'];

describe.each(zones)('titelmotorernas klockslag — TZ=%s', (tz) => {
  const setTz = () => { process.env.TZ = tz; };

  it('earlyRunCount: 05:30 väggklocka räknas, 03:59 och 06:00 gör det inte (04:00–06:00)', () => {
    setTz();
    expect(earlyRunCountEngine.calculate([at('2026-07-04T05:30:00Z')], stats)).toBe(1);
    expect(earlyRunCountEngine.calculate([at('2026-01-10T04:00:00+00:00')], stats)).toBe(1);
    expect(earlyRunCountEngine.calculate([at('2026-07-04T03:59:00Z'), at('2026-07-04T06:00:00Z')], stats)).toBe(0);
  });

  it('nightRunCount: 21:30–23:59 räknas, 21:29 och 00:00 gör det inte', () => {
    setTz();
    expect(nightRunCountEngine.calculate([at('2026-07-04T21:30:00Z'), at('2026-07-04T23:59:00Z')], stats)).toBe(2);
    expect(nightRunCountEngine.calculate([at('2026-07-04T21:29:00Z'), at('2026-07-05T00:00:00Z')], stats)).toBe(0);
  });

  it('lunchRunCount: 11:00–12:59 räknas, 10:59 och 13:00 gör det inte', () => {
    setTz();
    expect(lunchRunCountEngine.calculate([at('2026-07-04T11:00:00Z'), at('2026-07-04T12:59:00Z')], stats)).toBe(2);
    expect(lunchRunCountEngine.calculate([at('2026-07-04T10:59:00Z'), at('2026-07-04T13:00:00Z')], stats)).toBe(0);
  });

  it('manuella rundor utan start_time räknas inte av klockslagsmotorerna', () => {
    setTz();
    const manual = [at(null)];
    expect(earlyRunCountEngine.calculate(manual, stats)).toBe(0);
    expect(nightRunCountEngine.calculate(manual, stats)).toBe(0);
    expect(lunchRunCountEngine.calculate(manual, stats)).toBe(0);
  });

  it('bestDoubleDayKm: kvalificerar på ≥ 4 h mellan väggklockslagen, och då räknas bara rundor ≥ 5 km', () => {
    setTz();
    const day = '2026-07-04';
    const qualifying = [
      at(`${day}T06:00:00Z`, { distance_km: 6 }),
      at(`${day}T10:00:00Z`, { distance_km: 7 }),
      at(`${day}T20:00:00Z`, { distance_km: 2 }),
    ];
    expect(bestDoubleDayKmEngine.calculate(qualifying, stats)).toBe(13);

    const tooClose = [
      at(`${day}T06:00:00Z`, { distance_km: 6 }),
      at(`${day}T09:59:00Z`, { distance_km: 7 }),
      at(`${day}T20:00:00Z`, { distance_km: 2 }),
    ];
    // Under 4 h: ingen kvalificerad dag, så inget värde (0).
    expect(bestDoubleDayKmEngine.calculate(tooClose, stats)).toBe(0);
  });

  it('bestDoubleDayKm: mellanrummet mäts på väggklockan även över sommartidsbyte (2026-03-29, 00:30 -> 04:30)', () => {
    setTz();
    const runs = [
      at('2026-03-29T00:30:00Z', { distance_km: 6 }),
      at('2026-03-29T04:30:00Z', { distance_km: 6 }),
      at('2026-03-29T20:00:00Z', { distance_km: 2 }),
    ];
    // 12 = giltig dubbeldag med bara ≥ 5 km-rundorna. Hade gapet mätts i verkliga ögonblick (3 h) hade dagen
    // inte kvalat och värdet blivit 0, så värdet skiljer rätt beteende från fel.
    expect(bestDoubleDayKmEngine.calculate(runs, stats)).toBe(12);
  });
});
