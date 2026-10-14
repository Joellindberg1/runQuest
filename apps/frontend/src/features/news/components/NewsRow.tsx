import { BadgeEmblem } from '@/features/badges/components/BadgeEmblem';
import { RQIcon } from '@/shared/components/icons';
import { useRowReadGestures } from '../hooks/useRowReadGestures';
import type { NewsRowModel } from '../newsModel';

/** Ikonstorleken i flödesraden (designen 18 → närmaste ur ikonstegen 15/17/21). */
const ICON_ROW = 17;

/**
 * En rad i flödet: ikon · typ · tid · text, 3 px kant i kategorins färg. Raden är ett `li` (listan behåller sin struktur) med EN knapp som
 * täcker hela raden: knappen ger tabbstoppet och aktiveringen (Enter/Space/tap) och dess namn är radens egen text, så ingen `tabIndex` påtvingas
 * och ingen interaktiv ruta ligger inuti en annan (raden har inga länkar; får den en får den delas, se ADR 011 addendum, antagande c).
 * Oläst = guldtint bakom raden + guldprick vid tiden + fetare typrad + en skärmläsartext — färgen ensam bär inget. Pricken ligger i en
 * reserverad plats så att tiden inte hoppar när raden blir läst. Tiden är ett `<time>` med exakt klockslag i `title`.
 * Gesterna (hover efter rörelse, tap, Enter/Space) kommer ur `useRowReadGestures` och gäller om en lista (`ReadGestureScope`) omger raden.
 */
export function NewsRow({ row }: { row: NewsRowModel }) {
  const gestures = useRowReadGestures(row.id, row.unread);
  return (
    <li className="rq-news-row" data-category={row.category} data-unread={row.unread || undefined} data-emblem={row.emblem ? '' : undefined}>
      <button type="button" className="rq-news-row__hit" {...gestures}>
        {/* badge_earned (F7): sm-emblem i stället för ikonen, aria-hidden (typraden och texten bär betydelsen, Council 23). Okänd serie: reservikonen. */}
        <span className="rq-news-row__icon">
          {row.emblem ? <BadgeEmblem series={row.emblem.series} tier={row.emblem.tier} size="sm" decorative /> : <RQIcon name={row.icon} size={ICON_ROW} />}
        </span>
        <span className="rq-news-row__kind">
          {row.kind}
          {row.unread && <span className="sr-only"> (unread)</span>}
        </span>
        <time className="rq-news-row__time" dateTime={row.iso} title={row.timeTitle}>
          <span className="rq-news-row__mark" aria-hidden="true">{row.unread && <span className="rq-dot rq-news-unread" aria-hidden="true" />}</span>
          {row.time}
        </time>
        <span className="rq-news-row__text">{row.text}</span>
      </button>
    </li>
  );
}
