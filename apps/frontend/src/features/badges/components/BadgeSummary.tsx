import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { ErrorState } from '@/shared/components/ErrorState';
import { buildBadgeSummary, type BadgeRow } from '../badgeModel';
import { BadgeEmblemDetail } from './BadgeEmblemDetail';
import '../badges.css';

/** Så många skelettblock som en vanlig rad intjänade serier (spec F10.5). */
const SKELETON_EMBLEMS = 5;

interface BadgeSummaryProps {
  /** En rad per serie i serieordning (`buildCollection`), låsta också. Ignoreras medan `loading`/`error` gäller. */
  rows: readonly BadgeRow[];
  /** Hämtar samlingen första gången: en rad skelettblock i stället för emblemen. */
  loading?: boolean;
  /** Hämtningen misslyckades och det finns inget att visa: felkortet i stället för raderna. Resten av profilen berörs inte. */
  error?: { onRetry: () => void; retrying: boolean };
  /** Mobil: ingen kortyta och en eyebrow som rubrik. Desktop: `.rq-card` och Bebas-rubrik. */
  isDesktop: boolean;
}

function SkeletonRow() {
  return (
    <div role="status">
      <span className="sr-only">Loading badges</span>
      <div className="rq-badge-summary__row rq-badge-skel-row" aria-hidden="true">
        {Array.from({ length: SKELETON_EMBLEMS }, (_, index) => <div key={index} className="rq-badge-skel__shape rq-badge-skel__shape--cp" />)}
      </div>
    </div>
  );
}

/**
 * Profilens kompakta badge-sammanfattning (spec v2 F10): rubrik med "N of 8 series" och "All badges →", intjänade serier som 44 px-emblem sorterade på nivå, och under en
 * hårlinje de låsta. Profilen väljer ingenting: valet görs på /badges (O3). Varje emblem är en `BadgeEmblemDetail` (tryck/tangentbord öppnar en popover med nivå och krav).
 *
 * Mobil har ingen kortyta (som designen); desktop ligger i ett `.rq-card`. Tillstånd (F10.5): laddar → skelettrad; fel → `ErrorState` med Retry i stället för raderna (rubriken
 * och länken kvar, ett badgefel fäller aldrig profilen); inga intjänade → streckad ruta och en låst rad med alla åtta. Datahämtningen bor i ProfileScreen.
 */
export function BadgeSummary({ rows, loading = false, error, isDesktop }: BadgeSummaryProps) {
  const failed = !loading && error !== undefined;
  const showCount = !loading && !failed;
  const { earned, locked, earnedCount, lockedCount, total } = buildBadgeSummary(rows);
  const countText = `${earnedCount} of ${total} series`;

  let body;
  if (loading) body = <SkeletonRow />;
  else if (error) body = <ErrorState title="Couldn't load your badges" message="Your runs are safe." retrying={error.retrying} onRetry={error.onRetry} />;
  else {
    body = (
      <>
        {earnedCount === 0 ? (
          <p className="rq-badge-summary__empty">No badges yet. Log a run to start collecting.</p>
        ) : (
          <ul className="rq-badge-summary__row" aria-label="Earned badges">
            {earned.map((row) => <li key={row.series}><BadgeEmblemDetail row={row} /></li>)}
          </ul>
        )}
        {lockedCount > 0 && (
          <div className="rq-badge-summary__locked">
            <ul className="rq-badge-summary__row" aria-label="Locked badges">
              {locked.map((row) => <li key={row.series}><BadgeEmblemDetail row={row} /></li>)}
            </ul>
            <span className="rq-badge-summary__locked-note">{isDesktop ? `Locked · ${lockedCount} series left` : `Locked · ${lockedCount} left`}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <section className={isDesktop ? 'rq-card rq-badge-summary' : 'rq-badge-summary'} aria-label="Badges">
      <header className="rq-badge-summary__head">
        {isDesktop ? (
          <>
            <h2 className="rq-title rq-badge-summary__title">BADGES</h2>
            {showCount && <span className="rq-badge-summary__count">{countText}</span>}
          </>
        ) : (
          <h2 className="rq-eyebrow rq-badge-summary__eyebrow">{showCount ? `Badges · ${countText}` : 'Badges'}</h2>
        )}
        <Link to={paths.badges} className="rq-btn rq-btn--ghost rq-btn--compact rq-badge-summary__all">
          All badges <span aria-hidden="true">→</span>
        </Link>
      </header>
      {body}
    </section>
  );
}
