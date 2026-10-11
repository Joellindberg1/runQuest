import { describe, expect, it } from 'vitest';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import { buildCollection } from '../badgeModel';
import { isEarnedTier, pipsText, tierKey, tierName } from './badgeTier';

// En enda källa för nivåtexterna: emblemet, pipsen och modellen (BadgeRow.pipsLabel) delar badgeTier.

describe('badgeTier: giltiga nivåer och texter för tier 0–6', () => {
  it.each([
    [null, 'Locked', 'locked', null],
    [0, 'Locked', 'locked', null],
    [1, 'Tier 1 of 6', 'common', 'Common'],
    [2, 'Tier 2 of 6', 'uncommon', 'Uncommon'],
    [3, 'Tier 3 of 6', 'rare', 'Rare'],
    [4, 'Tier 4 of 6', 'heroic', 'Heroic'],
    [5, 'Tier 5 of 6', 'epic', 'Epic'],
    [6, 'Tier 6 of 6', 'legendary', 'Legendary'],
  ])('tier %s: pips "%s", data-tier "%s", namn %s', (tier, pips, key, name) => {
    expect(pipsText(tier)).toBe(pips);
    expect(tierKey(tier)).toBe(key);
    expect(tierName(tier)).toBe(name);
  });

  it('allt utanför heltalen 1..6 räknas som låst (även värden av okänd typ från en annan serverversion)', () => {
    for (const value of [7, -1, 2.5, Number.NaN, Infinity, '3', undefined, {}]) {
      expect({ value, earned: isEarnedTier(value) }).toEqual({ value, earned: false });
    }
    for (let tier = 1; tier <= MAX_TIER; tier += 1) expect(isEarnedTier(tier)).toBe(true);
    expect(MAX_TIER).toBe(TIER_NAMES.length);
  });

  it('modellens pipsLabel är exakt pipsText: låst "Locked", intjänat "Tier N of 6" för varje nivå', () => {
    const viewer = { viewerId: 'me', ownerId: 'me' };
    const locked = buildCollection(undefined, undefined, viewer);
    for (const row of locked) expect(row.pipsLabel).toBe(pipsText(null));
    for (let tier = 1; tier <= MAX_TIER; tier += 1) {
      const rows = buildCollection({ items: [{ series: BADGE_SERIES[0].key, tier, seen_tier: tier }], showcase: [] } as never, undefined, viewer);
      expect(rows[0].pipsLabel).toBe(pipsText(tier));
    }
  });
});
