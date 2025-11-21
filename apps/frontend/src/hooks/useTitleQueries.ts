/**
 * React Query hooks for optimized title data fetching
 * Provides intelligent caching and background updates
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';

// Types for title data
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

export interface UserTitleStatus {
  title_id: string;
  title_name: string;
  title_description: string;
  position: number;
  value: number;
  earned_at: string;
  is_current_holder: boolean;
  status: 'holder' | 'runner_up' | 'top_10';
}

// Query keys for consistent cache management
export const titleQueryKeys = {
  all: ['titles'] as const,
  leaderboard: () => [...titleQueryKeys.all, 'leaderboard'] as const,
  userTitles: (userId: string) => [...titleQueryKeys.all, 'user', userId] as const,
};

/**
 * Hook for fetching title leaderboard with intelligent caching
 */
export function useTitleLeaderboard() {
  return useQuery({
    queryKey: titleQueryKeys.leaderboard(),
    queryFn: async () => {
      const response = await backendApi.getTitleLeaderboard();
      return response.success ? response.data : [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000, // Background refresh every 5 minutes
  });
}

/**
 * Hook for fetching user titles with caching
 */
export function useUserTitles(userId: string | null) {
  return useQuery({
    queryKey: titleQueryKeys.userTitles(userId || ''),
    queryFn: async () => {
      if (!userId) return [];
      const response = await backendApi.getUserTitles(userId);
      return response.success ? response.data : [];
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook for batch fetching user titles for multiple users
 */
export function useMultipleUserTitles(userIds: string[]) {
  const queries = userIds.map(userId => ({
    queryKey: titleQueryKeys.userTitles(userId),
    queryFn: () => optimizedTitleService.getUserTitles(userId),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
  }));

  return useQuery({
    queryKey: ['multiple-user-titles', userIds.sort()],
    queryFn: async () => {
      const results = await Promise.all(
        userIds.map(async (userId) => {
          const response = await backendApi.getUserTitles(userId);
          return response.success ? response.data : [];
        })
      );
      
      const titlesByUser: Record<string, UserTitleStatus[]> = {};
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

/**
 * Mutation for refreshing title leaderboards (admin function)
 */
export function useRefreshTitleLeaderboards() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => backendApi.refreshTitleLeaderboards(),
    onSuccess: () => {
      // Invalidate all title-related queries to force refresh
      queryClient.invalidateQueries({ queryKey: titleQueryKeys.all });
    },
  });
}

/**
 * Helper hook to invalidate title cache after run operations
 */
export function useInvalidateTitleQueries() {
  const queryClient = useQueryClient();

  return {
    invalidateLeaderboard: () => {
      queryClient.invalidateQueries({ queryKey: titleQueryKeys.leaderboard() });
    },
    invalidateUserTitles: (userId?: string) => {
      if (userId) {
        queryClient.invalidateQueries({ queryKey: titleQueryKeys.userTitles(userId) });
      } else {
        queryClient.invalidateQueries({ 
          queryKey: titleQueryKeys.all,
          predicate: (query) => query.queryKey.includes('user')
        });
      }
    },
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: titleQueryKeys.all });
    },
  };
}

/**
 * Helper to get cached title data without refetching
 */
export function useCachedTitleData() {
  const queryClient = useQueryClient();

  return {
    getLeaderboard: (): TitleLeaderboard[] | undefined => {
      return queryClient.getQueryData(titleQueryKeys.leaderboard());
    },
    getUserTitles: (userId: string): UserTitleStatus[] | undefined => {
      return queryClient.getQueryData(titleQueryKeys.userTitles(userId));
    },
  };
}