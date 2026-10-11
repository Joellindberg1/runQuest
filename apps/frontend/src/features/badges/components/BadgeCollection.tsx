import { BADGE_SERIES } from '@runquest/shared';
import { ErrorState } from '@/shared/components/ErrorState';
import { RQIcon } from '@/shared/components/icons';
import type { BadgeRow } from '../badgeModel';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgeMinis } from './BadgeMinis';
import { BadgeSeriesCard } from './BadgeSeriesCard';
import '../badges.css';

/** Panelrubrikens shield: --rq-icon-md (17 px, Council 7). */
const HEAD_ICON_SIZE = 17;
const SKELETON_CARDS = 3;
const SKELETON_LINES = 3;

interface BadgeCollectionProps {
  /** En rad per serie i serieordning (`buildCollection`), låsta också. Ignoreras medan `loading`/`error` gäller. */
  rows: readonly BadgeRow[];
  /** Hämtar samlingen första gången: tre skelettkort i stället för rutnätet. */
  loading?: boolean;
  /** Hämtningen misslyckades och det finns inget att visa: felkortet i stället för hela kortet. Resten av sidan berörs inte. */
  error?: { onRetry: () => void; retrying: boolean };
  /** Desktop visar namnen på de valda badges i ON DISPLAY-remsan (mobil bara minisen). */
  isDesktop: boolean;
}

function SkeletonCards() {
  return (
    <div role="status">
      <span className="sr-only">Loading badges</span>
      <div className="rq-badge-skel-list" aria-hidden="true">
        {Array.from({ length: SKELETON_CARDS }, (_, card) => (
          <div key={card} className="rq-badge-skel">
            <div className="rq-badge-skel__shape" />
            <div className="rq-badge-skel__lines">
              {Array.from({ length: SKELETON_LINES }, (_, line) => <div key={line} className="rq-badge-skel__bar" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inga badges än (ett lyckat, tomt svar): streckad ruta, en uppmaning och de åtta serierna som låsta minis. */
function EmptyCollection() {
  return (
    <div className="rq-badge-empty">
      <h3 className="rq-badge-empty__title">No badges yet</h3>
      <p className="rq-badge-empty__text">Log a run to start collecting.</p>
      <span className="rq-badge-empty__minis" role="img" aria-label={`Locked badges: ${BADGE_SERIES.map((series) => series.name).join(', ')}`}>
        {BADGE_SERIES.map((series) => <BadgeEmblem key={series.key} series={series.key} tier={null} size="sm" decorative />)}
      </span>
    </div>
  );
}

/**
 * BADGES-kortet i profilen (spec §4 F2, F8): rubrik + "N of 8 series", ON DISPLAY-remsan med de valda badges (minis i användarens ordning, desktop dessutom
 * namnen) och rutnätet med ett kort per serie. "Edit"/"Edit display" byggs i RUN-129 — här finns ingen redigeringsknapp, och en tom remsa ritas inte.
 *
 * Tillstånd (F8): laddar → skelett; fel → rött kantkort med Retry (i stället för kortet); inga badges än → "No badges yet" + åtta låsta minis.
 * Datahämtningen bor i ProfileScreen — kortet är presentation, så ett badgefel aldrig kan fälla resten av profilen.
 */
export function BadgeCollection({ rows, loading = false, error, isDesktop }: BadgeCollectionProps) {
  if (!loading && error) {
    return <ErrorState title="Couldn't load your badges" message="Your runs are safe." retrying={error.retrying} onRetry={error.onRetry} />;
  }

  const earned = rows.filter((row) => row.earned).length;
  const displayed = rows
    .filter((row) => row.displayPosition !== null)
    .sort((a, b) => (a.displayPosition as number) - (b.displayPosition as number));
  const showcase = displayed.map((row) => ({ series: row.series, tier: row.tier as number }));

  let body;
  if (loading) body = <SkeletonCards />;
  else if (earned === 0) body = <EmptyCollection />;
  else {
    body = (
      <>
        {displayed.length > 0 && (
          <div className="rq-badge-display">
            <span className="rq-badge-display__label">On display</span>
            <BadgeMinis showcase={showcase} />
            {/* Minisen bär redan nivå + serie i sin etikett; namnen här är bara den synliga förklaringen på desktop. */}
            {isDesktop && <span className="rq-badge-display__names" aria-hidden="true">{displayed.map((row) => row.name).join(' · ')}</span>}
          </div>
        )}
        <ul className="rq-badge-grid" aria-label="Badge series">
          {rows.map((row) => <BadgeSeriesCard key={row.series} row={row} />)}
        </ul>
      </>
    );
  }

  return (
    <section className="rq-card rq-badge-collection" aria-label="Badges">
      <header className="rq-badge-collection__head">
        <RQIcon name="shield" size={HEAD_ICON_SIZE} color="var(--rq-gold)" />
        <h2 className="rq-title rq-badge-collection__title">BADGES</h2>
        {!loading && <span className="rq-badge-collection__aside">{earned} of {rows.length} series</span>}
      </header>
      {body}
    </section>
  );
}
