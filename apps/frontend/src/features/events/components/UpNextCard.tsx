import type { UpNextCard as UpNextView } from '../eventsModel';
import { EventChips } from './EventChips';

interface UpNextCardProps {
  card: UpNextView;
  isDesktop: boolean;
}

/** Det första schemalagda eventet: guld-sweep, nedräkning till öppning. Mobil visar fakta på en rad, desktop regeln + chips. */
export function UpNextCard({ card, isDesktop }: UpNextCardProps) {
  const headingId = `event-next-${card.id}`;
  return (
    <article className="rq-card rq-card--edge rq-events-live rq-events-next" data-state="next" data-kind={card.kind} aria-labelledby={headingId}>
      <div className="rq-events-next__main">
        <p className="rq-events-eyebrow">
          <span className="rq-dot rq-dot--live" aria-hidden="true" />
          Up next{isDesktop && ` · ${card.kindLabel}`}
        </p>
        <h2 id={headingId} className="rq-events-next__name">{card.name}</h2>
        <p className="rq-events-next__rule">{isDesktop ? card.rule : card.facts}</p>
        {isDesktop && <EventChips chips={card.chips} showTags />}
      </div>
      <div className="rq-events-next__clock">
        <span className="rq-events-next__time">{card.countdown}</span>
        <span className="rq-events-next__label">until open</span>
      </div>
    </article>
  );
}
