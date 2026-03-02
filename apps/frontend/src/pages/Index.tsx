import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Leaderboard } from '@/features/leaderboard';
import { RunLogger } from '@/features/runs';
import { UserProfile } from '@/features/profile';
import { TitleSystem } from '@/features/titles';
import { AppLayout } from '@/components/layout/AppLayout';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { useRunUpdates } from '@/features/runs/hooks/useRunUpdates';

const Index: React.FC = () => {
  const { users, currentUser, loading, refresh } = useLeaderboardData();
  const { onRunUpdated } = useRunUpdates(refresh);
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'leaderboard';

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
        return <TitleSystem users={users} />;
      case 'profile':
        return <UserProfile user={currentUser} allUsers={users} onRunUpdated={onRunUpdated} />;
      case 'log-run':
        return <RunLogger onSubmit={onRunUpdated} users={users} />;
      default:
        return <Leaderboard users={users} currentUser={currentUser} />;
    }
  };

  return (
    <AppLayout groupName="Göteborgsvarvet 2026">
      {renderContent()}
    </AppLayout>
  );
};

export default Index;
