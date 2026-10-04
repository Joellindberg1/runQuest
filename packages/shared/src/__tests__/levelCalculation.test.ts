import { describe, it, expect } from 'vitest';
import {
  levelFromXP, xpForLevel, xpForNextLevel, levelProgress,
  FALLBACK_LEVEL_REQUIREMENTS, MAX_LEVEL,
} from '../levelCalculation.js';

describe('levelCalculation', () => {
  it('fallback-tabellen har 30 nivåer med stigande krav', () => {
    expect(FALLBACK_LEVEL_REQUIREMENTS).toHaveLength(MAX_LEVEL);
    for (let i = 1; i < FALLBACK_LEVEL_REQUIREMENTS.length; i++) {
      expect(FALLBACK_LEVEL_REQUIREMENTS[i].xp_required)
        .toBeGreaterThan(FALLBACK_LEVEL_REQUIREMENTS[i - 1].xp_required);
    }
  });

  describe('levelFromXP', () => {
    it('ger nivå 1 vid 0 XP och på gränserna exakt den nya nivån', () => {
      expect(levelFromXP(0)).toBe(1);
      expect(levelFromXP(49)).toBe(1);
      expect(levelFromXP(50)).toBe(2);
      expect(levelFromXP(16071)).toBe(30);
      expect(levelFromXP(999999)).toBe(30);
    });

    it('klampar vid MAX_LEVEL även med större tabell', () => {
      const reqs = [...FALLBACK_LEVEL_REQUIREMENTS, { level: 31, xp_required: 20000 }];
      expect(levelFromXP(25000, reqs)).toBe(MAX_LEVEL);
    });

    it('faller tillbaka på fallback-tabellen vid tom tabell', () => {
      expect(levelFromXP(50, [])).toBe(2);
    });
  });

  describe('xpForLevel / xpForNextLevel', () => {
    it('ger kravet för nivån och nästa, klampat vid max', () => {
      expect(xpForLevel(1)).toBe(0);
      expect(xpForLevel(2)).toBe(50);
      expect(xpForNextLevel(1)).toBe(50);
      expect(xpForNextLevel(MAX_LEVEL)).toBe(16071);
      expect(xpForLevel(99)).toBe(0);
    });
  });

  describe('levelProgress', () => {
    it('ger 0 % vid nivåstart och korrekt andel däremellan', () => {
      const start = levelProgress(50);
      expect(start.currentLevel).toBe(2);
      expect(start.progress).toBe(0);
      expect(start.xpToNext).toBe(52);

      const mid = levelProgress(76); // halvvägs 50→102
      expect(mid.progress).toBeCloseTo(50);
    });

    it('ger 100 % och 0 kvar vid MAX_LEVEL', () => {
      const p = levelProgress(20000);
      expect(p.currentLevel).toBe(MAX_LEVEL);
      expect(p.progress).toBe(100);
      expect(p.xpToNext).toBe(0);
    });
  });
});
