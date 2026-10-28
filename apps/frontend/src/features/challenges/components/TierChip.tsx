import type { ChallengeTier } from '@runquest/shared';
// Chipradens träffyta (44 px på mobil) och inåtriktade fokusring ligger i .rq-segmented > .rq-filter; raden som håller chipsen är en .rq-segmented.
import '@/shared/components/view-controls.css';

interface TierChipProps {
  tier: ChallengeTier;
  /** "Minor" — chipet lägger själv till "×3". */
  label: string;
  /** Antalet osända tokens av nivån. 0 = tom nivå. */
  count: number;
  selected: boolean;
  onPress: () => void;
}

/**
 * Nivåchipet "MINOR ×3": ett filterval med nivåns accent när det är valt (Your tokens, och send-flödets första steg). Det är en egen
 * komponent i stället för ett SegmentedControl-alternativ eftersom det bär nivåns färg och kan vara tomt: en tom nivå är `aria-disabled`
 * men inte `disabled` (den ska gå att fokusera och förklara sig; föräldern visar "No Major tokens right now" när den aktiveras) och
 * räknas aldrig som vald. Insatsen står inte på chipet utan på korten. Chipet ska ligga direkt i en `.rq-segmented`-rad.
 */
export function TierChip({ tier, label, count, selected, onPress }: TierChipProps) {
  const empty = count === 0;
  return (
    <button
      type="button"
      className="rq-filter rq-duels-chip"
      data-tier={tier}
      aria-pressed={selected && !empty}
      aria-disabled={empty ? true : undefined}
      onClick={onPress}
    >
      {label} ×{count}
    </button>
  );
}
