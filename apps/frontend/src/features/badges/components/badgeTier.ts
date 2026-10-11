import { MAX_TIER, TIER_NAMES } from '@runquest/shared';

// Nivån som emblemet, pipsen och (senare) chippet delar: vilken data-tier-nyckel CSS:en läser, och när en tier räknas som låst.
// Nivånamnen kommer ur TIER_NAMES (shared) — här görs bara gemener av dem, så en ny nivå i shared syns utan kodändring.

/** data-tier för en serie jag inte har (CSS: dämpad ram, dämpad ikon, ingen glöd). */
export const LOCKED_TIER_KEY = 'locked';

/** Giltig nivå = heltal 1..MAX_TIER. Allt annat (null, 0, 7, bråkdelar, NaN från en annan serverversion) ritas som låst. */
export function isEarnedTier(tier: number | null): tier is number {
  return tier !== null && Number.isInteger(tier) && tier >= 1 && tier <= MAX_TIER;
}

/** "common" … "legendary", eller "locked". Värdet på data-tier. */
export function tierKey(tier: number | null): string {
  return isEarnedTier(tier) ? TIER_NAMES[tier - 1].toLowerCase() : LOCKED_TIER_KEY;
}

/** Textmotsvarigheten till pipsen: "Tier 3 of 6", låst "Locked" (spec §3, Council 14). Samma format som BadgeRow.pipsLabel. */
export function pipsText(tier: number | null): string {
  return isEarnedTier(tier) ? `Tier ${tier} of ${MAX_TIER}` : 'Locked';
}

/** "Rare" … eller null för låst. */
export function tierName(tier: number | null): string | null {
  return isEarnedTier(tier) ? TIER_NAMES[tier - 1] : null;
}
