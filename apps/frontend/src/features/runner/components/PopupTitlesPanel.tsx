import { useMemo, useRef } from 'react';
import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { SegmentedControl } from '@/shared/components/SegmentedControl';
import { firstName } from '@/shared/utils/format';
import { useRunnerTitleRows } from '../hooks/useRunnerTitleRows';
import { useScrollsVertically } from '../hooks/useScrollsVertically';
import { ALL_TITLES, categoryLabel, filterTitleRows, titleFilterOptions, type TitleFilter } from '../titlesFilter';
import { PanelHead, PanelLoading } from './RunnerParts';
import { RunnerUpTitles } from './TitlesPanel';

interface PopupTitlesPanelProps {
  user: User;
  /** Vald kategori. Popupen äger den (och nollställer den vid varje öppning); panelen läser aldrig adressen. */
  filter: TitleFilter;
  onFilterChange: (filter: TitleFilter) => void;
}

/**
 * Popupens Titles held-flik: rubriken med antalet innehavda titlar (följer filtret), ett typfilter (`SegmentedControl`, `aria-pressed`) av de kategorier som löparens titlar har (döljs vid en enda kategori), och
 * under det en lista som scrollar för sig medan rubriken och filtret står kvar. Innehavda titlar står i två kolumner när ytan rymmer dem; Runner-up-avsnittet är sidans (`RunnerUpTitles`)
 * och filtreras på samma kategori. Sidans panel (`TitlesPanel`) är en annan och har varken filter eller scrollande lista.
 */
export function PopupTitlesPanel({ user, filter, onFilterChange }: PopupTitlesPanelProps) {
  const { rows, failed, loading, retrying, retry } = useRunnerTitleRows(user);
  const shown = useMemo(() => (rows ? filterTitleRows(rows, filter) : null), [rows, filter]);
  const options = useMemo(() => (rows ? titleFilterOptions(rows) : []), [rows]);
  const listRef = useRef<HTMLDivElement>(null);
  const listScrolls = useScrollsVertically(listRef, shown);

  let body;
  if (failed) {
    body = <ErrorState title="Couldn't load titles" retrying={retrying} onRetry={retry} />;
  } else if (!rows || !shown || loading) {
    body = <PanelLoading label="Loading titles" />;
  } else if (rows.held.length === 0 && rows.runnersUp.length === 0) {
    body = <p className="rq-runner-note">No titles yet — {firstName(user.name)} is still chasing the first one.</p>;
  } else {
    const nothingOfType = shown.held.length === 0 && shown.runnersUp.length === 0;
    // Som prototypen: med en enda kategori är filtret ingenting att välja mellan ("All" och kategorin ger samma lista) och döljs. Ligger ett val kvar (datan ändrades under en öppen popup) står det
    // kvar så att vägen tillbaka till "All" finns.
    const showFilter = options.length > 2 || filter !== ALL_TITLES;
    body = (
      <>
        {showFilter && <SegmentedControl label="Titles filter" options={options} value={filter} onChange={onFilterChange} className="rq-runner-titles__filter" />}
        {/* Tabbstopp bara när listan faktiskt scrollar: tangentbordet når den då, och en lista som ryms är inget att tabba till. */}
        <div ref={listRef} className="rq-runner-titles__scroll" role="region" aria-label="Title list" tabIndex={listScrolls ? 0 : undefined}>
          {nothingOfType ? (
            <p className="rq-runner-note">No titles of this type.</p>
          ) : (
            <>
              {shown.held.length === 0 ? (
                <p className="rq-runner-note">No titles held yet.</p>
              ) : (
                <ul className="rq-runner-list rq-runner-titles__grid" aria-label="Titles held">
                  {shown.held.map((title) => (
                    <li key={title.id} className="rq-runner-title" data-kind="held">
                      <span className="rq-runner-title__main">
                        <span className="rq-runner-title__name">{title.name}</span>
                        <span className="rq-runner-title__type">{categoryLabel(title.category)}</span>
                      </span>
                      <span className="rq-runner-title__value">{title.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              <RunnerUpTitles rows={shown.runnersUp} />
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <section className="rq-card rq-runner-titles rq-runner-titles--popup" aria-label="Titles">
      <PanelHead icon="crown" title="TITLES HELD" aside={shown ? `${shown.held.length} held` : undefined} />
      {body}
    </section>
  );
}
