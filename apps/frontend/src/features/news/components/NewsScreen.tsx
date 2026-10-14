import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_NEWS_V1 } from '@/features/onboarding/featureTourSteps';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useMarkNewsSeen, useNewsFeed } from '../hooks/useNewsQueries';
import { useNewsContext } from '../hooks/useNewsContext';
import {
  FILTER_PARAM, INVOLVES_PARAM, buildNewsGroups, countByFilter, involvesAnnouncement, involvesMe, isKnownNewsItem, parseFilterParam, parseInvolvesParam, serializeFilterParam, serializeInvolvesParam,
  toggleFilter, typesForFilters, unreadSummary, type NewsFilterKey,
} from '../newsModel';
import '../news.css';
import { NewsDayList } from './NewsDayList';
import { NewsFilters } from './NewsFilters';
import { NewsSettingsColumn } from './NewsSettingsColumn';
import { NewsSettingsSheet } from './NewsSettingsSheet';

const LOADING_ROWS = 5;
const MARK_READ_ANCHOR = '[data-tour="news-mark-read"]';

/**
 * /news: dag-grupperade rader per typ, filter (`?type=`), "Show more" och "Mark all read". All datahämtning bor här (flödet delas med
 * skalets klock-popover: samma hook, samma cache); raderna är rena vymodeller ur newsModel.
 * Mobil = App Prototypens skärm (filtret som chip-rad — prototypen har inget filter där), desktop = Web Prototypens (flöde | filterkort).
 * Notisinställningarna (samma panel som på Settings) bor i sidokolumnen under filtret på desktop och i ett blad bakom en knapp i sidhuvudet
 * på mobil. Brytpunkten läses i JS (`useIsDesktop`) så att exakt EN av dem finns i DOM: en panel = en live-region av varje slag,
 * ett ankare `news-settings` och inga dubbla annonseringar. Inställningarna döljer aldrig rader här; det är klockan som följer dem (B2).
 */
export function NewsScreen() {
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const ctx = useNewsContext();
  const { state } = useLocation();
  const [params, setParams] = useSearchParams();
  const enabled = !!user;

  const selected = parseFilterParam(params.get(FILTER_PARAM));
  const types = typesForFilters(selected);
  // "Involves me" är ett vyfilter vid sidan av typerna (inte ett av dem): ett eget flöde hos servern, kombinerat med typerna (AND).
  const involves = parseInvolvesParam(params.get(INVOLVES_PARAM));

  // Flödet med alla typer ger chip-räknarna, oläst-siffran och "Mark all read" (oberoende av båda filtren); det valda filtret har en egen cache.
  const all = useNewsFeed(null, enabled);
  const active = useNewsFeed(types, enabled, involves ? 'me' : undefined);
  const seen = useMarkNewsSeen();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);

  const unread = all.feed?.meta.unread_count ?? 0;
  const counts = useMemo(() => countByFilter(all.feed?.items ?? []), [all.feed]);
  const involvesCount = useMemo(() => (all.feed?.items ?? []).filter((row) => isKnownNewsItem(row) && involvesMe(row, ctx.viewerId)).length, [all.feed, ctx.viewerId]);
  // Synligheten (tomtillstånd, filter, tur) följer de RENDERADE raderna: okända/oläsliga rader ligger kvar i flödet men visas inte.
  const unfiltered = selected.length === 0 && !involves;
  const allGroups = useMemo(() => buildNewsGroups(all.feed?.items ?? [], ctx), [all.feed, ctx]);
  const groups = useMemo(() => (unfiltered ? allGroups : buildNewsGroups(active.feed?.items ?? [], ctx)), [unfiltered, allGroups, active.feed, ctx]);
  const loaded = useMemo(() => allGroups.reduce((sum, group) => sum + group.rows.length, 0), [allGroups]);
  const shown = useMemo(() => groups.reduce((sum, group) => sum + group.rows.length, 0), [groups]);

  const updateParams = (change: (next: URLSearchParams) => void) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        change(updated);
        return updated;
      },
      { replace: true, state },
    );
  const writeParam = (name: string, value: string | null) => (next: URLSearchParams) => {
    if (value) next.set(name, value);
    else next.delete(name);
  };
  const setFilter = (next: readonly NewsFilterKey[]) => updateParams(writeParam(FILTER_PARAM, serializeFilterParam(next)));

  // Växlingen annonseras EN gång i en egen polite-region, när raderna har landat (inte när knappen trycks): `announceFor` är värdet användaren bad om,
  // och annonseringen sker först när flödet för det värdet finns. Typchipsen annonserar ingenting idag och rör inte regionen.
  const [announceFor, setAnnounceFor] = useState<boolean | null>(null);
  const [filterResult, setFilterResult] = useState('');
  const expectAnnouncement = (next: boolean) => {
    setFilterResult('');
    setAnnounceFor(next);
  };
  const setInvolves = (next: boolean) => {
    expectAnnouncement(next);
    updateParams(writeParam(INVOLVES_PARAM, serializeInvolvesParam(next)));
  };
  // Tomlägets "Show all news": rensar typerna OCH "Involves me" i ett steg (två separata adressskrivningar skriver över varandra).
  const showAll = () => {
    if (involves) expectAnnouncement(false);
    updateParams((updated) => {
      updated.delete(FILTER_PARAM);
      updated.delete(INVOLVES_PARAM);
    });
  };
  useEffect(() => {
    if (announceFor === null || announceFor !== involves || !active.feed) return;
    setFilterResult(involvesAnnouncement(involves, shown, selected.length > 0));
    setAnnounceFor(null);
  }, [announceFor, involves, active.feed, shown, selected.length]);

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

  const hasItems = groups.length > 0;
  // Mark all read-steget finns bara när något är oläst (knappen visas då); turen kräver ett flöde med synliga rader.
  const tourReady = loaded > 0;
  const tourSteps = useMemo(
    () => (tourReady ? TOUR_NEWS_V1.filter((step) => step.element !== MARK_READ_ANCHOR || unread > 0) : null),
    // Stegen läses när turen startar; senare ändringar av räknaren ska inte bygga om dem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tourReady],
  );
  const showFilter = selected.length > 0 || involves || loaded > 0;
  // Kortet monteras först när flödet (eller felet) är känt: filterkortet kommer in ovanför när raderna landar, och ett kort som redan
  // stod högst upp i kolumnen skulle annars hoppa ner. Ett fel eller tomt flöde ger ändå panelen — inställningarna är inte flödet.
  const feedSettled = !!all.feed || all.isError;
  const showSettingsColumn = isDesktop === true && (showFilter || feedSettled);

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
    // Ett typfilter (med eller utan "Involves me") ger det vanliga "Nothing here"; bara toggeln ensam ger N5:s eget tomläge.
    feed = selected.length > 0 ? (
      <section className="rq-news-empty">
        <h2 className="rq-news-empty__title">Nothing here</h2>
        <p className="rq-news-empty__text">No {selected.length > 1 ? 'news of these kinds' : 'news of this kind'} yet. The filter only hides what the pack did — everything is still in the feed.</p>
        <button type="button" className="rq-btn rq-btn--secondary" onClick={showAll}>Show all news</button>
      </section>
    ) : involves ? (
      <section className="rq-news-empty">
        <h2 className="rq-news-empty__title">Nothing involves you yet</h2>
        <p className="rq-news-empty__text">
          Titles taken from you, challenges, rank changes and events you join will show up here.
          {isDesktop === false ? '' : ' Everything else the pack did is still in the full feed.'}
        </p>
        <button type="button" className="rq-btn rq-btn--secondary" onClick={showAll}>Show all news</button>
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
            {/* Filterväxlingen ("Involves me"): EN permanent polite-region, visuellt dold — raderna är det synliga svaret. Skild från bekräftelsen ovan. */}
            <div role="status" aria-label="Filter result" className="sr-only">{filterResult}</div>
          </div>
          <div className="rq-news__tools">
            {unread > 0 && (
              <button ref={markRef} type="button" className="rq-btn rq-btn--link rq-news__mark" data-tour="news-mark-read" disabled={seen.isPending} onClick={markAllRead}>
                Mark all read
              </button>
            )}
            {isDesktop === false && <NewsSettingsSheet />}
          </div>
        </header>

        <div className="rq-news__split">
          {(showFilter || showSettingsColumn) && (
            <aside className="rq-news__side">
              {showFilter && (
                <NewsFilters
                  selected={selected}
                  counts={counts}
                  loaded={loaded}
                  onToggle={(key) => setFilter(toggleFilter(selected, key))}
                  involves={involves}
                  involvesCount={involvesCount}
                  onToggleInvolves={() => setInvolves(!involves)}
                />
              )}
              {showSettingsColumn && <NewsSettingsColumn />}
            </aside>
          )}
          <div className="rq-news__main">{feed}</div>
        </div>
      </div>
    </>
  );
}
