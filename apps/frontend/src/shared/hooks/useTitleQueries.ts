import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import type { UserTitleEntry } from '@runquest/shared';

export const titleQueryKeys = {
  all: ['titles'] as const,
};

/** Batch fetch titles for multiple users with React Query caching. */
export function useMultipleUserTitles(userIds: string[]) {
  return useQuery({
    queryKey: ['multiple-user-titles', [...userIds].sort()],
    queryFn: async () => {
      const results = await Promise.all(
        userIds.map(async (userId) => {
          const response = await backendApi.getUserTitles(userId);
          return response.success ? (response.data ?? []) : [];
        })
      );
      const titlesByUser: Record<string, UserTitleEntry[]> = {};
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
