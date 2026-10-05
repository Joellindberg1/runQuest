import { duelsSendPath } from '@/paths';
import { EmptyState } from '@/shared/components/EmptyState';
import type { LiveCard, LiveSide } from '../duelsModel';
import { StakeBlocks } from './StakeBlocks';
import { TierRibbon } from './TierRibbon';

interface SideBoxProps {
  side: LiveSide;
  align: 'start' | 'end';
  onOpenRunner: (userId: string) => void;
}

function SideBox({ side, align, onOpenRunner }: SideBoxProps) {
  return (
    <div className="rq-duels-side" data-tone={side.tone} data-align={align}>
      <button type="button" className="rq-duels-side__name" title={side.name} onClick={() => onOpenRunner(side.userId)}>
        {side.shortName}
      </button>
      <p className="rq-duels-side__score">
        <span className="rq-duels-side__value">{side.value}</span>
        <span className="rq-duels-side__unit">{side.unit}</span>
      </p>
    </div>
  );
}

function LiveDuelCard({ card, onOpenRunner }: { card: LiveCard; onOpenRunner: (userId: string) => void }) {
  const [left, right] = card.sides;
  return (
    <li className="rq-card rq-card--edge rq-duels-live" data-tier={card.tier} data-mine={card.mine}>
      <div className="rq-duels-live__head">
        <span className="rq-duels-live__id">
          <TierRibbon tier={card.tier} />
          <span className="rq-duels-live__metric">{card.metric}</span>
          <span className="rq-duels-live__len">{`· ${card.duration}`}</span>
        </span>
        {card.time && (
          <span className="rq-duels-live__time" data-tone={card.time.tone}>
            {card.time.text}
          </span>
        )}
      </div>
      <div className="rq-duels-live__sides">
        <SideBox side={left} align="start" onOpenRunner={onOpenRunner} />
        <span className="rq-duels-live__vs" aria-hidden="true">VS</span>
        <SideBox side={right} align="end" onOpenRunner={onOpenRunner} />
      </div>
      <StakeBlocks stake={card.stake} winLabel="Win" loseLabel="Lose" ruled />
    </li>
  );
}

interface LiveSectionProps {
  cards: LiveCard[];
  onOpenRunner: (userId: string) => void;
}

/** "Live now": gruppens pågående duellers. Min duell först (mitt värde i guld). */
export function LiveSection({ cards, onOpenRunner }: LiveSectionProps) {
  return (
    <section aria-labelledby="duels-live-heading">
      <h2 id="duels-live-heading" className="rq-label rq-duels__eyebrow">Live now</h2>
      {cards.length === 0 ? (
        <EmptyState
          title="No duels are live"
          text="Spend a token on someone in the pack to start one."
          actionLabel="Send a challenge"
          actionTo={duelsSendPath()}
          headingLevel="h2"
        />
      ) : (
        <ul className="rq-duels-live-list" aria-label="Live duels">
          {cards.map((card) => (
            <LiveDuelCard key={card.id} card={card} onOpenRunner={onOpenRunner} />
          ))}
        </ul>
      )}
    </section>
  );
}
