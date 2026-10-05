import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { RQIcon } from '@/shared/components/icons';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { paths } from '@/paths';
import type { HistoryRow } from '../historyModel';

const ICON_SIZE = 15;
const LOADING_ROWS = 4;

export type HistoryStatus = 'loading' | 'error' | 'ready';

interface GroupHistoryProps {
  status: HistoryStatus;
  rows: HistoryRow[];
  hasMore: boolean;
  /** Nästa sida hämtas. */
  loadingMore: boolean;
  /** Nästa sida gick inte att hämta — raderna som redan visas står kvar. */
  moreFailed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onMore: () => void;
  onOpenRunner: (userId: string) => void;
}

function RunCard({ row, onOpenRunner }: { row: HistoryRow; onOpenRunner: (userId: string) => void }) {
  const open = () => onOpenRunner(row.userId);
  return (
    <li className="rq-card rq-card--edge rq-log-run" data-me={row.isMe ? 'true' : undefined}>
      <div className="rq-log-run__who">
        <button type="button" className="rq-avatar rq-log-run__avatar" tabIndex={-1} aria-hidden="true" onClick={open}>
          {row.pictureUrl ? <img src={row.pictureUrl} alt="" /> : row.initials}
        </button>
        <div className="rq-log-run__id">
          <button type="button" className="rq-name rq-log-run__name" onClick={open}>
            {row.name}
          </button>
          <p className="rq-log-run__date">{row.date}</p>
          <p className="rq-log-run__tags">
            {row.surface && (
              <>
                <span className="rq-log-tag" data-surface={row.surface}>
                  {row.surface === 'treadmill' ? 'Treadmill' : 'Outdoor'}
                </span>
                <span className="rq-log-run__break" aria-hidden="true" />
              </>
            )}
            {row.weather && (
              <span className="rq-log-run__weather">
                {row.weather.icon && <RQIcon name={row.weather.icon} size={ICON_SIZE} />}
                {row.weather.temperature}
                {row.weather.label && ` · ${row.weather.label}`}
              </span>
            )}
            <span className="rq-log-run__source" data-strava={row.source.strava ? 'true' : undefined}>
              {row.source.label}
            </span>
          </p>
        </div>
      </div>

      <p className="rq-log-run__totals">
        <span className="rq-log-run__km">{row.km} km</span>
        <span className="rq-log-run__xp">+{row.xp} XP</span>
      </p>

      <ul className="rq-hairgrid rq-log-run__cells">
        {row.cells.map((cell) => (
          <li key={cell.key} className="rq-log-cell">
            <span className="rq-log-cell__value" data-tone={cell.tone}>
              {cell.value}
            </span>
            <span className="rq-log-cell__label">{cell.label}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Group history: gruppens rundor som kort, nyast först, med "Show more" (offset-sidor). */
export function GroupHistory({ status, rows, hasMore, loadingMore, moreFailed, retrying, onRetry, onMore, onOpenRunner }: GroupHistoryProps) {
  if (status === 'loading') return <SkeletonRows rows={LOADING_ROWS} label="Loading the group history" />;
  if (status === 'error') {
    return <ErrorState title="Couldn't load the group history" retrying={retrying} onRetry={onRetry} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        headingLevel="h2"
        title="No runs yet"
        text="Runs from the whole pack show up here as soon as someone logs one."
        actionLabel="Log a run"
        actionTo={paths.log}
      />
    );
  }

  return (
    <div className="rq-log-history">
      <ul className="rq-log-history__list" aria-label="Runs in the pack">
        {rows.map((row) => (
          <RunCard key={row.id} row={row} onOpenRunner={onOpenRunner} />
        ))}
      </ul>
      {moreFailed && <ErrorState title="Couldn't load more runs" retrying={retrying} onRetry={onMore} />}
      {hasMore && !moreFailed && (
        <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact rq-log-more" disabled={loadingMore} onClick={onMore}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
