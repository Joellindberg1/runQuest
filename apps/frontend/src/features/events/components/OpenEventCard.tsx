import { cssVars } from '@/features/leaderboard/cssVars';
import type { OpenCard } from '../eventsModel';
import { CompetitionBoard } from './CompetitionBoard';
import { CountdownRing } from './CountdownRing';
import { EventChips } from './EventChips';

interface OpenEventCardProps {
  card: OpenCard;
  isDesktop: boolean;
}

function stateOf(card: OpenCard): 'settling' | 'done' | 'open' {
  if (card.settling) return 'settling';
  return card.mineDone ? 'done' : 'open';
}

/**
 * Ett pågående event. Participation: ring + regel + chips + "4 of 6 done" (XP kommer direkt när en runda klarar
 * minimidistansen). Competition: samma kort med tävlingstabellen under (avräknas söndag natt).
 * Mobil = App Prototypens kort (ring till vänster); desktop = Web Prototypens (ring till höger).
 */
export function OpenEventCard({ card, isDesktop }: OpenEventCardProps) {
  const state = stateOf(card);
  const headingId = `event-${card.id}`;
  const done = card.doneText && <p className="rq-events-live__done">{card.doneText}</p>;

  return (
    <article className="rq-card rq-card--edge rq-events-live" data-state={state} data-kind={card.kind} aria-labelledby={headingId}>
      <div className="rq-events-live__body">
        <div className="rq-events-live__main">
          <p className="rq-events-eyebrow">
            {!card.settling && <span className="rq-dot rq-dot--live" aria-hidden="true" />}
            {card.settling ? 'Settling' : 'Open now'}
            {isDesktop && ` · ${card.kindLabel}`}
          </p>
          <h2 id={headingId} className="rq-events-live__name">{card.name}</h2>
          <p className="rq-events-live__rule">{card.rule}</p>
          <div className="rq-events-live__inline">
            <EventChips chips={card.chips} showTags={isDesktop} />
            {!isDesktop && done}
          </div>
        </div>
        <div className="rq-events-live__ringcol">
          <CountdownRing time={card.countdown} label={card.ringLabel} fraction={card.ringFraction} settling={card.settling} />
          {isDesktop && done}
        </div>
      </div>
      {isDesktop && card.doneFraction !== null && (
        <div className="rq-track rq-events-live__pack" role="img" aria-label={card.doneText ?? undefined}>
          <div className="rq-fill" style={cssVars({ '--w': `${Math.round(card.doneFraction * 100)}%` })} />
        </div>
      )}
      {card.board && <CompetitionBoard rows={card.board} note={card.boardNote} />}
    </article>
  );
}
