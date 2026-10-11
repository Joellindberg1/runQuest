import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLevelRequirements } from '@/shared/hooks/useLevelRequirements';
import { fetchOnboardingStatus } from '@/features/onboarding/onboardingApi';
import { ONBOARDING_QUERY_KEY, ONBOARDING_STALE_TIME } from '@/features/onboarding/hooks/useOnboarding';

export const useAppInit = () => {
  const qc = useQueryClient();

  // Nivåtabellen hämtas när en användare finns (även efter SPA-inloggning); utloggad gör hooken inget anrop.
  useLevelRequirements();

  useEffect(() => {
    qc.prefetchQuery({
      queryKey: ONBOARDING_QUERY_KEY,
      queryFn: fetchOnboardingStatus,
      staleTime: ONBOARDING_STALE_TIME,
    }).catch(() => {/* not authenticated yet — silently ignore */});
  }, [qc]);
};
