import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useTitleLeaderboard } from '@/shared/hooks/useTitleQueries';
import { buildTitleRows } from '../runnerModel';
import { useRunnerTitles } from './useRunnerQueries';

/**
 * Löparens titelrader (innehavda och runner-up) och hämtningens läge, för sidans och popupens titelpanel. Raderna är null medan titlarna (eller topplistan, som ger
 * enheten och innehavaren) laddas; `failed` är ett fel i löparens egna titlar, aldrig ett tomt svar.
 */
export function useRunnerTitleRows(user: User) {
  const titlesQuery = useRunnerTitles(user.id);
  const boardQuery = useTitleLeaderboard();
  const rows = useMemo(
    () => (titlesQuery.data ? buildTitleRows(titlesQuery.data, boardQuery.data ?? [], user.gender) : null),
    [titlesQuery.data, boardQuery.data, user.gender],
  );

  return {
    rows,
    failed: titlesQuery.isError,
    loading: !rows || boardQuery.isLoading,
    retrying: titlesQuery.isFetching,
    retry: () => void titlesQuery.refetch(),
  };
}
