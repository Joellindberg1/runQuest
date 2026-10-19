import { useMemo } from 'react';
import { useNow } from '@/app-shell/useNow';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { paths } from '@/paths';
import { useSeasonBoardData } from '../hooks/useSeasonBoardData';
import { badgeShowcaseMap, rankDeltaMap } from '../seasonModel';
import { SeasonBoard } from './SeasonBoard';
import type { UserTitleEntry } from '@runquest/shared';

const LOADING_ROWS = 6;
const NO_TITLES: Record<string, UserTitleEntry[]> = {};

/**
 * All-time/Season-vyn (?view=season): hämtar gruppen, titlarna och rank-delta och ritar SeasonBoard.
 * Titlar och pilar är dekorativa — saknas de ritas korten ändå; bara själva gruppdatan kan ge felkort.
 * På första laddningen av /board har laddningsgaten redan väntat in dem (FirstBoardGate), så korten ritas ifyllda.
 */
export function SeasonView() {
  const { usersQuery, ranked, titlesQuery, rankDeltaQuery, groupBadgesQuery } = useSeasonBoardData();
  const users = usersQuery.data;
  const now = useNow();

  const rankDeltaByUser = useMemo(() => rankDeltaMap(rankDeltaQuery.data?.users), [rankDeltaQuery.data]);
  // Minis är dekor: laddar eller felar gruppens badges ritas Board exakt som förut (inget felkort, ingen spinner).
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
