import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserSettings } from '@/features/settings/hooks/useUserSettings';
import { paths } from '@/paths';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useNewsContext } from '../hooks/useNewsContext';
import { useMarkNewsSeen, useNewsFeed } from '../hooks/useNewsQueries';
import { buildPopoverRows } from '../newsModel';
import '../news.css';
import { NewsPopoverRow } from './NewsPopoverRow';
import { ReadGestureScope } from './ReadGestureScope';

const LOADING_ROWS = 3;

interface NewsPopoverPanelProps {
  /** Stänger popovern när man följer länken till /news (och med ✕ om den visas). */
  onClose: () => void;
  /** ✕ i rubrikraden: mobilens popover har den (App Prototype), desktop stänger med Esc eller klick utanför. */
  showClose?: boolean;
}

/**
 * Innehållet i klock-popovern: "The Pack News", de fem senaste raderna vars slag användaren har påslaget (lästa som olästa, inga egna
 * handlingar) ur samma flöde som /news (EN query-definition, ingen egen hämtning), "Mark all read" och länken "See all pack news".
 * Filtreringen sker här på de 30 inladdade raderna med samma `classifyNotification` som servern; inställningarna kommer ur `useUserSettings`
 * och är defaults medan de laddar eller om de inte gick att läsa, så popovern blockeras aldrig. Rutan öppnas av skalets klockknapp
 * (app-shell/NotificationsPopover). Inget kugghjul här: inställningarna nås från Settings och /news.
 */
export function NewsPopoverPanel({ onClose, showClose = false }: NewsPopoverPanelProps) {
  const ctx = useNewsContext();
  const news = useNewsFeed(null);
  const { values: settings } = useUserSettings();
  const seen = useMarkNewsSeen();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(
    () => buildPopoverRows(news.feed?.items ?? [], ctx, { settings, viewerId: ctx.viewerId }),
    [news.feed, ctx, settings],
  );
  const unread = news.feed?.meta.unread_count ?? 0;

  const markAllRead = () => {
    setNotice(null);
    seen.reset();
    // Knappen försvinner optimistiskt direkt — fokus går till statusregionen i samma ögonblick, och tillbaka till knappen vid fel.
    noticeRef.current?.focus();
    seen.markAllRead((count) => setNotice(`${count} marked as read`));
  };

  useEffect(() => {
    if (seen.error) markRef.current?.focus();
  }, [seen.error]);

  let body;
  if (news.feed && rows.length > 0) {
    body = (
      // Listan äger läs-gesternas rörelsevakt: den räknas från att listan monteras, och popovern monteras om vid varje öppning (nytt fönster).
      <ReadGestureScope>
        <ul className="rq-news-pop__list" aria-label="Latest news">
          {rows.map((row) => <NewsPopoverRow key={row.id} row={row} />)}
        </ul>
      </ReadGestureScope>
    );
  } else if (news.feed && news.feed.items.length === 0) {
    // Ett helt tomt flöde har inget att filtrera bort: som innan inställningarna styrde klockan (frame N2 ritar bara det filtrerade fallet).
    body = <p className="rq-news-pop__note">No news yet — go make some.</p>;
  } else if (news.feed) {
    // Rader finns men alla är filtrerade. Undantaget från designspråkets regel 9 (RUN-254): rubrik och förklaring, och bara länken till /news (nedan).
    body = (
      <div className="rq-news-pop__empty">
        <h3 className="rq-news-pop__empty-title">Nothing new for you</h3>
        <p className="rq-news-pop__empty-text">The pack has been quiet, or you have switched the rest off.</p>
      </div>
    );
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
            <button ref={markRef} type="button" className="rq-btn rq-btn--link" disabled={seen.isPending} onClick={markAllRead}>Mark all read</button>
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
