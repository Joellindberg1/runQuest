import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { pagerItems, type HistoryRow } from '../eventsModel';

const LOADING_ROWS = 6;

export interface HistoryPanelProps {
  status: 'loading' | 'error' | 'ready';
  rows: readonly HistoryRow[];
  page: number;
  pages: number;
  /** Nästa sida hämtas — föregående rader står kvar, dämpade. */
  busy: boolean;
  retrying: boolean;
  onRetry: () => void;
  onPage: (page: number) => void;
}

/** Avslutade events med mitt resultat, sex per sida. Pagern (← 1 2 3 →) ligger längst ned i panelen och är sidan i `?page=`. */
export function HistoryPanel({ status, rows, page, pages, busy, retrying, onRetry, onPage }: HistoryPanelProps) {
  const items = pagerItems(page, pages);

  return (
    <section className="rq-card rq-events-history" aria-labelledby="events-history-heading" data-tour="events-history">
      <h2 id="events-history-heading" className="rq-title rq-events-history__title">History</h2>

      {status === 'error' && <ErrorState title="Couldn't load the history" retrying={retrying} onRetry={onRetry} />}
      {status === 'loading' && <SkeletonRows rows={LOADING_ROWS} label="Loading the history" />}
      {status === 'ready' && rows.length === 0 && <p className="rq-events-note">No event has finished yet.</p>}
      {status === 'ready' && rows.length > 0 && (
        <ol aria-label="Finished events" aria-busy={busy} className="rq-hairgrid rq-events-history__rows">
          {rows.map((row) => (
            <li key={row.id} className="rq-row rq-events-history__row" data-kind={row.kind}>
              <div>
                <h3 className="rq-events-history__name">{row.name}</h3>
                <p className="rq-events-history__meta">{row.meta}</p>
              </div>
              <div className="rq-events-history__result">
                <p className="rq-events-history__status" data-tone={row.tone}>{row.status}</p>
                <p className="rq-events-history__xp">{row.xp}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {status === 'ready' && pages > 1 && (
        <nav className="rq-events-pager" aria-label="History pages">
          <button type="button" className="rq-events-pager__btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ←
          </button>
          <div className="rq-events-pager__pages">
            {items.map((item) =>
              item.kind === 'gap' ? (
                <span key={item.key} className="rq-events-pager__gap" aria-hidden="true">…</span>
              ) : (
                <button
                  key={item.page}
                  type="button"
                  className="rq-events-pager__btn"
                  aria-label={`Page ${item.page}`}
                  aria-current={item.page === page ? 'page' : undefined}
                  onClick={() => onPage(item.page)}
                >
                  {item.page}
                </button>
              ),
            )}
          </div>
          <button type="button" className="rq-events-pager__btn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            →
          </button>
        </nav>
      )}
    </section>
  );
}
