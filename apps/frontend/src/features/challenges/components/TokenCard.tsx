import type { ReactNode } from 'react';
import type { TokenCard as TokenCardData } from '../duelsModel';
import { TierRibbon } from './TierRibbon';

interface TokenCardProps {
  card: TokenCardData;
  /** Handlingen längst till höger (Your tokens: Send). Utan den är kortet bara en beskrivning. */
  children?: ReactNode;
}

/**
 * Ett tokenkort: nivåns vimpel utan siffra, tokenets mått och längd på första raden ("MOST KM · 7 DAYS", versaler i CSS) och dess egen
 * insats på andra ("+0.15× for 5 days · −0.07× for 5 days", eller "No penalty"). Texten är alltså två rader; insatsraden kommer ur
 * `card.stake` och formateras inte om här. Kortet har nivåns tonade bakgrund och kant (data-tier + --rq-tier-tint/--rq-tier-edge i duels.css).
 * Handlingen skickas in som barn, så att Your tokens (Send) och send-flödets val av token kan dela kortet utan att kortet känner till dem.
 * Identiska tokens är separata kort: kortet bär inget antal.
 */
export function TokenCard({ card, children }: TokenCardProps) {
  return (
    <div className="rq-duels-token" data-tier={card.tier}>
      <TierRibbon tier={card.tier} />
      <div className="rq-duels-token__text">
        <span className="rq-duels-token__what">{card.metricLabel} · {card.durationLabel}</span>
        <span className="rq-duels-token__stake"><span>{card.stake.winFor}</span> · <span>{card.stake.loseFor}</span></span>
      </div>
      {children}
    </div>
  );
}
