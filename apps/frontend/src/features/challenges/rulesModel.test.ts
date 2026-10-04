import { describe, expect, it } from 'vitest';
import { DEFAULT_STAKES, HOW_IT_WORKS, buildTierRules, observedStakes, sampleFromHistory } from './rulesModel';
import { STAKES, historyItem } from './duels.fixture';

describe('observedStakes', () => {
  it('utan exempel gäller seed-värdena i challenge_rewards (0.15 / 0.25 / 0.5 med straff)', () => {
    const stakes = observedStakes([]);
    expect(stakes.minor.win).toBe('+0.15× / 5 d');
    expect(stakes.minor.lose).toBe('−0.07× / 5 d');
    expect(stakes.major.win).toBe('+0.25× / 10 d');
    expect(stakes.legendary.win).toBe('+0.5× / 14 d');
    expect(stakes.legendary.lose).toBe('−0.25× / 14 d');
  });

  it('verkliga exempel går före seed-värdena, per nivå', () => {
    const stakes = observedStakes([{ tier: 'major', ...STAKES.major, winner_delta: 0.3, winner_duration: 7 }]);
    expect(stakes.major.win).toBe('+0.3× / 7 d');
    expect(stakes.minor.win).toBe(observedStakes([]).minor.win);
  });

  it('en historikrad blir ett exempel (boost-objekten mappas till insatsfälten)', () => {
    const sample = sampleFromHistory(historyItem({
      id: 'h1', tier: 'legendary',
      winner_boost: { type: 'multiplier_days', delta: 0.5, duration: 14 }, loser_boost: { type: 'multiplier_days', delta: 0, duration: 14 },
    }));
    expect(sample).toMatchObject({ tier: 'legendary', winner_delta: 0.5, loser_delta: 0 });
    expect(observedStakes([sample]).legendary.lose).toBe('No penalty');
  });

  it('seed-värdena är exakt migration 006', () => {
    expect(DEFAULT_STAKES.minor).toMatchObject({ winner_delta: 0.15, winner_duration: 5, loser_delta: -0.07 });
    expect(DEFAULT_STAKES.major).toMatchObject({ winner_delta: 0.25, winner_duration: 10, loser_delta: -0.12 });
    expect(DEFAULT_STAKES.legendary).toMatchObject({ winner_delta: 0.5, winner_duration: 14, loser_delta: -0.25 });
  });
});

describe('regeltexter', () => {
  it('ett kort per nivå i ordning, med insatsen', () => {
    const rules = buildTierRules(observedStakes([]));
    expect(rules.map((rule) => rule.label)).toEqual(['Minor', 'Major', 'Legendary']);
    expect(rules[2].stake.lose).toBe('−0.25× / 14 d');
  });

  it('legendary-texten säger att den inte kan avböjas (backend: 400) och startar efter fyra dagar (scheduler)', () => {
    const legendary = buildTierRules(observedStakes([]))[2].body;
    expect(legendary).toMatch(/can't be declined/);
    expect(legendary).toMatch(/four days/);
  });

  it('påstår inget om en boost-gräns som koden inte har', () => {
    expect(HOW_IT_WORKS.map((item) => item.body).join(' ')).not.toMatch(/cap|3\.5|0\.75/i);
    expect(HOW_IT_WORKS.length).toBeGreaterThanOrEqual(4);
  });
});
