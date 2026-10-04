import { Link } from 'react-router-dom';
import { RQIcon } from '@/shared/components/icons';
import type { RightNowItem } from './rightNowItems';

const ICON_PILL = 15;
const ICON_ROW = 15;

function toneClass(item: RightNowItem): string {
  return `rq-chip--${item.tone}`;
}

/** Mobil: en horisontellt scrollbar rad under headern. Inga data → ingen rad. */
export function RightNowPills({ items }: { items: RightNowItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="rq-pills" aria-label="Right now">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={item.to}
            className={`rq-chip rq-chip--status rq-pill ${toneClass(item)}`}
            {...(item.tourAnchor ? { 'data-tour': item.tourAnchor } : {})}
          >
            <RQIcon name={item.icon} size={ICON_PILL} />
            <span>{item.label}</span>
            <span className="rq-pill__value">{item.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Desktop: panelen i sidnavens botten (ikon, etikett + notering, värde). */
export function RightNowPanel({ items }: { items: RightNowItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rq-rightnow" aria-label="Right now">
      <div className="rq-rightnow__head">
        <span>Right now</span>
        <span className="rq-rightnow__count">{items.length} active</span>
      </div>
      <ul className="rq-rightnow__list rq-hairgrid">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to}
              className={`rq-rightnow__row ${toneClass(item)}`}
              {...(item.tourAnchor ? { 'data-tour': item.tourAnchor } : {})}
            >
              <span className="rq-rightnow__icon">
                <RQIcon name={item.icon} size={ICON_ROW} />
              </span>
              <span>
                <span className="rq-rightnow__label">{item.label}</span>
                <span className="rq-rightnow__note">{item.note}</span>
              </span>
              <span className="rq-rightnow__value">{item.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
