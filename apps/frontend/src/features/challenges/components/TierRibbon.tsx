import type { ChallengeTier } from '@runquest/types';
import { PENNANT_PATH, PENNANT_TEXT_X, PENNANT_TEXT_Y, PENNANT_VIEW_BOX } from '@/shared/components/challengeMark';

interface TierRibbonProps {
  tier: ChallengeTier;
  /** Antalet i vimpeln (tokens av nivån). Utan antal ritas en tom vimpel. */
  count?: number;
}

/**
 * Nivåns vimpel (minor blå · major orange · legendary guld) — samma form och recept som challenge-vimpeln på Board
 * (geometrin delas via shared/components/challengeMark), men med egen stil i duels.css så att Duels inte beror på Boards stilfil.
 * Dekorativ: nivån står alltid även som text bredvid.
 */
export function TierRibbon({ tier, count }: TierRibbonProps) {
  return (
    <svg className="rq-duels-ribbon" data-tier={tier} viewBox={PENNANT_VIEW_BOX} aria-hidden="true">
      <path d={PENNANT_PATH} />
      {count !== undefined && (
        <text x={PENNANT_TEXT_X} y={PENNANT_TEXT_Y} textAnchor="middle">
          {count}
        </text>
      )}
    </svg>
  );
}
