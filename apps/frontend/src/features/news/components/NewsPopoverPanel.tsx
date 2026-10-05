import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useNewsContext } from '../hooks/useNewsContext';
import { useMarkNewsSeen, useNewsFeed } from '../hooks/useNewsQueries';
import { buildPopoverRows } from '../newsModel';
import '../news.css';

const LOADING_ROWS = 3;

interface NewsPopoverPanelProps {
  /** Stänger popovern när man följer länken till /news (och med ✕ om den visas). */
  onClose: () => void;
  /** ✕ i rubrikraden: mobilens popover har den (App Prototype), desktop stänger med Esc eller klick utanför. */
  showClose?: boolean;
}

/**
 * Innehållet i klock-popovern: "The Pack News", de fem senaste raderna ur samma flöde som /news (EN query-definition, ingen egen
 * hämtning), "Mark all read" och länken "See all pack news". Rutan öppnas av skalets klockknapp (app-shell/NotificationsPopover).
 */
export function NewsPopoverPanel({ onClose, showClose = false }: NewsPopoverPanelProps) {
  const ctx = useNewsContext();
  const news = useNewsFeed(null);
  const seen = useMarkNewsSeen();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildPopoverRows(news.feed?.items ?? [], ctx), [news.feed, ctx]);
  const unread = news.feed?.meta.unread_count ?? 0;

  const markAllRead = () => {
    setNotice(null);
    seen.reset();
    seen.markAllRead((count) => {
      setNotice(`${count} marked as read`);
      noticeRef.current?.focus();
    });
  };

  let body;
  if (news.feed && rows.length > 0) {
    body = (
      <ul className="rq-news-pop__list" aria-label="Latest news">
        {rows.map((row) => (
          <li key={row.id} className="rq-news-pop__row" data-category={row.category} data-tone={row.tone} data-unread={row.unread || undefined}>
            <span className="rq-dot rq-news-pop__dot" aria-hidden="true" />
            <div>
              <div className="rq-news-pop__meta">
                <span>
                  {row.kind}
                  {row.unread && <span className="sr-only"> (unread)</span>}
                </span>
                <time className="rq-news-pop__time" dateTime={row.iso} title={row.timeTitle}>{row.timeLong}</time>
              </div>
              <p className="rq-news-pop__text">{row.text}</p>
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (news.feed) {
    body = <p className="rq-news-pop__note">No news yet — go make some.</p>;
  } else if (news.isError) {
    body = (
      <div className="rq-news-pop__state">
        <ErrorState title="Couldn't load Pack News" retrying={news.isFetching} onRetry={() => void news.refetch()} />
      </div>
    );
  } else {
    body = <div className="rq-news-pop__state"><SkeletonRows rows={LOADING_ROWS} label="Loading Pack News" /></div>;
  }

  return (
    <div>
      <header className="rq-news-pop__head">
        <h2 className="rq-news-pop__title">The Pack News</h2>
        <div className="rq-news-pop__actions">
          {unread > 0 && (
            <button type="button" className="rq-btn rq-btn--link" disabled={seen.isPending} onClick={markAllRead}>Mark all read</button>
          )}
          {showClose && <button type="button" className="rq-news-pop__close" aria-label="Close" onClick={onClose}>✕</button>}
        </div>
      </header>
      <div ref={noticeRef} role="status" tabIndex={-1} className="rq-news-notice rq-news-pop__state">{notice && <p>{notice}</p>}</div>
      <p role="alert" className="rq-news-error rq-news-pop__state">{seen.error ? `Couldn't mark the news as read — ${seen.error}` : ''}</p>
      {body}
      <Link to={paths.news} className="rq-news-pop__foot" onClick={onClose}>
        See all pack news
      </Link>
    </div>
  );
}
