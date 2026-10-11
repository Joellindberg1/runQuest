import { BadgeEmblem } from '@/features/badges/components/BadgeEmblem';
import { RQIcon } from '@/shared/components/icons';
import type { NewsRowModel } from '../newsModel';

/** Ikonstorleken i flödesraden (designen 18 → närmaste ur ikonstegen 15/17/21). */
const ICON_ROW = 17;

/**
 * En rad i flödet: ikon · typ · tid · text, 3 px kant i kategorins färg. Oläst = guldtint bakom raden + guldprick vid tiden
 * (+ en skärmläsartext — färgen ensam bär inget). Tiden är ett `<time>` med exakt klockslag i `title`.
 */
export function NewsRow({ row }: { row: NewsRowModel }) {
  return (
    <li className="rq-news-row" data-category={row.category} data-unread={row.unread || undefined} data-emblem={row.emblem ? '' : undefined}>
      {/* badge_earned (F7): sm-emblem i stället för ikonen, aria-hidden (typraden och texten bär betydelsen, Council 23). Okänd serie: reservikonen. */}
      <span className="rq-news-row__icon">
        {row.emblem ? <BadgeEmblem series={row.emblem.series} tier={row.emblem.tier} size="sm" decorative /> : <RQIcon name={row.icon} size={ICON_ROW} />}
      </span>
      <span className="rq-news-row__kind">
        {row.kind}
        {row.unread && <span className="sr-only"> (unread)</span>}
      </span>
      <time className="rq-news-row__time" dateTime={row.iso} title={row.timeTitle}>
        {row.unread && <span className="rq-dot rq-news-unread" aria-hidden="true" />}
        {row.time}
      </time>
      <p className="rq-news-row__text">{row.text}</p>
    </li>
  );
}
