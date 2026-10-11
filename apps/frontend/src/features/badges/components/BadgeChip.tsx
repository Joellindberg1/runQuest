import { isEarnedTier, tierKey, tierName } from './badgeTier';
import '../badges.css';

export interface BadgeChipProps {
  /** 1..6 = nivån, null (eller allt ogiltigt) = låst. */
  tier: number | null;
}

/**
 * Nivå-chippet (spec §3, Council 5, 9): nivåns namn i status-receptet (tint .10 / kant .45 / text i nivåfärg, versaler) — nivån bärs av texten,
 * aldrig av färgen ensam. Låst serie = bara `.rq-chip` med texten "Locked": ingen `--status`, ingen nivåfärg och ingen `data-tier`, så texten
 * är basprimitivens `--rq-text-4` (.50, ≥ 4.5:1 mot kortet; designens .45 klarade inte kravet).
 */
export function BadgeChip({ tier }: BadgeChipProps) {
  if (!isEarnedTier(tier)) return <span className="rq-chip">Locked</span>;
  return <span className="rq-chip rq-chip--status rq-badge-chip" data-tier={tierKey(tier)}>{tierName(tier)}</span>;
}
