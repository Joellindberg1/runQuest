import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_NEWS_V1 } from '@/features/onboarding/featureTourSteps';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useMarkNewsSeen, useNewsFeed } from '../hooks/useNewsQueries';
import { useNewsContext } from '../hooks/useNewsContext';
import { FILTER_PARAM, buildNewsGroups, countByFilter, parseFilterParam, serializeFilterParam, toggleFilter, typesForFilters, unreadSummary, type NewsFilterKey } from '../newsModel';
import '../news.css';
import { NewsDayList } from './NewsDayList';
import { NewsFilters } from './NewsFilters';

const LOADING_ROWS = 5;
const MARK_READ_ANCHOR = '[data-tour="news-mark-read"]';

/**
 * /news: dag-grupperade rader per typ, filter (`?type=`), "Show more" och "Mark all read". All datahämtning bor här (flödet delas med
 * skalets klock-popover: samma hook, samma cache); raderna är rena vymodeller ur newsModel.
 * Mobil = App Prototypens skärm (filtret som chip-rad — prototypen har inget filter där), desktop = Web Prototypens (flöde | filterkort).
 */
export function NewsScreen() {
  const { user } = useAuth();
  const ctx = useNewsContext();
  const { state } = useLocation();
  const [params, setParams] = useSearchParams();
  const enabled = !!user;

  const selected = parseFilterParam(params.get(FILTER_PARAM));
  const types = typesForFilters(selected);

  // Flödet med alla typer ger chip-räknarna, oläst-siffran och "Mark all read"; det valda filtret har en egen cache.
  const all = useNewsFeed(null, enabled);
  const active = useNewsFeed(types, enabled);
  const seen = useMarkNewsSeen();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);

  const unread = all.feed?.meta.unread_count ?? 0;
  const counts = useMemo(() => countByFilter(all.feed?.items ?? []), [all.feed]);
  const groups = useMemo(() => buildNewsGroups(active.feed?.items ?? [], ctx), [active.feed, ctx]);

  const setFilter = (next: readonly NewsFilterKey[]) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        const serialized = serializeFilterParam(next);
        if (serialized) updated.set(FILTER_PARAM, serialized);
        else updated.delete(FILTER_PARAM);
        return updated;
      },
      { replace: true, state },
    );

  const markAllRead = () => {
    setNotice(null);
    seen.reset();
    // Knappen försvinner när inget är oläst (optimistiskt, direkt) — fokus går till statusregionen i samma ögonblick i stället för att falla
    // till body, och tillbaka till knappen om kvitteringen misslyckas (effekten nedan).
    noticeRef.current?.focus();
    seen.markAllRead((count) => setNotice(`${count} marked as read`));
  };

  useEffect(() => {
    if (seen.error) markRef.current?.focus();
  }, [seen.error]);

  const hasItems = (active.feed?.items.length ?? 0) > 0;
  // Mark all read-steget finns bara när något är oläst (knappen visas då); turen kräver ett icke-tomt flöde.
  const tourReady = (all.feed?.items.length ?? 0) > 0;
  const tourSteps = useMemo(
    () => (tourReady ? TOUR_NEWS_V1.filter((step) => step.element !== MARK_READ_ANCHOR || unread > 0) : null),
    // Stegen läses när turen startar; senare ändringar av räknaren ska inte bygga om dem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tourReady],
  );
  const showFilter = selected.length > 0 || (all.feed?.items.length ?? 0) > 0;

  let feed;
  if (active.feed && hasItems) {
    feed = (
      <>
        <NewsDayList groups={groups} busy={active.isFetching && !active.loadingMore} />
        {active.feed.meta.has_more && (
          <div className="rq-news-more">
            <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact" disabled={active.loadingMore} onClick={() => active.loadMore()}>
              {active.loadingMore ? 'Loading…' : 'Show more'}
            </button>
          </div>
        )}
        <p role="alert" className="rq-news-error">{active.loadMoreError ? `Couldn't load older news — ${active.loadMoreError}. Press Show more to try again.` : ''}</p>
      </>
    );
  } else if (active.feed) {
    feed = selected.length > 0 ? (
      <section className="rq-news-empty">
        <h2 className="rq-news-empty__title">Nothing here</h2>
        <p className="rq-news-empty__text">No {selected.length > 1 ? 'news of these kinds' : 'news of this kind'} yet. The filter only hides what the pack did — everything is still in the feed.</p>
        <button type="button" className="rq-btn rq-btn--secondary" onClick={() => setFilter([])}>Show all news</button>
      </section>
    ) : (
      <section className="rq-news-empty">
        <h2 className="rq-news-empty__title">No news yet — go make some</h2>
        <p className="rq-news-empty__text">Titles changing hands, duels, level ups and events show up here as they happen.</p>
        <Link to={paths.log} className="rq-btn rq-btn--secondary">Log a run</Link>
      </section>
    );
  } else if (active.isError) {
    feed = <ErrorState title="Couldn't load Pack News" retrying={active.isFetching} onRetry={() => void active.refetch()} />;
  } else {
    feed = <SkeletonRows rows={LOADING_ROWS} label="Loading Pack News" />;
  }

  return (
    <>
      {/* Bara när det finns något att visa: över ett tomt flöde blir stegen flytande rutor, och turen skulle ändå markeras sedd för alltid. */}
      {tourSteps && <FeatureTour slug="tour_news_v1" steps={tourSteps} />}
      <div className="rq-news">
        <header className="rq-news__head">
          <div>
            <h1 className="rq-display rq-news__title">Pack News</h1>
            {all.feed && <p className="rq-news__sub">{unreadSummary(unread)}</p>}
            {/* Live regions måste finnas innan texten kommer för att annonseras: behållarna är permanenta, bara texten monteras. */}
            <div ref={noticeRef} role="status" tabIndex={-1} className="rq-news-notice">{notice && <p>{notice}</p>}</div>
            <p role="alert" className="rq-news-error">{seen.error ? `Couldn't mark the news as read — ${seen.error}` : ''}</p>
          </div>
          {unread > 0 && (
            <button ref={markRef} type="button" className="rq-btn rq-btn--link rq-news__mark" data-tour="news-mark-read" disabled={seen.isPending} onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </header>

        <div className="rq-news__split">
          {showFilter && (
            <aside className="rq-news__side">
              <NewsFilters selected={selected} counts={counts} loaded={all.feed?.items.length ?? 0} onToggle={(key) => setFilter(toggleFilter(selected, key))} />
            </aside>
          )}
          <div className="rq-news__main">{feed}</div>
        </div>
      </div>
    </>
  );
}
