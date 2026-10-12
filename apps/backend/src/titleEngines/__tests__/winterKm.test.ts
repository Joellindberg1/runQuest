/**
 * RUN-100 T2/T3 — Winter Warrior-motorn winterKm: summa km för rundor vars kalenderdag ligger i
 * (senaste/innevarande) vinterfönstret.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { winterKmEngine } from '../winterKm.js';
import { titleEngineRegistry } from '../index.js';
import type { RunData, UserStats } from '../types.js';

const stats: UserStats = { totalKm: 0, longestStreak: 0 };
const run = (date: string, distance_km: number): RunData => ({ date, distance_km });
const jan = { now: new Date('2027-01-15T12:00:00Z') }; // fönster 2026-12-01 .. 2027-03-01
const calc = (runs: RunData[], ctx?: { now: Date }) => winterKmEngine.calculate(runs, stats, ctx);

describe('winterKm (RUN-100 T2)', () => {
  it('har metricKey winterKm', () => {
    expect(winterKmEngine.metricKey).toBe('winterKm');
  });

  it('tomt → 0', () => {
    expect(calc([], jan)).toBe(0);
  });

  it('km utanför fönstret räknas inte (före 1 dec, 1 mars och senare)', () => {
    const runs = [
      run('2026-11-30', 100),
      run('2026-12-01', 5),
      run('2027-02-28', 7),
      run('2027-03-01', 100),
      run('2027-07-01', 100),
    ];
    expect(calc(runs, jan)).toBe(12);
  });

  it('utanför vintern räknas senast avslutade vinter (juli 2027 → vintern 2026–27)', () => {
    const runs = [run('2026-12-24', 10), run('2027-02-01', 5), run('2027-06-01', 50), run('2027-12-02', 40)];
    expect(calc(runs, { now: new Date('2027-07-15T12:00:00Z') })).toBe(15);
  });

  it('fönstret byter vid 1 dec: nya vintern börjar på 0 km', () => {
    const runs = [run('2026-01-10', 30), run('2026-02-10', 20), run('2026-11-30', 9)];
    expect(calc(runs, { now: new Date('2026-11-30T12:00:00Z') })).toBe(50);
    expect(calc(runs, { now: new Date('2026-12-01T12:00:00Z') })).toBe(0);
  });

  it('29 feb skottår räknas, 1 mars gör det inte', () => {
    const runs = [run('2028-02-29', 6), run('2028-03-01', 8)];
    expect(calc(runs, { now: new Date('2028-02-29T12:00:00Z') })).toBe(6);
  });

  it('summerar i hela hundradelar (ingen flyttalsdrift)', () => {
    expect(calc([run('2026-12-02', 0.1), run('2026-12-03', 0.2)], jan)).toBe(0.3);
    const many = Array.from({ length: 10 }, (_, i) => run(`2026-12-${String(i + 1).padStart(2, '0')}`, 0.1));
    expect(calc(many, jan)).toBe(1);
    expect(calc([run('2026-12-02', 5.55), run('2026-12-03', 1.1), run('2026-12-04', 2.2)], jan)).toBe(8.85);
  });

  it('saknas ctx används systemklockan (new Date())', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2027-01-15T12:00:00Z'));
      expect(calc([run('2026-12-10', 12.5), run('2026-11-30', 99)])).toBe(12.5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('winterKm i registret (RUN-100 T3)', () => {
  it('är registrerad under metricKey winterKm', () => {
    expect(titleEngineRegistry.get('winterKm')).toBe(winterKmEngine);
    expect(titleEngineRegistry.size).toBeGreaterThanOrEqual(22); // exakt storlek vaktas i regression.test.ts
  });
});
