import { useEffect, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_EVENTS_V2 } from '@/features/onboarding/featureTourSteps';
import { useAuth } from '@/providers/authContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { buildEventsView, buildHistoryRows, buildRecord, pageCount, PAGE_PARAM, parsePage, summaryText } from '../eventsModel';
import { useEventHistoryPage, useEventRecordSource, useOpenEvents } from '../hooks/useEventsQueries';
import '../events.css';
import { HistoryPanel } from './HistoryPanel';
import { OpenEventCard } from './OpenEventCard';
import { RecordPanel } from './RecordPanel';
import { UpNextCard } from './UpNextCard';
import { WeekList } from './WeekList';

const LOADING_ROWS = 3;

/**
 * /events: rubrik med räknarrad, öppna event (participation och competition), "Up next", "This week", "Your record" och
 * historiken med pager (`?page=`). All datahämtning bor här; kort och paneler är ren presentation av färdiga vymodeller.
 * Mobil = App Prototypens events-skärm (allt i en kolumn), desktop = Web Prototypens (innehåll | 340 px rekord + historik).
 */
export function EventsScreen() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const { state } = useLocation();
  const [params, setParams] = useSearchParams();
  const enabled = !!user;

  const requestedPage = parsePage(params.get(PAGE_PARAM));
  const openQuery = useOpenEvents(enabled);
  const historyQuery = useEventHistoryPage(requestedPage, enabled);
  const recordQuery = useEventRecordSource(enabled);

  const view = useMemo(() => (openQuery.data ? buildEventsView(openQuery.data.events, now) : null), [openQuery.data, now]);
  const record = useMemo(() => (recordQuery.data ? buildRecord(recordQuery.data) : null), [recordQuery.data]);
  const historyRows = useMemo(() => buildHistoryRows(historyQuery.data?.events ?? []), [historyQuery.data]);

  const pages = pageCount(historyQuery.data?.meta.total ?? 0);
  const page = historyQuery.data ? Math.min(requestedPage, pages) : requestedPage;

  const setPage = (next: number) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        if (next <= 1) updated.delete(PAGE_PARAM);
        else updated.set(PAGE_PARAM, String(next));
        return updated;
      },
      { replace: true, state },
    );

  // En adress med en sida bortom slutet (`?page=99`) landar på sista sidan i stället för en tom lista.
  useEffect(() => {
    if (historyQuery.data && !historyQuery.isPlaceholderData && requestedPage > pages) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (pages <= 1) next.delete(PAGE_PARAM);
          else next.set(PAGE_PARAM, String(pages));
          return next;
        },
        { replace: true, state },
      );
    }
  }, [historyQuery.data, historyQuery.isPlaceholderData, requestedPage, pages, setParams, state]);

  if (isDesktop === undefined) return null;

  // En tom sida medan gruppen har avslutade event är aldrig ett tomt läge: det är ?page= bortom slutet som håller på att rättas — visa skelett.
  const settlingPage = !!historyQuery.data && historyRows.length === 0 && historyQuery.data.meta.total > 0;
  const historyStatus = historyQuery.data && !settlingPage ? 'ready' : historyQuery.isError ? 'error' : 'loading';

  let main;
  if (view) {
    main = (
      <>
        <section className="rq-events__open" aria-label="Open now and up next" data-tour="events-open">
          {view.open.map((card) => (
            <OpenEventCard key={card.id} card={card} isDesktop={isDesktop} />
          ))}
          {view.open.length === 0 && !view.upNext && (
            <p className="rq-events-note">
              Nothing is open or scheduled right now. Events are drawn the evening before they start — the next one shows up here.
            </p>
          )}
          {view.upNext && <UpNextCard card={view.upNext} isDesktop={isDesktop} />}
        </section>
        {view.week.length > 0 && <WeekList rows={view.week} isDesktop={isDesktop} />}
      </>
    );
  } else if (openQuery.isError) {
    main = (
      <ErrorState title="Couldn't load the events" retrying={openQuery.isFetching} onRetry={() => void openQuery.refetch()} />
    );
  } else {
    main = <SkeletonRows rows={LOADING_ROWS} label="Loading events" />;
  }

  return (
    <>
      {view && <FeatureTour slug="tour_events_v2" steps={TOUR_EVENTS_V2} />}
      <div className="rq-events">
        <header className="rq-events__head">
          <h1 className="rq-display rq-events__title">Events</h1>
          {view && <p className="rq-events__sub">{summaryText(view.openCount, record, isDesktop)}</p>}
        </header>
        <div className="rq-events__split">
          <div className="rq-events__main">{main}</div>
          <div className="rq-events__side">
            {record && <RecordPanel record={record} isDesktop={isDesktop} />}
            <HistoryPanel
              status={historyStatus}
              rows={historyRows}
              page={page}
              pages={pages}
              busy={historyQuery.isPlaceholderData}
              retrying={historyQuery.isFetching}
              onRetry={() => void historyQuery.refetch()}
              onPage={setPage}
            />
          </div>
        </div>
      </div>
    </>
  );
}
