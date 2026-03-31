import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { frontendLevelService } from '@/shared/services/levelService';
import { log } from '@/shared/utils/logger';
import { fetchOnboardingStatus } from '@/features/onboarding/onboardingApi';
import { ONBOARDING_QUERY_KEY, ONBOARDING_STALE_TIME } from '@/features/onboarding/hooks/useOnboarding';

export const useAppInit = () => {
  const qc = useQueryClient();

  useEffect(() => {
    frontendLevelService
      .initialize()
      .catch((error) => log.error('Failed to initialize level service', error));

    qc.prefetchQuery({
      queryKey: ONBOARDING_QUERY_KEY,
      queryFn: fetchOnboardingStatus,
      staleTime: ONBOARDING_STALE_TIME,
    }).catch(() => {/* not authenticated yet — silently ignore */});
  }, [qc]);
};
