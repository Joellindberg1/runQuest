import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useTitleBoard } from '@/features/titles/hooks/useTitlesQueries';
import { buildTitleRows } from '../runnerModel';
import { useRunnerTitles } from './useRunnerQueries';

/**
 * Löparens titelrader (innehavda och runner-up) och hämtningens läge, för sidans och popupens titelpanel. Raderna är null tills både titlarna och topplistan
 * (som ger typ, enhet och innehavare) har svarat. `failed` är ett fel i någon av dem, aldrig ett tomt svar: topplistan läses med `useTitleBoard`, som kastar vid fel, eftersom
 * en sväljd topplista gav varje titel typen "Other" med råa värden. Retry hämtar om båda.
 */
export function useRunnerTitleRows(user: User) {
  const titlesQuery = useRunnerTitles(user.id);
  const boardQuery = useTitleBoard();
  const rows = useMemo(
    () => (titlesQuery.data && boardQuery.data ? buildTitleRows(titlesQuery.data, boardQuery.data, user.gender) : null),
    [titlesQuery.data, boardQuery.data, user.gender],
  );

  return {
    rows,
    failed: titlesQuery.isError || boardQuery.isError,
    loading: !rows,
    retrying: titlesQuery.isFetching || boardQuery.isFetching,
    retry: () => {
      void titlesQuery.refetch();
      void boardQuery.refetch();
    },
  };
}
