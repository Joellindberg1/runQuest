import React from 'react';
import { ChallengesPage as ChallengesFeaturePage } from '@/features/challenges/components/ChallengesPage';
import { useChallengeData } from '@/features/challenges/hooks/useChallengeData';
import { useChallengeActions } from '@/features/challenges/hooks/useChallengeActions';
import { useAuth } from '@/providers/authContext';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_CHALLENGES_V1 } from '@/features/onboarding/featureTourSteps';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';

// /duels (tidigare /challenges). Innehållet är den befintliga challenges-skärmen tills inkrement 5.
const DuelsPage: React.FC = () => {
  const { user } = useAuth();

  const {
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
  } = useChallengeData(user?.id ?? '');

  const { sendToken, acceptChallenge, declineChallenge, withdrawChallenge } = useChallengeActions();

  if (isLoading) return <SkeletonRows rows={5} label="Loading duels" />;

  return (
    <>
      <FeatureTour slug="tour_challenges_v1" steps={TOUR_CHALLENGES_V1} />
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
        onWithdraw={withdrawChallenge}
      />
    </>
  );
};

export default DuelsPage;
