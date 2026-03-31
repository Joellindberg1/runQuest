import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Leaderboard } from '@/features/leaderboard/components/Leaderboard';
import { RunLogger } from '@/features/runs/components/RunLogger';
import { UserProfile } from '@/features/profile/components/UserProfile';
import { TitleSystem } from '@/features/titles/components/TitleSystem';
import { AppLayout } from '@/components/layout/AppLayout';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { useRunUpdates } from '@/features/runs/hooks/useRunUpdates';
import { backendApi } from '@/shared/services/backendApi';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_LEADERBOARD_V1, TOUR_TITLES_V1, TOUR_PROFILE_V1 } from '@/features/onboarding/featureTourSteps';

const Index: React.FC = () => {
  const { users, currentUser, loading, refresh } = useLeaderboardData();
  const { onRunUpdated } = useRunUpdates(refresh);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = searchParams.get('tab') || 'leaderboard';

  // Fetch group info for the layout header
  const { data: groupData } = useQuery({
    queryKey: ['group', 'my'],
    queryFn: async () => {
      const res = await backendApi.getGroupInfo();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!currentUser,
    staleTime: 10 * 60 * 1000,
  });


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
        return <TitleSystem currentUser={currentUser} onRefresh={refresh} />;
      case 'profile':
        return <UserProfile user={currentUser} allUsers={users} onRunUpdated={onRunUpdated} />;
      case 'log-run':
        return <RunLogger onSubmit={onRunUpdated} users={users} />;
      default:
        return <Leaderboard users={users} currentUser={currentUser} />;
    }
  };

  return (
    <AppLayout groupName={groupData?.name ?? ''}>
      {activeTab === 'leaderboard' && <FeatureTour slug="tour_leaderboard_v1" steps={TOUR_LEADERBOARD_V1} />}
      {activeTab === 'titles' && <FeatureTour slug="tour_titles_v1" steps={TOUR_TITLES_V1} />}
      {activeTab === 'profile' && <FeatureTour slug="tour_profile_v1" steps={TOUR_PROFILE_V1} />}
      {renderContent()}
    </AppLayout>
  );
};

export default Index;
