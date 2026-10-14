import { BadgeEmblem } from '@/features/badges/components/BadgeEmblem';
import { useRowReadGestures } from '../hooks/useRowReadGestures';
import type { NewsRowModel } from '../newsModel';
import { PlacementBadge } from './PlacementBadge';

/**
 * En rad i klock-popovern: samma form och samma läs-gester som /news-raden (`NewsRow`), kompaktare. `li` runt EN knapp som täcker raden;
 * knappens namn är radens egen text (typ, "(unread)" medan oläst, tid, text). Inga `div`/`p` i knappen (bara fraser är tillåtna där), så delarna
 * är `span` som CSS:en gör till block. Olästläget bärs av pricken (form), fetare typrad, tint och skärmläsartexten — inte av färgen ensam.
 */
export function NewsPopoverRow({ row }: { row: NewsRowModel }) {
  const gestures = useRowReadGestures(row.id, row.unread);
  return (
    <li className="rq-news-pop__row" data-category={row.category} data-tone={row.tone} data-unread={row.unread || undefined} data-emblem={row.emblem ? '' : undefined}>
      <button type="button" className="rq-news-pop__hit" {...gestures}>
        {/* badge_earned (F7): sm-emblemet i stället för pricken, aria-hidden (typraden och texten bär betydelsen, Council 23). */}
        {row.emblem
          ? <span className="rq-news-pop__emblem"><BadgeEmblem series={row.emblem.series} tier={row.emblem.tier} size="sm" decorative /></span>
          : <span className="rq-dot rq-news-pop__dot" aria-hidden="true" />}
        <span className="rq-news-pop__body">
          <span className="rq-news-pop__meta">
            <span>
              {row.kind}
              {row.unread && <span className="sr-only"> (unread)</span>}
            </span>
            <time className="rq-news-pop__time" dateTime={row.iso} title={row.timeTitle}>
              <span className="rq-news-row__mark" aria-hidden="true">{row.unread && <span className="rq-dot rq-news-unread" aria-hidden="true" />}</span>
              {row.timeLong}
            </time>
          </span>
          <span className="rq-news-pop__text">
            {row.text}
            {row.placement && <PlacementBadge placement={row.placement} />}
          </span>
        </span>
      </button>
    </li>
  );
}
