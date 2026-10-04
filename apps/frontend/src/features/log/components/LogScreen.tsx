import { useMemo } from 'react';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { useAuth } from '@/providers/authContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useOpenRunner } from '@/shared/hooks/useOpenRunner';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { buildHistoryRows } from '../historyModel';
import { useLogForm } from '../hooks/useLogForm';
import { useGroupHistory, useStravaLastSync, useStravaStatus } from '../hooks/useLogQueries';
import '../log.css';
import { DEFAULT_LOG_VIEW, LOG_VIEWS, parseKm, todayOf, type LogView } from '../logModel';
import { buildStravaBanner } from '../stravaModel';
import { buildXpPreview, type XpRules } from '../xpPreviewModel';
import { GroupHistory, type HistoryStatus } from './GroupHistory';
import { RunForm } from './RunForm';
import { StravaBanner } from './StravaBanner';
import { EffectsCard, XpCard } from './XpPanels';

const ID_PREFIX = 'log';
const LOADER_SIZE = 64;

const TABS: readonly ViewTab<LogView>[] = [
  { key: 'form', label: 'Log a run', icon: 'plus' },
  { key: 'group', label: 'Group history', icon: 'list' },
];

/** Reserv när GET /config/xp inte svarar: shareds standardvärden (ADR 004/007) — samma som backend faller tillbaka på. */
const FALLBACK_RULES: XpRules = { settings: DEFAULT_ADMIN_SETTINGS, streak_multipliers: DEFAULT_STREAK_MULTIPLIERS };

/**
 * /log: formulär med Estimated XP-förhandsvisning och "What this run does", samt Group history (`?view=form|group`).
 * All datahämtning bor här; formuläret, kortet och historiken är ren presentation. Mobil = App Prototypens log-skärm
 * (allt i en kolumn, Strava-raden överst), desktop = Web Prototypens (formulär | 400 px förhandsvisning).
 */
export function LogScreen() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const openRunner = useOpenRunner();
  const [view, setView] = useViewParam(LOG_VIEWS, DEFAULT_LOG_VIEW);
  const enabled = !!user;
  const today = todayOf(now);

  const log = useLogForm(now);
  const usersQuery = useUsersWithRuns(enabled);
  const configQuery = useXpConfig();
  const historyQuery = useGroupHistory(enabled && view === 'group');
  const showStrava = enabled && view === 'form' && isDesktop === false;
  const stravaStatus = useStravaStatus(showStrava);
  const stravaSync = useStravaLastSync(showStrava);

  const me = usersQuery.data?.find((candidate) => candidate.id === user?.id);
  const usingDefaults = !configQuery.data && configQuery.isError;
  const rules: XpRules | undefined = configQuery.data ?? (usingDefaults ? FALLBACK_RULES : undefined);

  const preview = useMemo(
    () => (me && rules ? buildXpPreview({ km: parseKm(log.form.distance), date: log.form.date, today, me, users: usersQuery.data ?? [], rules }) : null),
    [me, rules, log.form.distance, log.form.date, today, usersQuery.data],
  );
  const banner = useMemo(() => buildStravaBanner(stravaStatus.data, stravaSync.data, now), [stravaStatus.data, stravaSync.data, now]);

  const historyRows = useMemo(
    () => buildHistoryRows(historyQuery.data?.pages.flatMap((page) => page.runs) ?? [], user?.id),
    [historyQuery.data, user?.id],
  );

  if (isDesktop === undefined) return null;

  const tabs = <ViewTabs label="Log view" tabs={TABS} value={view} onChange={setView} idPrefix={ID_PREFIX} className="rq-log__tabs" />;

  let side;
  if (preview) {
    side = (
      <>
        <XpCard preview={preview} isDesktop={isDesktop} usingDefaults={usingDefaults} />
        <EffectsCard effects={preview.effects} />
      </>
    );
  } else if (usersQuery.isError || (usersQuery.data && !me)) {
    side = (
      <ErrorState
        title="Couldn't load your stats"
        message="Your runs are safe — we just could not work out the estimate. Try again in a moment."
        retrying={usersQuery.isFetching}
        onRetry={() => void usersQuery.refetch()}
      />
    );
  } else {
    side = (
      <section className="rq-card rq-log-pending">
        <TrackLoader size={LOADER_SIZE} label="Loading your estimate" />
      </section>
    );
  }

  const historyStatus: HistoryStatus = historyQuery.data ? 'ready' : historyQuery.isError ? 'error' : 'loading';

  return (
    <div className="rq-log">
      <header className="rq-log__head">
        <div>
          <h1 className="rq-display rq-log__title">Log runs</h1>
          <p className="rq-log__sub">{isDesktop ? 'Strava syncs automatically · manual entry for treadmills' : 'Strava syncs on its own · manual for treadmills'}</p>
        </div>
        {isDesktop && tabs}
      </header>
      {!isDesktop && tabs}

      <div key={view} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-log__panel rq-rise">
        {view === 'form' ? (
          <div className="rq-log__split">
            <div className="rq-log__main">
              {!isDesktop && banner && <StravaBanner banner={banner} />}
              <RunForm state={log} isDesktop={isDesktop} today={today} />
            </div>
            <div className="rq-log__side">{side}</div>
          </div>
        ) : (
          <GroupHistory
            status={historyStatus}
            rows={historyRows}
            hasMore={!!historyQuery.hasNextPage}
            loadingMore={historyQuery.isFetchingNextPage}
            moreFailed={historyQuery.isFetchNextPageError}
            retrying={historyQuery.isFetching}
            onRetry={() => void historyQuery.refetch()}
            onMore={() => void historyQuery.fetchNextPage()}
            onOpenRunner={openRunner}
          />
        )}
      </div>
    </div>
  );
}
