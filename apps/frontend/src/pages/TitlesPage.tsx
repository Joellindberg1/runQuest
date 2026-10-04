import React from 'react';
import { TitleSystem } from '@/features/titles/components/TitleSystem';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_TITLES_V1 } from '@/features/onboarding/featureTourSteps';
import { WithLeaderboardData } from './WithLeaderboardData';

// /titles — den gamla TitleSystem-skärmen tills inkrement 4.
const TitlesPage: React.FC = () => (
  <WithLeaderboardData>
    {({ currentUser, refresh }) => (
      <>
        <FeatureTour slug="tour_titles_v1" steps={TOUR_TITLES_V1} />
        <TitleSystem currentUser={currentUser} onRefresh={refresh} />
      </>
    )}
  </WithLeaderboardData>
);

export default TitlesPage;
