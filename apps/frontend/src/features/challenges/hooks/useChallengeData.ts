import { useQuery, useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import type { Challenge, ChallengeStats } from '@/types/run';
import type { LeaderboardEntry } from '../components/ChallengeLeaderboard';
import type { ChallengeWithProgress } from '../components/ChallengesPage';
import type { GroupMember } from '../components/SendChallengeModal';

export function useChallengeData(currentUserId: string) {

  // Fetch personal challenges + group active in one call
  const challengesQuery = useQuery({
    queryKey: ['challenges', 'my'],
    queryFn: async () => {
      const res = await backendApi.getMyChallenges();
      if (!res.success) throw new Error(res.error);
      return res.data!;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  // Fetch group stats for leaderboard
  const statsQuery = useQuery({
    queryKey: ['challenges', 'group-stats'],
    queryFn: async () => {
      const res = await backendApi.getChallengeGroupStats();
      if (!res.success) throw new Error(res.error);
      return res.data!;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  // Build name lookup and group member list from group-stats (already in isLoading)
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (statsQuery.data ?? []).forEach(u => { map[u.user_id] = u.name; });
    return map;
  }, [statsQuery.data]);

  const groupMembers: GroupMember[] = useMemo(
    () => (statsQuery.data ?? []).map(u => ({
      id: u.user_id,
      name: u.name,
      challenge_active: u.challenge_active,
    })),
    [statsQuery.data]
  );

  // Attach names to a challenge
  const withNames = (c: Challenge): Challenge => ({
    ...c,
    challenger_name: nameMap[c.challenger_id] || c.challenger_name || 'Unknown',
    opponent_name: nameMap[c.opponent_id] || c.opponent_name || 'Unknown',
  });

  // Fetch progress for all group active challenges
  const activeIds = challengesQuery.data?.group_active?.map(c => c.id) ?? [];

  const progressQueries = useQueries({
    queries: activeIds.map(id => ({
      queryKey: ['challenges', 'progress', id],
      queryFn: async () => {
        const res = await backendApi.getChallengeProgress(id);
        if (!res.success) throw new Error(res.error);
        return { id, progress: res.data!.progress };
      },
      staleTime: 60 * 1000,
    })),
  });

  // Build allActiveChallenges with progress
  const allActiveChallenges: ChallengeWithProgress[] = useMemo(() => {
    if (!challengesQuery.data?.group_active) return [];

    const progressMap: Record<string, { user_id: string; value: number }[]> = {};
    progressQueries.forEach(q => {
      if (q.data) progressMap[q.data.id] = q.data.progress;
    });

    return challengesQuery.data.group_active.map(c => ({
      challenge: withNames(c),
      progress: (progressMap[c.id] ?? []).map(p => ({
        user_id: p.user_id,
        name: nameMap[p.user_id] || 'Unknown',
        value: p.value,
      })),
    }));
  }, [challengesQuery.data, progressQueries, nameMap]);

  // Leaderboard from group stats
  const leaderboard: LeaderboardEntry[] = useMemo(
    () => (statsQuery.data ?? []).map(u => ({
      user_id: u.user_id,
      name: u.name,
      wins: u.wins,
      draws: u.draws,
      losses: u.losses,
      challenge_active: u.challenge_active,
    })),
    [statsQuery.data]
  );

  const raw = challengesQuery.data;

  const sentChallenge = raw?.sent_challenge ? withNames(raw.sent_challenge) : null;
  const receivedChallenges = (raw?.received_challenges ?? []).map(withNames);
  const tokens = raw?.tokens ?? [];
  const boosts = raw?.boosts ?? [];
  const history = (raw?.history ?? []).map(withNames);

  // Stats derived from group stats for current user
  const myStats = statsQuery.data?.find(u => u.user_id === currentUserId);
  const stats: ChallengeStats = {
    wins: myStats?.wins ?? 0,
    draws: myStats?.draws ?? 0,
    losses: myStats?.losses ?? 0,
    challenge_active: myStats?.challenge_active ?? false,
  };

  const isLoading = challengesQuery.isLoading || statsQuery.isLoading;

  return {
    isLoading,
    groupMembers,
    allActiveChallenges,
    leaderboard,
    sentChallenge,
    receivedChallenges,
    tokens,
    boosts,
    history,
    stats,
    refetch: () => {
      challengesQuery.refetch();
      statsQuery.refetch();
    },
  };
}
