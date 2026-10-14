import type { FocusEvent } from 'react';
import { RQIcon } from '@/shared/components/icons';
import { NEWS_FILTERS, CATEGORY_ICON, type NewsFilterKey } from '../newsModel';

const ICON_FILTER = 15;

interface NewsFiltersProps {
  selected: readonly NewsFilterKey[];
  counts: Record<NewsFilterKey, number>;
  /** Rader i det laddade fönstret — räknarnas nämnare ("7 in the latest 30"). */
  loaded: number;
  onToggle: (key: NewsFilterKey) => void;
  /** "Involves me" (`?involves=me`): ett vyfilter vid sidan av typerna, inte ett av dem. */
  involves: boolean;
  /** Rader som rör mig i det laddade fönstret (samma fönster som chip-räknarna). */
  involvesCount: number;
  onToggleInvolves: () => void;
}

/**
 * Ett fokuserat chip hamnar helt i bild i den scrollande raden (mobil): sju chips är bredare än skärmen, så ett chip som nås med tangentbordet
 * eller skärmläsaren kan annars stå utanför. `nearest` rör ingenting när chipet redan syns, och inget `behavior` anges: webbläsaren följer då
 * sidans `scroll-behavior` och användarens reducerade rörelse i stället för att tvinga fram en mjuk scroll.
 */
const scrollChipIntoView = (event: FocusEvent<HTMLButtonElement>) => {
  event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
};

/**
 * Filtret över `?type=`: Titles · Challenges · Ranks · Events · Levels · Badges · Streaks (sju chips ur `NEWS_FILTERS`), flera kan vara valda (inget valt = allt). Samma knappar är
 * en chip-rad på mobil och ett kort med lodrät lista på desktop (Web Prototypen) — bara CSS skiljer. Räknaren är antal rader i det
 * laddade fönstret (ADR 008). Valt = `aria-pressed`, med kategorins färg.
 * "Involves me" (frame N5) är en egen knapp ovanför listan: första raden i kortet på desktop, en egen rad ovanför den scrollande chip-raden på mobil,
 * så den aldrig scrollar ur sikte och inte blir ett åttonde chip. Guld, för ett filter utan egen kategorifärg (designregel 4).
 */
export function NewsFilters({ selected, counts, loaded, onToggle, involves, involvesCount, onToggleInvolves }: NewsFiltersProps) {
  return (
    <section className="rq-news-filter" aria-labelledby="news-filter-label" data-tour="news-filter">
      <h2 id="news-filter-label" className="rq-news-filter__label">Filter</h2>
      <div className="rq-news-involves-wrap">
        <button
          type="button"
          className="rq-news-involves"
          title={`${involvesCount} in the latest ${loaded}`}
          aria-pressed={involves}
          aria-describedby="news-involves-hint"
          onClick={onToggleInvolves}
        >
          <span className="rq-news-involves__mark" aria-hidden="true" />
          <span className="rq-news-involves__icon"><RQIcon name="user" size={ICON_FILTER} /></span>
          <span>Involves me</span>
          <span className="rq-news-filter__count">
            {involvesCount}
            <span className="sr-only"> loaded</span>
          </span>
        </button>
        {/* Bara på desktop (frame N5): på mobil tar raden ingen plats och beskrivningen följer inte med. */}
        <p id="news-involves-hint" className="rq-news-involves__hint">What you did, what was done to you, and events you took part in.</p>
      </div>
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
            onFocus={scrollChipIntoView}
          >
            <span className="rq-news-filter__name">
              <span className="rq-news-filter__icon"><RQIcon name={filter.icon ?? CATEGORY_ICON[filter.category]} size={ICON_FILTER} /></span>
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
