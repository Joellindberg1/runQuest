import { BADGE_SERIES } from '@runquest/shared';
import { ErrorState } from '@/shared/components/ErrorState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import type { BadgeRow } from '../badgeModel';
import { BadgeEmblemDetail } from './BadgeEmblemDetail';

const LOADER_SIZE = 40;

interface BadgePanelProps {
  /** Bara intjänade serier, redan i visningsordning (`buildRunnerBadges`). Tom lista = tomläget. */
  rows: readonly BadgeRow[];
  /** Laddar badges: stadion-ovalen i stället för emblemen. */
  loading?: boolean;
  /** Hämtningen misslyckades: ett felkort med Retry i stället för emblemen. Tomläget gäller bara ett lyckat, tomt svar. */
  error?: { onRetry: () => void; retrying: boolean };
}

/**
 * Den kompakta, skrivskyddade BADGES-panelen på Runner card (spec F11, V2.9 #8–9): intjänade serier som 44 px-emblem i ett radbrytande rutnät.
 * Panelen bär bara rubrik, räknare och emblemknappar; nivån, kravet, "On display" och held-by bor i varje emblems popover (`BadgeEmblemDetail`),
 * så ingen information hänger på en tooltip. Låsta serier visas inte här (de finns på badges-sidan). Ingen ikon i rubriken (designen har ingen).
 *
 * Held-by följer modellen (`buildRunnerBadges`): göms på andras kort när X = N och utelämnas när gruppens data saknas — raderna byggs med rätt viewer.
 */
export function BadgePanel({ rows, loading = false, error }: BadgePanelProps) {
  let body;
  if (loading) {
    body = (
      <div className="rq-badge-panel__loading">
        <TrackLoader size={LOADER_SIZE} label="Loading badges" />
      </div>
    );
  } else if (error) {
    body = <ErrorState title="Couldn't load badges" retrying={error.retrying} onRetry={error.onRetry} />;
  } else if (rows.length === 0) {
    body = <p className="rq-badge-panel__empty">No badges yet.</p>;
  } else {
    body = (
      <ul className="rq-badge-panel__grid" aria-label="Earned badges">
        {rows.map((row) => (
          <li key={row.series} className="rq-badge-panel__item">
            <BadgeEmblemDetail row={row} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="rq-card rq-badge-panel" aria-label="Badges">
      <header className="rq-badge-panel__head">
        <h2 className="rq-title rq-badge-panel__title">BADGES</h2>
        {!loading && !error && rows.length > 0 && <span className="rq-badge-panel__aside">{rows.length} of {BADGE_SERIES.length} series</span>}
      </header>
      {body}
    </section>
  );
}
