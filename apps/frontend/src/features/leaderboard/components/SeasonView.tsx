import { useMemo } from 'react';
import { useNow } from '@/app-shell/useNow';
import { useGroupBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useMultipleUserTitles } from '@/shared/hooks/useTitleQueries';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { paths } from '@/paths';
import { useRankDelta } from '../hooks/useBoardQueries';
import { badgeShowcaseMap, rankDeltaMap } from '../seasonModel';
import { SeasonBoard } from './SeasonBoard';
import type { UserTitleEntry } from '@runquest/shared';

const LOADING_ROWS = 6;
const NO_TITLES: Record<string, UserTitleEntry[]> = {};

/**
 * All-time/Season-vyn (?view=season): hämtar gruppen, titlarna och rank-delta och ritar SeasonBoard.
 * Titlar och pilar är dekorativa — saknas de ritas korten ändå; bara själva gruppdatan kan ge felkort.
 */
export function SeasonView() {
  const { user } = useAuth();
  const usersQuery = useUsersWithRuns(!!user);
  const users = usersQuery.data;
  const now = useNow();

  const ranked = useMemo(() => leaderboardUtils.filterAndSortUsers(users ?? []), [users]);
  const titlesQuery = useMultipleUserTitles(useMemo(() => ranked.map((runner) => runner.id), [ranked]));
  const rankDeltaQuery = useRankDelta(!!users);
  const rankDeltaByUser = useMemo(() => rankDeltaMap(rankDeltaQuery.data?.users), [rankDeltaQuery.data]);
  // Minis är dekor: laddar eller felar gruppens badges ritas Board exakt som förut (inget felkort, ingen spinner).
  const groupBadgesQuery = useGroupBadges(!!user);
  const badgesByUser = useMemo(() => badgeShowcaseMap(groupBadgesQuery.data?.members), [groupBadgesQuery.data]);

  if (usersQuery.isError) {
    return <ErrorState title="Couldn't load the standings" retrying={usersQuery.isFetching} onRetry={() => void usersQuery.refetch()} />;
  }
  if (!users) return <SkeletonRows rows={LOADING_ROWS} label="Loading the standings" />;
  if (ranked.length === 0) {
    return <EmptyState title="No runners yet" text="Start logging runs to appear on the board." actionLabel="Log a run" actionTo={paths.log} />;
  }

  return (
    <SeasonBoard
      users={users}
      titlesByUser={titlesQuery.data ?? NO_TITLES}
      rankDeltaByUser={rankDeltaByUser}
      badgesByUser={badgesByUser}
      now={now}
    />
  );
}
