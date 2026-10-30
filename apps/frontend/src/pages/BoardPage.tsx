import React from 'react';
import { LEADERBOARD_TOUR_SLUG, isoWeekNumber, stockholmClock } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_LEADERBOARD_V1 } from '@/features/onboarding/featureTourSteps';
import { BOARD_VIEWS, DEFAULT_BOARD_VIEW, boardViewsFor, type BoardView } from '@/features/leaderboard/boardViews';
import { BOARD_TABS_ID_PREFIX, BoardTabs } from '@/features/leaderboard/components/BoardTabs';
import { PositionLoading, PositionTab } from '@/features/leaderboard/components/PositionTab';
import { SeasonView } from '@/features/leaderboard/components/SeasonView';
import { StreaksView } from '@/features/leaderboard/components/StreaksView';
import { WeekView } from '@/features/leaderboard/components/WeekView';
import { showPositionTab } from '@/features/leaderboard/positionTab';
import { loadPositionView } from '@/features/leaderboard/positionViewLoader';
import { useAuth } from '@/providers/authContext';
import type { ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import '@/features/leaderboard/board.css';

// "Season" finns inte i datamodellen än (ägarbeslut 2): fliken heter All-time, adressen ?view=season (ADR 006).
const ALWAYS_TABS: readonly ViewTab<BoardView>[] = [
  { key: 'season', label: 'All-time' },
  { key: 'week', label: 'Week' },
  { key: 'streaks', label: 'Streaks' },
];
// Position kommer sist och finns bara i en grupp på minst två (ADR 007 addendum 2026-10-26).
const BOARD_TABS_WITH_POSITION: readonly ViewTab<BoardView>[] = [...ALWAYS_TABS, { key: 'position', label: 'Position' }];

/** /board (ADR 006): The Standings med fyra delvyer över `?view=` — season (default) · week · streaks · position (bara med två eller fler medlemmar). */
const BoardPage: React.FC = () => {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const usersQuery = useUsersWithRuns(!!user);

  // Antalet medlemmar kommer ur gruppen som Board redan hämtar, aldrig ur positionssvaret: en grupp på en får Season utan att något positionsanrop görs. Tills gruppen svarat
  // (eller felat) godtas `?view=position` så att länken inte tappas; vyn väntar då på gruppen i stället för att visa Season och byta. Ett fel är bestående (`errorUpdateCount`): Seasons
  // egna observatör hämtar om gruppen och sätter queryn tillbaka i laddning, och då får vyn inte hoppa tillbaka till Position.
  const groupKnown = usersQuery.data !== undefined;
  const groupFailed = !groupKnown && (usersQuery.isError || usersQuery.errorUpdateCount > 0);
  const memberCount = usersQuery.data ? usersQuery.data.length : 0;
  const [view, setView] = useViewParam(groupKnown || groupFailed ? boardViewsFor(memberCount) : BOARD_VIEWS, DEFAULT_BOARD_VIEW);
  const waitingForGroup = view === 'position' && !groupKnown && !groupFailed;

  const weekNumber = isoWeekNumber(stockholmClock(now).date);
  const runnerCount = usersQuery.data ? usersQuery.data.length : null;
  const sub = isDesktop && runnerCount ? `Week ${weekNumber} · ${runnerCount} runners` : `Week ${weekNumber}`;

  // Användaren är på väg till Position (pekare eller fokus på fliken): chunken hämtas redan nu, så den är på plats när fliken väljs.
  const headingFor = (next: BoardView) => {
    if (next === 'position') void loadPositionView();
  };
  const tabs = (
    <BoardTabs
      tabs={showPositionTab(memberCount) || waitingForGroup ? BOARD_TABS_WITH_POSITION : ALWAYS_TABS}
      view={view}
      onChange={setView}
      onIntent={headingFor}
    />
  );

  return (
    <div className="rq-board">
      {/* Ankaret (leaderboard-card) finns först när podiet är ritat, och bara i Season-vyn. */}
      {view === 'season' && usersQuery.data && <FeatureTour slug={LEADERBOARD_TOUR_SLUG} steps={TOUR_LEADERBOARD_V1} />}

      <header className="rq-board__head">
        {isDesktop ? (
          <>
            <div>
              <h1 className="rq-display rq-board__title">The standings</h1>
              <p className="rq-board__sub">{sub}</p>
            </div>
            {tabs}
          </>
        ) : (
          <>
            <h1 className="rq-display rq-board__title">The standings</h1>
            <span className="rq-board__week">{sub}</span>
          </>
        )}
      </header>
      {!isDesktop && tabs}

      <div key={view} role="tabpanel" id={panelId(BOARD_TABS_ID_PREFIX)} aria-labelledby={tabId(BOARD_TABS_ID_PREFIX, view)} className="rq-board__panel rq-rise">
        {view === 'season' && <SeasonView />}
        {view === 'week' && <WeekView />}
        {view === 'streaks' && <StreaksView />}
        {view === 'position' && (waitingForGroup ? <PositionLoading /> : <PositionTab meId={user?.id ?? null} />)}
      </div>
    </div>
  );
};

export default BoardPage;
