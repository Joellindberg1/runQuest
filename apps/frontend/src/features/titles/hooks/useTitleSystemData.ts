import { useEffect } from 'react';
import { useTitleLeaderboard, useRefreshTitleLeaderboards } from '@/shared/hooks/useTitleQueries';

export const useTitleSystemData = (users: { name: string }[]) => {
  const { data: titles = [], isLoading: loading } = useTitleLeaderboard();
  const { mutate: refresh } = useRefreshTitleLeaderboards();

  // Trigger a fresh calculation on mount
  useEffect(() => {
    refresh();
  }, []);

  // Auto-refresh when users change (new runs added/removed)
  useEffect(() => {
    if (users.length > 0) refresh();
  }, [users]);

  return { titles, loading };
};
