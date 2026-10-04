import { cssVars } from '@/features/leaderboard/cssVars';
import type { RecordView } from '../eventsModel';

interface RecordPanelProps {
  record: RecordView;
  isDesktop: boolean;
}

/**
 * "Your record" — designens "Your season" som all-time (begreppet season finns inte i datamodellen, ägarbeslut 2).
 * Stapeln = klarade av avslutade participation-event; "left on the table" = XP för de jag missade.
 */
export function RecordPanel({ record, isDesktop }: RecordPanelProps) {
  const left = record.left > 0 ? `${record.left} XP left on the table` : 'Nothing left on the table';
  const percent = Math.round(record.fraction * 100);
  return (
    <section className="rq-card rq-events-record" aria-labelledby="events-record-heading">
      <header className="rq-events-record__head">
        <h2 id="events-record-heading" className="rq-title rq-events-record__title">Your record</h2>
        <span className="rq-events-record__count">{`${record.taken} of ${record.total}${isDesktop ? ' all-time' : ''}`}</span>
      </header>
      <div className="rq-track" role="img" aria-label={`${record.taken} of ${record.total} events taken`}>
        <div className="rq-fill" style={cssVars({ '--w': `${percent}%` })} />
      </div>
      <p className="rq-events-record__text">{`${record.earned} XP earned${isDesktop ? ' from events' : ''} · ${left}`}</p>
    </section>
  );
}
