import type { NewsDayGroup, NewsRowModel } from '../newsModel';
import { NewsRow } from './NewsRow';
import { ReadGestureScope } from './ReadGestureScope';

/**
 * Dag-grupperat flöde: Today · Yesterday · Earlier this week · en grupp per äldre dag. Raderna skiljs av hårlinjegriden (regel 6).
 * Listan äger läs-gesternas rörelsevakt (`ReadGestureScope`): den räknas från att listan monterades, så rader som kommer senare (Show more, poll)
 * delar fönstret i stället för att få ett eget.
 */
export function NewsDayList({ groups, busy }: { groups: readonly NewsDayGroup<NewsRowModel>[]; busy: boolean }) {
  return (
    <ReadGestureScope>
      <div className="rq-news-days" aria-busy={busy} data-tour="news-feed">
        {groups.map((group) => (
          <section key={group.key} className="rq-news-day" aria-labelledby={`news-day-${group.key}`}>
            <h2 id={`news-day-${group.key}`} className="rq-news-day__label">{group.label}</h2>
            <ul className="rq-hairgrid rq-hairgrid--framed rq-news-list">
              {group.rows.map((row) => <NewsRow key={row.id} row={row} />)}
            </ul>
          </section>
        ))}
      </div>
    </ReadGestureScope>
  );
}
