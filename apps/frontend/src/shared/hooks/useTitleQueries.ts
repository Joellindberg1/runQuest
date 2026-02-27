import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import type { UserTitle } from '@/types/run';

export interface TitleLeaderboard {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  holder: {
    user_id: string;
    user_name: string;
    profile_picture?: string;
    value: number;
    earned_at: string;
  } | null;
  runners_up: Array<{
    position: number;
    user_id: string;
    user_name: string;
    profile_picture?: string;
    value: number;
    earned_at: string;
  }>;
}

export const titleQueryKeys = {
  all: ['titles'] as const,
  leaderboard: () => [...titleQueryKeys.all, 'leaderboard'] as const,
  userTitles: (userId: string) => [...titleQueryKeys.all, 'user', userId] as const,
};

/** Fetch full title leaderboard with React Query caching. */
export function useTitleLeaderboard() {
  return useQuery({
    queryKey: titleQueryKeys.leaderboard(),
    queryFn: async () => {
      const response = await backendApi.getTitleLeaderboard();
      return response.success ? (response.data as TitleLeaderboard[]) : [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Fetch titles for a single user with React Query caching. */
export function useUserTitles(userId: string | null) {
  return useQuery({
    queryKey: titleQueryKeys.userTitles(userId || ''),
    queryFn: async () => {
      if (!userId) return [];
      const response = await backendApi.getUserTitles(userId);
      return response.success ? (response.data as UserTitle[]) : [];
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Batch fetch titles for multiple users with React Query caching. */
export function useMultipleUserTitles(userIds: string[]) {
  return useQuery({
    queryKey: ['multiple-user-titles', [...userIds].sort()],
    queryFn: async () => {
      const results = await Promise.all(
        userIds.map(async (userId) => {
          const response = await backendApi.getUserTitles(userId);
          return response.success ? (response.data as UserTitle[]) : [];
        })
      );
      const titlesByUser: Record<string, UserTitle[]> = {};
      userIds.forEach((userId, index) => {
        titlesByUser[userId] = results[index];
      });
      return titlesByUser;
    },
    enabled: userIds.length > 0,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/** Mutation for refreshing title leaderboard calculations (admin). */
export function useRefreshTitleLeaderboards() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => backendApi.refreshTitleLeaderboards(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: titleQueryKeys.all });
    },
  });
}

/** Invalidate title cache after run operations. */
export function useInvalidateTitleQueries() {
  const queryClient = useQueryClient();
  return {
    invalidateLeaderboard: () =>
      queryClient.invalidateQueries({ queryKey: titleQueryKeys.leaderboard() }),
    invalidateUserTitles: (userId?: string) => {
      if (userId) {
        queryClient.invalidateQueries({ queryKey: titleQueryKeys.userTitles(userId) });
      } else {
        queryClient.invalidateQueries({
          queryKey: titleQueryKeys.all,
          predicate: (query) => query.queryKey.includes('user'),
        });
      }
    },
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: titleQueryKeys.all }),
  };
}
