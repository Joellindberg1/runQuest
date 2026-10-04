import { ErrorState } from '@/shared/components/ErrorState';
import { RQIcon } from '@/shared/components/icons';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import type { HistoryRow, HistorySide } from '../duelsModel';

const ICON_MINE = 14;
const LOADING_ROWS = 6;

interface SideProps {
  side: HistorySide;
  align: 'start' | 'end';
  onOpenRunner: (userId: string) => void;
}

/** En sida av matchen: namn (min = guldprick) och poäng + resultat. Högersidan speglas så att poängen alltid ligger mot "vs". */
function MatchSide({ side, align, onOpenRunner }: SideProps) {
  const name = (
    <button type="button" className="rq-duels-match__name" data-emphasis={side.emphasis} data-mine={side.mine} onClick={() => onOpenRunner(side.userId)}>
      {side.name}
    </button>
  );
  const dot = side.mine ? <span className="rq-duels-match__me" role="img" aria-label="You" /> : null;
  const score = <span className="rq-duels-match__score">{side.score}</span>;
  const result = <span className="rq-duels-match__result" data-tone={side.tone}>{side.result}</span>;
  return (
    <div className="rq-duels-match__side" data-align={align}>
      <div className="rq-duels-match__who">{align === 'end' ? <>{name}{dot}</> : <>{dot}{name}</>}</div>
      <div className="rq-duels-match__outcome">{align === 'end' ? <>{score}{result}</> : <>{result}{score}</>}</div>
    </div>
  );
}

export interface HistoryListProps {
  status: 'loading' | 'error' | 'ready';
  rows: HistoryRow[];
  mineOnly: boolean;
  onToggleMine: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  retrying: boolean;
  onRetry: () => void;
  /** Desktop: vinnarens boost som en extra rad i metan. */
  showReward: boolean;
  onOpenRunner: (userId: string) => void;
}

/** Match history: hela packets avslutade duell, nyast först. Filtret "My matches" gäller de sidor som hunnit laddas. */
export function HistoryList({ status, rows, mineOnly, onToggleMine, hasMore, loadingMore, onLoadMore, retrying, onRetry, showReward, onOpenRunner }: HistoryListProps) {
  if (status === 'error') {
    return <ErrorState title="Couldn't load the match history" retrying={retrying} onRetry={onRetry} />;
  }
  if (status === 'loading') return <SkeletonRows rows={LOADING_ROWS} label="Loading match history" />;

  return (
    <section className="rq-card rq-duels-history" aria-labelledby="duels-history-heading">
      <header className="rq-duels-history__head">
        <h2 id="duels-history-heading" className="rq-duels-history__title">Match history</h2>
        <button type="button" className="rq-duels-mine" aria-pressed={mineOnly} onClick={onToggleMine}>
          <RQIcon name="user" size={ICON_MINE} />
          {mineOnly ? 'My matches' : 'Whole pack'}
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="rq-duels-note">
          {mineOnly ? 'No settled duels of yours among the matches loaded yet.' : 'No duels have been settled yet.'}
        </p>
      ) : (
        <ol aria-label="Matches" className="rq-hairgrid rq-duels-matches">
          {rows.map((row) => (
            <li key={row.id} className="rq-row rq-duels-match" data-mine={row.mine}>
              <MatchSide side={row.left} align="end" onOpenRunner={onOpenRunner} />
              <span className="rq-duels-match__vs" aria-hidden="true">vs</span>
              <MatchSide side={row.right} align="start" onOpenRunner={onOpenRunner} />
              <div className="rq-duels-match__meta">
                {showReward ? (
                  <>
                    <span className="rq-duels-match__what">{row.what}</span>
                    <span className="rq-duels-match__detail">{`${row.days} · ${row.reward}`}</span>
                  </>
                ) : (
                  <span className="rq-duels-match__what">{`${row.what} · ${row.days}`}</span>
                )}
              </div>
              {row.date && <span className="rq-duels-match__date">{row.date}</span>}
            </li>
          ))}
        </ol>
      )}
      {hasMore && (
        <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact rq-duels-more" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  );
}
