import React, { useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Leaderboard } from '@/features/leaderboard';
import { RunLogger } from '@/features/runs';
import { UserProfile } from '@/features/profile';
import { TitleSystem } from '@/features/titles';
import { AppLayout } from '@/components/layout/AppLayout';
import { ActiveChallengeWidget } from '@/features/challenges/components/ActiveChallengeWidget';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { useRunUpdates } from '@/features/runs/hooks/useRunUpdates';
import { backendApi } from '@/shared/services/backendApi';
import type { Challenge } from '@/types/run';

const Index: React.FC = () => {
  const { users, currentUser, loading, refresh } = useLeaderboardData();
  const { onRunUpdated } = useRunUpdates(refresh);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = searchParams.get('tab') || 'leaderboard';

  // Fetch user's challenge data for the widget
  const { data: challengeData } = useQuery({
    queryKey: ['challenges', 'my'],
    queryFn: async () => {
      const res = await backendApi.getMyChallenges();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!currentUser,
    staleTime: 2 * 60 * 1000,
  });

  // Find the current user's active challenge
  const myActiveChallenge = useMemo((): Challenge | null => {
    if (!currentUser || !challengeData) return null;
    const found = (challengeData.group_active ?? []).find(
      (c: Challenge) => c.challenger_id === currentUser.id || c.opponent_id === currentUser.id
    );
    if (!found) return null;
    // Map names from leaderboard users
    const challenger = users.find(u => u.id === found.challenger_id);
    const opponent = users.find(u => u.id === found.opponent_id);
    return {
      ...found,
      challenger_name: challenger?.name ?? found.challenger_name ?? 'Unknown',
      opponent_name: opponent?.name ?? found.opponent_name ?? 'Unknown',
    };
  }, [challengeData, currentUser, users]);

  // Fetch progress for the active challenge
  const { data: progressData } = useQuery({
    queryKey: ['challenges', 'progress', myActiveChallenge?.id],
    queryFn: async () => {
      const res = await backendApi.getChallengeProgress(myActiveChallenge!.id);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!myActiveChallenge?.id,
    staleTime: 2 * 60 * 1000,
  });

  const widget = myActiveChallenge ? (
    <ActiveChallengeWidget
      challenge={myActiveChallenge}
      progress={progressData?.progress ?? []}
      currentUserId={currentUser?.id ?? ''}
      onClick={() => navigate('/challenges')}
    />
  ) : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl text-foreground">Loading...</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl text-foreground">User not found</div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'titles':
        return <TitleSystem />;
      case 'profile':
        return <UserProfile user={currentUser} allUsers={users} onRunUpdated={onRunUpdated} />;
      case 'log-run':
        return <RunLogger onSubmit={onRunUpdated} users={users} />;
      default:
        return <Leaderboard users={users} currentUser={currentUser} />;
    }
  };

  return (
    <AppLayout groupName="Wolfpack - Göteborgsvarvet 2026" topbarLeftWidget={widget}>
      {renderContent()}
    </AppLayout>
  );
};

export default Index;
