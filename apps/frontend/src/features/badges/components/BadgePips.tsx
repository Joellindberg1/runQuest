import { MAX_TIER } from '@runquest/shared';
import { cn } from '@/lib/utils';
import { isEarnedTier, pipsText, tierKey } from './badgeTier';
import '../badges.css';

export interface BadgePipsProps {
  /** 1..6 = nivån, null (eller allt ogiltigt) = låst: inga fyllda pips. */
  tier: number | null;
  /** Dekorativt: aria-hidden utan etikett, när radens egen text redan säger nivån. */
  decorative?: boolean;
}

const CELLS = Array.from({ length: MAX_TIER }, (_, index) => index + 1);

/** Sex pips = nivåns position (inte framsteg): fyllda till och med aktuell nivå i nivåfärgen, resten tomma. */
export function BadgePips({ tier, decorative = false }: BadgePipsProps) {
  const filled = isEarnedTier(tier) ? tier : 0;
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': pipsText(tier) };

  return (
    <span className="rq-badge-pips" data-tier={tierKey(tier)} {...a11y}>
      {CELLS.map((cell) => (
        <span key={cell} className={cn('rq-badge-pips__pip', cell <= filled && 'rq-badge-pips__pip--on')} aria-hidden="true" />
      ))}
    </span>
  );
}
