import React from 'react';
import { stockholmClock } from '@/app-shell/rightNowItems';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_LEADERBOARD_V1 } from '@/features/onboarding/featureTourSteps';
import { isoWeekNumber } from '@/features/leaderboard/boardFormat';
import { SeasonView } from '@/features/leaderboard/components/SeasonView';
import { StreaksView } from '@/features/leaderboard/components/StreaksView';
import { WeekView } from '@/features/leaderboard/components/WeekView';
import { useAuth } from '@/providers/authContext';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import '@/features/leaderboard/board.css';

const BOARD_VIEWS = ['season', 'week', 'streaks'] as const;
type BoardView = (typeof BOARD_VIEWS)[number];

// "Season" finns inte i datamodellen än (ägarbeslut 2): fliken heter All-time, adressen ?view=season (ADR 006).
const BOARD_TABS: readonly ViewTab<BoardView>[] = [
  { key: 'season', label: 'All-time' },
  { key: 'week', label: 'Week' },
  { key: 'streaks', label: 'Streaks' },
];

const ID_PREFIX = 'board';

/** /board (ADR 006): The Standings med tre delvyer över `?view=` — season (default) · week · streaks. */
const BoardPage: React.FC = () => {
  const [view, setView] = useViewParam(BOARD_VIEWS, 'season');
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const usersQuery = useUsersWithRuns(!!user);

  const weekNumber = isoWeekNumber(stockholmClock(now).date);
  const runnerCount = usersQuery.data ? leaderboardUtils.filterAndSortUsers(usersQuery.data).length : null;
  const sub = isDesktop && runnerCount ? `Week ${weekNumber} · ${runnerCount} runners` : `Week ${weekNumber}`;

  const tabs = (
    <ViewTabs label="Standings view" tabs={BOARD_TABS} value={view} onChange={setView} idPrefix={ID_PREFIX} className="rq-board__tabs" />
  );

  return (
    <div className="rq-board">
      {/* Ankaret (leaderboard-card) finns först när podiet är ritat, och bara i Season-vyn. */}
      {view === 'season' && usersQuery.data && <FeatureTour slug="tour_leaderboard_v1" steps={TOUR_LEADERBOARD_V1} />}

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

      <div key={view} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-board__panel rq-rise">
        {view === 'season' && <SeasonView />}
        {view === 'week' && <WeekView />}
        {view === 'streaks' && <StreaksView />}
      </div>
    </div>
  );
};

export default BoardPage;
