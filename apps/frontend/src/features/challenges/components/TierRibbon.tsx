import type { ChallengeTier } from '@runquest/types';

interface TierRibbonProps {
  tier: ChallengeTier;
  /** Antalet i skölden (tokens av nivån). Utan antal ritas en tom sköld. */
  count?: number;
}

/**
 * Nivåns sköld (minor blå · major orange · legendary guld) — samma form och recept som challenge-skölden på Board
 * (path ur designens `ribbon()`), men med egen stil i duels.css så att Duels inte beror på Boards stilfil.
 * Dekorativ: nivån står alltid även som text bredvid.
 */
export function TierRibbon({ tier, count }: TierRibbonProps) {
  return (
    <svg className="rq-duels-ribbon" data-tier={tier} viewBox="0 0 26 32" aria-hidden="true">
      <path d="M1.5 1.5 H24.5 V21 L13 30.5 L1.5 21 Z" />
      {count !== undefined && (
        <text x="13" y="17" textAnchor="middle">
          {count}
        </text>
      )}
    </svg>
  );
}
