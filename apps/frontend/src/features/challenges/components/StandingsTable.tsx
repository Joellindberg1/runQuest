import { RQIcon } from '@/shared/components/icons';
import type { StandingRow } from '../duelsModel';

interface StandingsTableProps {
  rows: StandingRow[];
  /** Desktop: rubrikfält med trofé ("Challenge leaderboard · All time") ovanför tabellen. */
  showTitle: boolean;
  onOpenRunner: (userId: string) => void;
}

const ICON_TITLE = 17;

/** Standings: W/D/L och poäng per gruppmedlem (all time). Hårlinjegrid, silvertintad rubrikrad, min rad i guldtint. */
export function StandingsTable({ rows, showTitle, onOpenRunner }: StandingsTableProps) {
  return (
    <section className="rq-card rq-duels-standings" aria-label="Challenge standings">
      {showTitle && (
        <header className="rq-duels-standings__title">
          <RQIcon name="trophy" size={ICON_TITLE} />
          <h2>Challenge leaderboard</h2>
          <span>All time</span>
        </header>
      )}
      <div role="table" aria-label="Challenge standings" className="rq-hairgrid rq-duels-table">
        <div role="row" className="rq-duels-standing rq-table-head">
          <span role="columnheader">#</span>
          <span role="columnheader">Player</span>
          <span role="columnheader" data-align="center">W</span>
          <span role="columnheader" data-align="center">D</span>
          <span role="columnheader" data-align="center">L</span>
          <span role="columnheader" data-align="end">%</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.userId}
            role="row"
            className="rq-duels-standing rq-row"
            data-mine={row.mine}
            data-rank={row.rank <= 3 ? row.rank : undefined}
            onClick={() => onOpenRunner(row.userId)}
          >
            <span role="cell" className="rq-duels-standing__rank">{row.rank}</span>
            <span role="cell">
              <button
                type="button"
                className="rq-duels-standing__name"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenRunner(row.userId);
                }}
              >
                {row.name}
              </button>
            </span>
            <span role="cell" data-align="center" className="rq-duels-standing__w" data-zero={row.wins === 0}>{row.wins}</span>
            <span role="cell" data-align="center" className="rq-duels-standing__d">{row.draws}</span>
            <span role="cell" data-align="center" className="rq-duels-standing__l" data-zero={row.losses === 0}>{row.losses}</span>
            <span role="cell" data-align="end" className="rq-duels-standing__pct" data-empty={row.played === 0}>{row.pct}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
