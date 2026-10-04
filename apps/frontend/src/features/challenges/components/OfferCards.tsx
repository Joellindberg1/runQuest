import type { IncomingCard, SentCard } from '../duelsModel';
import { StakeBlocks } from './StakeBlocks';
import { TierRibbon } from './TierRibbon';

interface IncomingOfferProps {
  card: IncomingCard;
  /** Den enda fyllda guldknappen på vyn: första inkommande utmaningen. */
  primary: boolean;
  /** Pågående svar på just den här (knapparna låses). */
  busy: boolean;
  /** Jag är redan i ett live-duell — då väntar Accept. */
  acceptBlocked: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onOpenRunner: (userId: string) => void;
}

/** "Waiting on you": en utmaning någon skickat mig. Orange vänsterkant (duell), Accept (guld) och Decline (ghost). */
export function IncomingOffer({ card, primary, busy, acceptBlocked, onAccept, onDecline, onOpenRunner }: IncomingOfferProps) {
  return (
    <li className="rq-card rq-card--edge rq-duels-offer" data-kind="incoming" data-tier={card.tier}>
      <div className="rq-duels-offer__id">
        <TierRibbon tier={card.tier} />
        <div>
          <p className="rq-duels-offer__eyebrow">Waiting on you</p>
          <h3 className="rq-duels-offer__title">
            <button type="button" className="rq-duels-namebtn" onClick={() => onOpenRunner(card.fromId)}>
              {card.fromShort}
            </button>
            {' · '}
            {card.what}
          </h3>
          <p className="rq-duels-offer__tier">{card.tierLabel}</p>
        </div>
      </div>
      <StakeBlocks stake={card.stake} winLabel="If you win" loseLabel="If you lose" />
      <div className="rq-duels-offer__side">
        <div className="rq-duels-offer__actions">
          <button
            type="button"
            className={`rq-btn ${primary ? 'rq-btn--primary' : 'rq-btn--secondary'}`}
            disabled={busy || acceptBlocked}
            aria-label={`Accept challenge from ${card.fromShort}`}
            onClick={onAccept}
          >
            Accept
          </button>
          {card.canDecline && (
            <button type="button" className="rq-btn rq-btn--ghost" disabled={busy} aria-label={`Decline challenge from ${card.fromShort}`} onClick={onDecline}>
              Decline
            </button>
          )}
        </div>
        {acceptBlocked && <p className="rq-duels-offer__note">Finish your live duel before you accept another.</p>}
        {card.note && <p className="rq-duels-offer__note">{`${card.note} — it cannot be declined.`}</p>}
      </div>
    </li>
  );
}

interface SentOfferProps {
  card: SentCard;
  busy: boolean;
  onWithdraw: () => void;
  onOpenRunner: (userId: string) => void;
}

/** Min skickade utmaning som väntar på svar (finns inte i prototypen; samma kort, tier-färgad kant och Withdraw). */
export function SentOffer({ card, busy, onWithdraw, onOpenRunner }: SentOfferProps) {
  return (
    <li className="rq-card rq-card--edge rq-duels-offer" data-kind="sent" data-tier={card.tier}>
      <div className="rq-duels-offer__id">
        <TierRibbon tier={card.tier} />
        <div>
          <p className="rq-duels-offer__eyebrow">Sent</p>
          <h3 className="rq-duels-offer__title">
            <button type="button" className="rq-duels-namebtn" onClick={() => onOpenRunner(card.toId)}>
              {card.toShort}
            </button>
            {' · '}
            {card.what}
          </h3>
          <p className="rq-duels-offer__tier">{card.tierLabel}</p>
        </div>
      </div>
      <StakeBlocks stake={card.stake} winLabel="If you win" loseLabel="If you lose" />
      <div className="rq-duels-offer__side">
        <p className="rq-duels-offer__note">{card.note}</p>
        {card.canWithdraw ? (
          <button type="button" className="rq-btn rq-btn--ghost" disabled={busy} onClick={onWithdraw}>
            Withdraw
          </button>
        ) : (
          <p className="rq-duels-offer__note">A legendary challenge cannot be withdrawn.</p>
        )}
      </div>
    </li>
  );
}
