import { RQIcon } from '@/shared/components/icons';
import type { WorkingOnEntry } from '../changelogTypes';

const ICON_WORKING = 20;

interface WorkingOnCardsProps {
  items: readonly WorkingOnEntry[];
}

/** Fliken Working on: det som är på väg. Guld-kant (prototypen och temafilens `--rq-card-edge-soft`: "Working on") och detaljerna i en hårlinjegrid. */
export function WorkingOnCards({ items }: WorkingOnCardsProps) {
  return (
    <ul className="rq-changelog-working">
      {items.map((item) => (
        <li key={item.title} className="rq-card rq-card--edge rq-changelog-soon">
          <h2 className="rq-changelog-soon__head">
            <span className="rq-changelog-soon__icon"><RQIcon name={item.icon} size={ICON_WORKING} /></span>
            <span className="rq-heading rq-changelog-soon__title">{item.title}</span>
          </h2>
          <p className="rq-changelog-soon__body">{item.body}</p>
          <ul className="rq-hairgrid rq-changelog-soon__details">
            {item.details.map((detail) => (
              <li key={detail} className="rq-changelog-soon__detail">{detail}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
