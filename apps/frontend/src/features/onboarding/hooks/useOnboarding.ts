// 🎓 useOnboarding — checks and marks a single onboarding slug
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOnboardingStatus, markOnboardingSeen } from '../onboardingApi';

export const ONBOARDING_QUERY_KEY = ['onboarding-status'];
export const ONBOARDING_STALE_TIME = 10 * 60 * 1000; // 10 min

export function useOnboarding(slug: string) {
  const qc = useQueryClient();

  const { data: seen = [] } = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: fetchOnboardingStatus,
    staleTime: ONBOARDING_STALE_TIME,
    retry: false,
  });

  const { mutate: markSeen, isPending } = useMutation({
    mutationFn: () => markOnboardingSeen(slug),
    onSuccess: () => {
      qc.setQueryData<string[]>(ONBOARDING_QUERY_KEY, prev =>
        prev ? [...prev, slug] : [slug]
      );
    },
  });

  return {
    seen: seen.includes(slug),
    markSeen,
    isPending,
  };
}
