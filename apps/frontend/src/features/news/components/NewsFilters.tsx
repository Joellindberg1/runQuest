import { RQIcon } from '@/shared/components/icons';
import { NEWS_FILTERS, CATEGORY_ICON, type NewsFilterKey } from '../newsModel';

const ICON_FILTER = 15;

interface NewsFiltersProps {
  selected: readonly NewsFilterKey[];
  counts: Record<NewsFilterKey, number>;
  /** Rader i det laddade fönstret — räknarnas nämnare ("7 in the latest 30"). */
  loaded: number;
  onToggle: (key: NewsFilterKey) => void;
}

/**
 * Filtret över `?type=`: Titles · Challenges · Events · Levels · Streaks, flera kan vara valda (inget valt = allt). Samma knappar är
 * en chip-rad på mobil och ett kort med lodrät lista på desktop (Web Prototypen) — bara CSS skiljer. Räknaren är antal rader i det
 * laddade fönstret (ADR 008). Valt = `aria-pressed`, med kategorins färg.
 */
export function NewsFilters({ selected, counts, loaded, onToggle }: NewsFiltersProps) {
  return (
    <section className="rq-news-filter" aria-labelledby="news-filter-label" data-tour="news-filter">
      <h2 id="news-filter-label" className="rq-news-filter__label">Filter</h2>
      <div role="group" aria-labelledby="news-filter-label" className="rq-news-filter__list">
        {NEWS_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className="rq-news-filter__item"
            data-category={filter.category}
            title={`${counts[filter.key]} in the latest ${loaded}`}
            aria-pressed={selected.includes(filter.key)}
            onClick={() => onToggle(filter.key)}
          >
            <span className="rq-news-filter__name">
              <span className="rq-news-filter__icon"><RQIcon name={CATEGORY_ICON[filter.category]} size={ICON_FILTER} /></span>
              <span>{filter.label}</span>
            </span>
            <span className="rq-news-filter__count">
              {counts[filter.key]}
              <span className="sr-only"> loaded</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
