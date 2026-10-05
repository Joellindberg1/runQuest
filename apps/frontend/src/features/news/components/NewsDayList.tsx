import type { NewsDayGroup, NewsRowModel } from '../newsModel';
import { NewsRow } from './NewsRow';

/** Dag-grupperat flöde: Today · Yesterday · Earlier this week · en grupp per äldre dag. Raderna skiljs av hårlinjegriden (regel 6). */
export function NewsDayList({ groups, busy }: { groups: readonly NewsDayGroup<NewsRowModel>[]; busy: boolean }) {
  return (
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
  );
}
