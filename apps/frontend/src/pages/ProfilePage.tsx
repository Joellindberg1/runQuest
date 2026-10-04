import React from 'react';
import { UserProfile } from '@/features/profile/components/UserProfile';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_PROFILE_V1 } from '@/features/onboarding/featureTourSteps';
import { WithLeaderboardData } from './WithLeaderboardData';

// /profile — den gamla profilskärmen tills inkrement 8.
const ProfilePage: React.FC = () => (
  <WithLeaderboardData>
    {({ users, currentUser, onRunUpdated }) => (
      <>
        <FeatureTour slug="tour_profile_v1" steps={TOUR_PROFILE_V1} />
        <UserProfile user={currentUser} allUsers={users} onRunUpdated={onRunUpdated} />
      </>
    )}
  </WithLeaderboardData>
);

export default ProfilePage;
