import { describe, it, expect } from 'vitest';
import { BADGE_SERIES, MAX_TIER, countHolders, resolveShowcase } from '../badges.js';

describe('countHolders (ADR 009 beslut 4/7: antal i gruppen med tier >= t)', () => {
  it('tier 3 räknas i 1, 2 och 3 men inte i 4–6 ("tier eller högre")', () => {
    const holders = countHolders([{ series: 'milestoner', tier: 3 }]);
    expect(holders.milestoner).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0, 5: 0, 6: 0 });
  });

  it('summerar flera medlemmar per serie och tier', () => {
    const holders = countHolders([
      { series: 'milestoner', tier: 1 },
      { series: 'milestoner', tier: 3 },
      { series: 'milestoner', tier: 6 },
      { series: 'early_bird', tier: 2 },
    ]);
    expect(holders.milestoner).toEqual({ 1: 3, 2: 2, 3: 2, 4: 1, 5: 1, 6: 1 });
    expect(holders.early_bird).toEqual({ 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
  });

  it('ger ett fullständigt rutnät: alla kända serier x tier 1..MAX_TIER, nollor inkluderade', () => {
    const holders = countHolders([]);
    expect(Object.keys(holders).sort()).toEqual(BADGE_SERIES.map((s) => s.key).sort());
    for (const series of BADGE_SERIES) {
      expect(Object.keys(holders[series.key]).map(Number)).toEqual(
        Array.from({ length: MAX_TIER }, (_, i) => i + 1)
      );
      expect(Object.values(holders[series.key]).every((n) => n === 0)).toBe(true);
    }
  });

  it('ignorerar okända serier och tier utanför 1..MAX_TIER (ogiltiga rader)', () => {
    const holders = countHolders([
      { series: 'finns_inte', tier: 3 },
      { series: 'milestoner', tier: 0 },
      { series: 'milestoner', tier: -1 },
      { series: 'milestoner', tier: 1.5 },
      { series: 'milestoner', tier: 99 },
    ]);
    expect(holders).not.toHaveProperty('finns_inte');
    expect(holders.milestoner).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  });

  it('en tier över MAX_TIER klampas inte in (ignoreras hellre än att räknas som Legendary)', () => {
    expect(countHolders([{ series: 'milestoner', tier: MAX_TIER + 1 }]).milestoner[MAX_TIER]).toBe(0);
  });
});

describe('resolveShowcase (visade serier skurna mot ägda)', () => {
  const owned = new Map<string, number>([
    ['milestoner', 4],
    ['early_bird', 1],
  ]);

  it('behåller sparad ordning och slår upp tier', () => {
    expect(resolveShowcase(['early_bird', 'milestoner'], owned)).toEqual([
      { series: 'early_bird', tier: 1 },
      { series: 'milestoner', tier: 4 },
    ]);
  });

  it('släpper serier användaren inte (längre) äger', () => {
    expect(resolveShowcase(['night_owl', 'milestoner'], owned)).toEqual([{ series: 'milestoner', tier: 4 }]);
  });

  it('släpper okända serier, dubbletter och tier 0', () => {
    const withZero = new Map(owned).set('speedster', 0);
    expect(resolveShowcase(['bogus', 'milestoner', 'milestoner', 'speedster'], withZero)).toEqual([
      { series: 'milestoner', tier: 4 },
    ]);
  });

  it('visar högst 3 även om arrayen skulle vara längre', () => {
    const many = new Map<string, number>([
      ['milestoner', 1], ['early_bird', 1], ['night_owl', 1], ['speedster', 1],
    ]);
    expect(resolveShowcase(['milestoner', 'early_bird', 'night_owl', 'speedster'], many)).toHaveLength(3);
  });

  it('null/tom array ger tom lista', () => {
    expect(resolveShowcase(null, owned)).toEqual([]);
    expect(resolveShowcase([], owned)).toEqual([]);
  });
});
