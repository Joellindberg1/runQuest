import React from 'react';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { useRunUpdates } from '@/features/runs/hooks/useRunUpdates';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { EmptyState } from '@/shared/components/EmptyState';
import { paths } from '@/paths';
import type { User } from '@runquest/types';

export interface LeaderboardScreenData {
  users: User[];
  currentUser: User;
  refresh: () => Promise<void>;
  onRunUpdated: () => Promise<void>;
}

/**
 * Det Index.tsx gjorde för flikarna leaderboard/titles/profile/log-run: hämta användare,
 * visa laddning/"inte hittad" och ge skärmen `users` + `currentUser`. Skärmarna är oförändrade.
 */
export const WithLeaderboardData: React.FC<{ children: (data: LeaderboardScreenData) => React.ReactNode }> = ({ children }) => {
  const { users, currentUser, loading, refresh } = useLeaderboardData();
  const { onRunUpdated } = useRunUpdates(refresh);

  if (loading) return <SkeletonRows rows={6} label="Loading" />;
  if (!currentUser) {
    return <EmptyState title="User not found" text="We could not load your runner data." actionLabel="Back to the board" actionTo={paths.board} />;
  }
  return <>{children({ users, currentUser, refresh, onRunUpdated })}</>;
};
