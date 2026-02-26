import { describe, it, expect } from 'vitest';
import {
  calculateRunXP,
  calculateStreakMultiplier,
  calculateCompleteRunXP,
  type AdminSettings,
  type StreakMultiplier,
} from '../xpCalculation.js';

// Default settings som matchar prod-konfigurationen
const DEFAULT_SETTINGS: AdminSettings = {
  base_xp: 15,
  xp_per_km: 2,
  bonus_5km: 5,
  bonus_10km: 15,
  bonus_15km: 25,
  bonus_20km: 50,
  min_run_distance: 1.0,
};

const DEFAULT_MULTIPLIERS: StreakMultiplier[] = [
  { days: 5, multiplier: 1.1 },
  { days: 15, multiplier: 1.2 },
  { days: 30, multiplier: 1.3 },
  { days: 60, multiplier: 1.4 },
  { days: 90, multiplier: 1.5 },
];

// ─────────────────────────────────────────────
// calculateRunXP
// ─────────────────────────────────────────────

describe('calculateRunXP', () => {
  describe('base XP', () => {
    it('ger base XP för en run som möter minimumdistansen', () => {
      const result = calculateRunXP(3, DEFAULT_SETTINGS);
      expect(result.baseXP).toBe(15);
    });

    it('ger 0 base XP för en run under minimumdistansen', () => {
      const result = calculateRunXP(0.5, DEFAULT_SETTINGS);
      expect(result.baseXP).toBe(0);
    });

    it('ger 0 XP totalt för ogiltig distans (0)', () => {
      const result = calculateRunXP(0, DEFAULT_SETTINGS);
      expect(result.totalXP).toBe(0);
    });

    it('ger 0 XP totalt för negativ distans', () => {
      const result = calculateRunXP(-5, DEFAULT_SETTINGS);
      expect(result.totalXP).toBe(0);
    });
  });

  describe('km XP', () => {
    it('beräknar rätt XP per kilometer', () => {
      const result = calculateRunXP(5, DEFAULT_SETTINGS);
      // 5 km × 2 XP/km = 10
      expect(result.kmXP).toBe(10);
    });

    it('rundar ner kmXP till heltal', () => {
      const result = calculateRunXP(3.7, DEFAULT_SETTINGS);
      // 3.7 × 2 = 7.4 → floor → 7
      expect(result.kmXP).toBe(7);
    });
  });

  describe('distance bonuses', () => {
    it('ger 5km-bonus vid exakt 5km', () => {
      const result = calculateRunXP(5, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(5);
    });

    it('ger 10km-bonus vid exakt 10km', () => {
      const result = calculateRunXP(10, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(15);
    });

    it('ger 15km-bonus vid exakt 15km', () => {
      const result = calculateRunXP(15, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(25);
    });

    it('ger 20km-bonus vid exakt 20km', () => {
      const result = calculateRunXP(20, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(50);
    });

    it('ger 20km-bonus vid distanser över 20km', () => {
      const result = calculateRunXP(25, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(50);
    });

    it('ger ingen bonus under 5km', () => {
      const result = calculateRunXP(3, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(0);
    });

    it('ger 10km-bonus (inte 15km) vid 12km', () => {
      const result = calculateRunXP(12, DEFAULT_SETTINGS);
      expect(result.distanceBonus).toBe(15);
    });
  });

  describe('total XP', () => {
    it('beräknar korrekt total för en 5km-run', () => {
      const result = calculateRunXP(5, DEFAULT_SETTINGS);
      // base: 15, km: 10, bonus: 5 → total: 30
      expect(result.totalXP).toBe(30);
    });

    it('beräknar korrekt total för en 10km-run', () => {
      const result = calculateRunXP(10, DEFAULT_SETTINGS);
      // base: 15, km: 20, bonus: 15 → total: 50
      expect(result.totalXP).toBe(50);
    });

    it('beräknar korrekt total för en 21km halvmaraton', () => {
      const result = calculateRunXP(21, DEFAULT_SETTINGS);
      // base: 15, km: floor(42) = 42, bonus: 50 → total: 107
      expect(result.totalXP).toBe(107);
    });
  });

  describe('anpassade settings', () => {
    it('respekterar anpassad base_xp', () => {
      const result = calculateRunXP(5, { ...DEFAULT_SETTINGS, base_xp: 20 });
      expect(result.baseXP).toBe(20);
    });

    it('respekterar anpassad min_run_distance', () => {
      const result = calculateRunXP(0.5, { ...DEFAULT_SETTINGS, min_run_distance: 0.3 });
      expect(result.baseXP).toBe(15);
    });

    it('använder fallback-värden om settings saknas delvis', () => {
      const partialSettings = {} as AdminSettings;
      const result = calculateRunXP(5, partialSettings);
      // Ska inte krascha, ska använda defaults
      expect(result.totalXP).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────
// calculateStreakMultiplier
// ─────────────────────────────────────────────

describe('calculateStreakMultiplier', () => {
  it('returnerar 1.0x för streak dag 0', () => {
    expect(calculateStreakMultiplier(0, DEFAULT_MULTIPLIERS)).toBe(1.0);
  });

  it('returnerar 1.0x för negativ streak', () => {
    expect(calculateStreakMultiplier(-1, DEFAULT_MULTIPLIERS)).toBe(1.0);
  });

  it('returnerar 1.0x om inga multipliers finns', () => {
    expect(calculateStreakMultiplier(10, [])).toBe(1.0);
  });

  it('returnerar 1.0x för dag 1–4 (under första tröskeln)', () => {
    expect(calculateStreakMultiplier(4, DEFAULT_MULTIPLIERS)).toBe(1.0);
  });

  it('returnerar 1.1x vid exakt dag 5', () => {
    expect(calculateStreakMultiplier(5, DEFAULT_MULTIPLIERS)).toBe(1.1);
  });

  it('returnerar 1.1x för dag 6–14 (mellan trösklarna)', () => {
    expect(calculateStreakMultiplier(10, DEFAULT_MULTIPLIERS)).toBe(1.1);
  });

  it('returnerar 1.2x vid exakt dag 15', () => {
    expect(calculateStreakMultiplier(15, DEFAULT_MULTIPLIERS)).toBe(1.2);
  });

  it('returnerar 1.5x för dag 90+', () => {
    expect(calculateStreakMultiplier(90, DEFAULT_MULTIPLIERS)).toBe(1.5);
  });

  it('returnerar 1.5x för dag långt över 90', () => {
    expect(calculateStreakMultiplier(200, DEFAULT_MULTIPLIERS)).toBe(1.5);
  });

  it('hanterar null-liknande multipliers-lista', () => {
    expect(calculateStreakMultiplier(10, null as unknown as StreakMultiplier[])).toBe(1.0);
  });
});

// ─────────────────────────────────────────────
// calculateCompleteRunXP
// ─────────────────────────────────────────────

describe('calculateCompleteRunXP', () => {
  it('ingen streak ger samma XP som calculateRunXP', () => {
    const completeResult = calculateCompleteRunXP(5, 0, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    const baseResult = calculateRunXP(5, DEFAULT_SETTINGS);
    expect(completeResult.finalXP).toBe(baseResult.totalXP);
  });

  it('streak dag 5 ger 1.1x multiplikator på base+km', () => {
    const result = calculateCompleteRunXP(5, 5, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    // base: 15, km: 10 → (15+10) * 1.1 = 27.5 → floor = 27, + bonus 5 = 32
    expect(result.multiplier).toBe(1.1);
    expect(result.finalXP).toBe(32);
  });

  it('distance-bonusen påverkas INTE av streak-multiplikatorn', () => {
    const noStreak = calculateCompleteRunXP(10, 0, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    const withStreak = calculateCompleteRunXP(10, 5, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    // Distance bonus ska vara samma
    expect(noStreak.distanceBonus).toBe(withStreak.distanceBonus);
  });

  it('streak dag 30 ger 1.3x multiplikator', () => {
    const result = calculateCompleteRunXP(5, 30, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    expect(result.multiplier).toBe(1.3);
  });

  it('returnerar korrekt breakdown-objekt', () => {
    const result = calculateCompleteRunXP(5, 0, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    expect(result.breakdown).toHaveProperty('base');
    expect(result.breakdown).toHaveProperty('km');
    expect(result.breakdown).toHaveProperty('distance');
    expect(result.breakdown).toHaveProperty('streak');
    expect(result.breakdown).toHaveProperty('total');
  });

  it('finalXP är alltid ett heltal', () => {
    const result = calculateCompleteRunXP(7.3, 5, DEFAULT_SETTINGS, DEFAULT_MULTIPLIERS);
    expect(Number.isInteger(result.finalXP)).toBe(true);
  });
});
