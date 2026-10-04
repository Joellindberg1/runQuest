import { useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/providers/authContext';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';
import type { User } from '@runquest/types';

interface UseLeaderboardDataResult {
  users: User[];
  currentUser: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

// Samma gränssnitt som förut, men datan ligger nu i TanStack-cachen (`users-with-runs`)
// så att app-skalet och sidan delar en hämtning i stället för varsin.
export function useLeaderboardData(): UseLeaderboardDataResult {
  const { user: authUser } = useAuth();
  const query = useUsersWithRuns(!!authUser);
  const { refetch, error, data } = query;

  useEffect(() => {
    if (error) {
      log.error('Failed to fetch users', error);
      toast.error('Failed to load user data');
    }
  }, [error]);

  const users = useMemo(() => data ?? [], [data]);
  const currentUser = useMemo(
    () => (authUser ? users.find((u) => u.id === authUser.id) ?? null : null),
    [authUser, users],
  );

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return { users, currentUser, loading: !!authUser && query.isLoading, refresh };
}
