import { useRef } from 'react';
import { BADGE_SERIES } from '@runquest/shared';
import type { BadgeRow } from '@/features/badges/badgeModel';
import { BadgeSeriesCard } from '@/features/badges/components/BadgeSeriesCard';
import { ErrorState } from '@/shared/components/ErrorState';
import { useScrollsVertically } from '../hooks/useScrollsVertically';
import { PanelHead, PanelLoading } from './RunnerParts';

interface PopupBadgesPanelProps {
  /** Bara intjänade serier, redan i visningsordning (`buildRunnerBadges`). Tom lista = tomläget. */
  rows: readonly BadgeRow[];
  /** Laddar badges: stadion-ovalen i stället för korten. */
  loading?: boolean;
  /** Hämtningen misslyckades: ett felkort med Retry. Tomläget gäller bara ett lyckat, tomt svar. */
  error?: { onRetry: () => void; retrying: boolean };
}

/**
 * Popupens Badges-flik: rubriken med antalet intjänade serier och löparens intjänade serier som skrivskyddade förklaringskort (`BadgeSeriesCard` utan växlare: 56 px-emblem, nivå-chip, pips, kravet och
 * held-by) på en neutral yta. Låsta serier visas inte här, de finns på /badges. Korten står i två kolumner när ytan rymmer dem; rubriken står kvar medan listan under den scrollar.
 * Sidans panel (`BadgePanel`, de kompakta emblemen) är en annan och har varken kort eller scrollande lista. Datan är samma hämtning som bannerns minis och sidans panel (`useRunnerPanelData`),
 * så fliken frågar efter ingenting.
 */
export function PopupBadgesPanel({ rows, loading = false, error }: PopupBadgesPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const listScrolls = useScrollsVertically(listRef, rows);

  let body;
  if (loading) {
    body = <PanelLoading label="Loading badges" />;
  } else if (error) {
    body = <ErrorState title="Couldn't load badges" retrying={error.retrying} onRetry={error.onRetry} />;
  } else if (rows.length === 0) {
    body = <p className="rq-runner-note">No badges yet.</p>;
  } else {
    body = (
      // Tabbstopp bara när listan faktiskt scrollar: tangentbordet når den då, och en lista som ryms är inget att tabba till.
      <div ref={listRef} className="rq-runner-badges__scroll" role="region" aria-label="Badge list" tabIndex={listScrolls ? 0 : undefined}>
        <ul className="rq-runner-badges__grid" aria-label="Earned badges">
          {rows.map((row) => (
            <BadgeSeriesCard key={row.series} row={row} />
          ))}
        </ul>
      </div>
    );
  }

  const showCount = !loading && !error && rows.length > 0;
  return (
    <section className="rq-card rq-runner-badges rq-runner-badges--popup" aria-label="Badges">
      <PanelHead icon="shield" title="BADGES" aside={showCount ? `${rows.length} of ${BADGE_SERIES.length} series` : undefined} />
      {body}
    </section>
  );
}
