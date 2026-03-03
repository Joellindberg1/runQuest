import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChallengesPage as ChallengesFeaturePage } from '@/features/challenges';
import { useChallengeData } from '@/features/challenges/hooks/useChallengeData';
import { useChallengeActions } from '@/features/challenges/hooks/useChallengeActions';
import { backendApi } from '@/shared/services/backendApi';
import { useAuth } from '@/features/auth';
import type { GroupMember } from '@/features/challenges/components/SendChallengeModal';

const ChallengesPage: React.FC = () => {
  const { user } = useAuth();

  // Fetch group info to get member names + challenge_active status
  const groupQuery = useQuery({
    queryKey: ['group', 'my'],
    queryFn: async () => {
      const res = await backendApi.getGroupInfo();
      if (!res.success) throw new Error(res.error);
      return res.data!;
    },
    staleTime: 5 * 60 * 1000,
  });

  const groupMembers: GroupMember[] = (groupQuery.data?.members ?? []).map(m => ({
    id: m.id,
    name: m.name,
    challenge_active: m.challenge_active ?? false,
  }));

  const {
    isLoading,
    allActiveChallenges,
    leaderboard,
    sentChallenge,
    receivedChallenges,
    tokens,
    boosts,
    history,
    stats,
  } = useChallengeData(groupMembers, user?.id ?? '');

  const { sendToken, acceptChallenge, declineChallenge } = useChallengeActions();

  if (isLoading || groupQuery.isLoading) {
    return (
      <AppLayout groupName={groupQuery.data?.name ?? ''}>
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
          Loading challenges...
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout groupName={groupQuery.data?.name ?? ''}>
      <ChallengesFeaturePage
        currentUserId={user?.id ?? ''}
        leaderboard={leaderboard}
        allActiveChallenges={allActiveChallenges}
        sentChallenge={sentChallenge}
        receivedChallenges={receivedChallenges}
        tokens={tokens}
        allHistory={history}
        boosts={boosts}
        stats={stats}
        groupMembers={groupMembers}
        onSendToken={sendToken}
        onAccept={acceptChallenge}
        onDecline={declineChallenge}
      />
    </AppLayout>
  );
};

export default ChallengesPage;
