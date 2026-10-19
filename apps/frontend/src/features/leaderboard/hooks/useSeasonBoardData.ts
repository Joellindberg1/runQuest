import { useMemo } from 'react';
import { useGroupBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { useMultipleUserTitles } from '@/shared/hooks/useTitleQueries';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { useRankDelta } from './useBoardQueries';

const NO_IDS: string[] = [];

/**
 * Allt Season-vyn ritar korten ur: gruppen, titlarna, rank-delta och gruppens badges. De ENDA frågorna för vyn: SeasonView ritar ur dem och
 * laddningsgaten (app-shell/FirstBoardGate) väntar på dem, med samma cache-nycklar, så ingen fråga går två gånger.
 * `decorations: false` hämtar bara gruppen (Week och Streaks ritar inte titlar, pilar eller minis). Pilarna och minis beror inte på gruppen
 * och startar därför direkt; titlarna behöver gruppens id:n och kommer efter den.
 */
export function useSeasonBoardData(decorations = true) {
  const { user } = useAuth();
  const usersQuery = useUsersWithRuns(!!user);
  const users = usersQuery.data;
  const ranked = useMemo(() => leaderboardUtils.filterAndSortUsers(users ?? []), [users]);
  const rankedIds = useMemo(() => (decorations ? ranked.map((runner) => runner.id) : NO_IDS), [decorations, ranked]);
  const titlesQuery = useMultipleUserTitles(rankedIds);
  const rankDeltaQuery = useRankDelta(decorations);
  const groupBadgesQuery = useGroupBadges(decorations && !!user);
  return { usersQuery, ranked, titlesQuery, rankDeltaQuery, groupBadgesQuery };
}
