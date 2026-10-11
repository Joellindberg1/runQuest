import { BADGE_SERIES } from '@runquest/shared';
import { ErrorState } from '@/shared/components/ErrorState';
import { RQIcon } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import type { BadgeRow } from '../badgeModel';
import { BadgeEmblem } from './BadgeEmblem';
import { BadgeChip } from './BadgeChip';

const LOADER_SIZE = 40;
/** Panelrubrikens shield: --rq-icon-md (17 px, Council 7). */
const HEAD_ICON_SIZE = 17;

interface BadgePanelProps {
  /** Bara intjänade serier, redan i visningsordning (`buildRunnerBadges`). Tom lista = tomläget. */
  rows: readonly BadgeRow[];
  /** Laddar badges: stadion-ovalen i stället för raderna. */
  loading?: boolean;
  /** Hämtningen misslyckades: ett felkort med Retry i stället för raderna. Tomläget gäller bara ett lyckat, tomt svar. */
  error?: { onRetry: () => void; retrying: boolean };
}

/**
 * Den skrivskyddade BADGES-panelen (spec §4 F4, Council 1, 14, 16): en rad per intjänad serie med md-emblem, serienamn, "On display" (bara visade),
 * held-by (finns bara när modellen har ett värde — aldrig en platshållare) och nivå-chippet till höger. Inga knappar; väljaren bor i Profile.
 *
 * Tillgänglighet: emblemet är dekorativt (aria-hidden). Serienamnet står som text i raden och nivån som chip-text, så en etikett på emblemet
 * skulle få skärmläsaren att läsa "Rare Milestoner" och sedan "Milestoner ... Rare" — raden läses en gång: namn, visad, held-by, nivå.
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
      <ul className="rq-badge-panel__list" aria-label="Earned badges">
        {rows.map((row) => (
          <li key={row.series} className="rq-badge-panel__row">
            <BadgeEmblem series={row.series} tier={row.tier} size="md" decorative />
            <div className="rq-badge-panel__text">
              <div className="rq-badge-panel__nameline">
                <span className="rq-name rq-badge-panel__name">{row.name}</span>
                {row.displayPosition !== null && <span className="rq-badge-panel__display">On display</span>}
              </div>
              {row.heldBy && <span className="rq-badge-panel__held">{row.heldBy}</span>}
            </div>
            <BadgeChip tier={row.tier} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="rq-card rq-badge-panel" aria-label="Badges">
      <header className="rq-badge-panel__head">
        <RQIcon name="shield" size={HEAD_ICON_SIZE} color="var(--rq-gold)" />
        <h2 className="rq-title rq-badge-panel__title">BADGES</h2>
        {!loading && !error && rows.length > 0 && <span className="rq-badge-panel__aside">{rows.length} of {BADGE_SERIES.length} series</span>}
      </header>
      {body}
    </section>
  );
}
