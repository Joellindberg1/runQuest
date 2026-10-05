import { describe, expect, it } from 'vitest';
import type { Run, User } from '@runquest/types';
import type { XpConfigResponse } from '@runquest/shared';
import { buildLadderRows, buildStreakRow, buildStreakRows, multiplierProgress, nextRunXp, topMultiplier } from './streakModel';

// Fast klocka: 2026-10-04 12:00 Stockholm (CEST) = 10:00 UTC.
const NOW = new Date('2026-10-04T10:00:00Z');

// En trappa som INTE är produktionens: bevisar att allt läses ur configen, inget hårdkodat.
const LADDER = [
  { days: 2, multiplier: 1.5 },
  { days: 4, multiplier: 2 },
  { days: 8, multiplier: 3 },
];

const run = (date: string, extra: Partial<Run> = {}): Run => ({
  id: `r-${date}`, user_id: 'x', date, distance: 5, xp_gained: 100, multiplier: 1, streak_day: 1,
  base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, ...extra,
});

const user = (id: string, streak: number, runs: Run[], best = streak): User => ({
  id, name: id.toUpperCase(), total_xp: 1000, current_level: 1, total_km: 10, current_streak: streak, longest_streak: best, runs,
});

describe('streak-status — samma streakDeadline som Right now-pillen', () => {
  it('SAFE: sprang idag → deadline slutet på morgondagen, text "ran … ago"', () => {
    const row = buildStreakRow(user('ann', 3, [run('2026-10-04', { start_time: '2026-10-04T05:00:00Z' })]), NOW, LADDER);
    expect(row.status).toBe('safe');
    expect(row.days).toBe(3);
    expect(row.detail).toBe('ran 5 h ago');
    // 12:00 Stockholm: 12 h kvar av idag + ett dygn.
    expect(row.msLeft).toBe(36 * 3_600_000);
  });

  it('AT RISK: sprang igår → resten av idag kvar, text "Xh YYm left"', () => {
    const row = buildStreakRow(user('ann', 3, [run('2026-10-03')]), NOW, LADDER);
    expect(row.status).toBe('at-risk');
    expect(row.detail).toBe('12h 00m left');
    expect(row.msLeft).toBe(12 * 3_600_000);
  });

  it('AT RISK vid fast klockslag nära midnatt: 23:30 Stockholm → 30m left', () => {
    const lateEvening = new Date('2026-10-04T21:30:00Z'); // 23:30 CEST
    const row = buildStreakRow(user('ann', 3, [run('2026-10-03')]), lateEvening, LADDER);
    expect(row.status).toBe('at-risk');
    expect(row.detail).toBe('30m left');
  });

  it('dygnsbytet följer Stockholm, inte UTC: 00:30 CEST den 4:e är redan "idag"', () => {
    const justAfterMidnight = new Date('2026-10-03T22:30:00Z'); // 00:30 CEST den 4:e
    const row = buildStreakRow(user('ann', 3, [run('2026-10-03')]), justAfterMidnight, LADDER);
    expect(row.status).toBe('at-risk');
    expect(row.msLeft).toBe(23.5 * 3_600_000);
  });

  it('BROKEN: senaste rundan äldre än igår → 0 dagar och 1.0× även om raden säger 5', () => {
    const row = buildStreakRow(user('ann', 5, [run('2026-10-01')], 9), NOW, LADDER);
    expect(row).toMatchObject({ status: 'broken', days: 0, multiplier: 1, pct: 0, accent: 'none', best: 9, msLeft: null });
    expect(row.detail).toBe('last run 3 d ago');
  });

  it('BROKEN: current_streak 0 trots att rundan var igår, och inga rundor alls', () => {
    expect(buildStreakRow(user('ann', 0, [run('2026-10-03')]), NOW, LADDER).status).toBe('broken');
    const none = buildStreakRow(user('ann', 0, []), NOW, LADDER);
    expect(none.status).toBe('broken');
    expect(none.detail).toBe('no runs yet');
  });
});

describe('multiplikator och trappa läses ur configen', () => {
  it('multiplikatorn kommer ur trappan och pct är andel av vägen mot toppen', () => {
    expect(topMultiplier(LADDER)).toBe(3);
    expect(multiplierProgress(1.5, LADDER)).toBe(25);
    expect(multiplierProgress(3, LADDER)).toBe(100);

    const row = buildStreakRow(user('ann', 5, [run('2026-10-04')]), NOW, LADDER);
    expect(row).toMatchObject({ multiplier: 2, pct: 50, accent: 'silver' });
  });

  it('färgnivåer: guld ≥ 60 %, silver ≥ 30 %, brons över 0, ingen vid 0', () => {
    const at = (streak: number) => buildStreakRow(user('ann', streak, [run('2026-10-04')]), NOW, LADDER).accent;
    expect(at(9)).toBe('gold'); // 3.0× = 100 %
    expect(at(5)).toBe('silver'); // 2.0× = 50 %
    expect(at(2)).toBe('bronze'); // 1.5× = 25 %
    expect(at(1)).toBe('none'); // 1.0×
  });

  it('en tom trappa ger 1.0× och 0 % utan att krascha', () => {
    const row = buildStreakRow(user('ann', 5, [run('2026-10-04')]), NOW, []);
    expect(row).toMatchObject({ multiplier: 1, pct: 0 });
  });

  it('trapprader: etiketter och "and beyond" på sista steget', () => {
    expect(buildLadderRows(LADDER)).toEqual([
      { days: 2, multiplier: 1.5, label: '2 days', accent: 'bronze' },
      { days: 4, multiplier: 2, label: '4 days', accent: 'silver' },
      { days: 8, multiplier: 3, label: '8 days and beyond', accent: 'gold' },
    ]);
  });
});

describe('buildStreakRows', () => {
  it('sorterar på effektiv streak, döljer admin och röd accent bara för mig i riskzonen', () => {
    const rows = buildStreakRows(
      [
        user('bo', 2, [run('2026-10-03')]), // at risk, inte jag
        user('me', 3, [run('2026-10-03')]), // at risk, jag
        user('cy', 7, [run('2026-10-04')]), // safe
        user('dd', 6, [run('2026-09-20')], 20), // bruten trots 6 i raden
        { ...user('admin', 9, [run('2026-10-04')]), name: 'Admin' },
      ],
      NOW,
      LADDER,
      'me',
    );
    expect(rows.map((r) => [r.id, r.days, r.status])).toEqual([
      ['cy', 7, 'safe'], ['me', 3, 'at-risk'], ['bo', 2, 'at-risk'], ['dd', 0, 'broken'],
    ]);
    expect(rows.find((r) => r.id === 'me')?.accent).toBe('down');
    expect(rows.find((r) => r.id === 'bo')?.accent).not.toBe('down');
  });
});

describe('nextRunXp — samma formel som backend (shared), inget hårdkodat', () => {
  const config: XpConfigResponse = {
    settings: { base_xp: 10, xp_per_km: 3, bonus_5km: 0, bonus_10km: 20, bonus_15km: 0, bonus_20km: 0, min_run_distance: 1 },
    streak_multipliers: LADDER,
  };

  it('10 km om streaken lever (dag N+1) mot bruten (dag 1)', () => {
    // bas 10 + 30 = 40 · multiplikator, + 20 distansbonus (multipliceras inte).
    expect(nextRunXp(3, config).keep).toEqual({ xp: Math.floor(40 * 2 + 20), multiplier: 2 }); // dag 4 → 2.0×
    expect(nextRunXp(3, config).broken).toEqual({ xp: 60, multiplier: 1 });
    expect(nextRunXp(1, config).keep).toEqual({ xp: Math.floor(40 * 1.5 + 20), multiplier: 1.5 }); // dag 2 → 1.5×
  });
});
