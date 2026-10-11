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

  // Sedd i den här sessionen även om sparningen misslyckas: kön ska gå vidare (ingen fastnad popup/tour). Servern har då inte sparat det,
  // så posten visas igen nästa gång — hellre en upprepning än en blockerad kö.
  // Saknas listan (cachen rensades vid logout/401 medan sparningen pågick) skrivs ingenting: ett [slug] skulle annars ge nästa användare en
  // sett-lista med bara den posten, cachad som "laddad" i 10 min.
  const remember = () => qc.setQueryData<string[]>(ONBOARDING_QUERY_KEY, prev => (prev && !prev.includes(slug) ? [...prev, slug] : prev));

  const { mutate: markSeen, isPending } = useMutation({
    mutationFn: () => markOnboardingSeen(slug),
    onSuccess: remember,
    onError: remember,
  });

  return {
    seen: seen.includes(slug),
    markSeen,
    isPending,
  };
}
