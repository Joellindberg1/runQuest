import React from 'react';
import { Leaderboard } from '@/features/leaderboard/components/Leaderboard';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_LEADERBOARD_V1 } from '@/features/onboarding/featureTourSteps';
import { WithLeaderboardData } from './WithLeaderboardData';

// /board — den gamla Leaderboard-skärmen tills inkrement 2.
const BoardPage: React.FC = () => (
  <WithLeaderboardData>
    {({ users, currentUser }) => (
      <>
        <FeatureTour slug="tour_leaderboard_v1" steps={TOUR_LEADERBOARD_V1} />
        <Leaderboard users={users} currentUser={currentUser} />
      </>
    )}
  </WithLeaderboardData>
);

export default BoardPage;
