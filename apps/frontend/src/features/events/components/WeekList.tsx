import { RQIcon } from '@/shared/components/icons';
import type { WeekRow } from '../eventsModel';

const ICON_SIZE = 14;

interface WeekListProps {
  rows: readonly WeekRow[];
  isDesktop: boolean;
}

/** "This week": det som faktiskt är schemalagt efter up next. Mobil = rader, desktop = tre kort bredvid varandra. */
export function WeekList({ rows, isDesktop }: WeekListProps) {
  return (
    <section aria-labelledby="events-week-heading">
      <h2 id="events-week-heading" className="rq-events-label">This week</h2>
      <ul className="rq-events-week" data-layout={isDesktop ? 'card' : 'row'}>
        {rows.map((row) => (
          <li key={row.id} className="rq-events-week__row">
            <span className="rq-events-week__day">
              <RQIcon name={row.kind === 'competition' ? 'trophy' : 'sun'} size={ICON_SIZE} />
              {row.day}
            </span>
            <h3 className="rq-events-week__name">{row.name}</h3>
            <p className="rq-events-week__rule">{row.rule}</p>
            {isDesktop ? (
              <p className="rq-events-week__foot">
                <span>{row.kindLabel}</span>
                {row.reward && <span>{row.reward}</span>}
              </p>
            ) : (
              row.reward && <span className="rq-events-week__reward">{row.reward}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
