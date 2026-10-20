// 🎓 Onboarding API — thin wrappers around /api/onboarding, via the shared client (token, base URL and the session-expiry path)
import type { OnboardingMarkSeenRequest, OnboardingStatusResponse } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';

const BASE = '/onboarding';

/**
 * Kastar när status inte går att hämta (ingen token, serverfel): ett tomt svar skulle annars cachas som "inget är sett" i 10 min
 * och spela om hela touren för någon som sett allt. Köhooken och prefetchen tolkar felet som "visa inget".
 */
export async function fetchOnboardingStatus(): Promise<string[]> {
  if (!backendApi.getToken()) throw new Error('Onboarding status needs a signed-in user');
  const res = await backendApi.authenticatedRequest<Partial<OnboardingStatusResponse>>(`${BASE}/status`);
  if (!res.success) throw new Error(`Onboarding status failed: ${res.error}`);
  return res.data.seen ?? [];
}

export async function markOnboardingSeen(slug: string): Promise<void> {
  const body: OnboardingMarkSeenRequest = { slug };
  const res = await backendApi.authenticatedRequest(`${BASE}/mark-seen`, { method: 'POST', body });
  if (!res.success) throw new Error(`Marking onboarding item as seen failed: ${res.error}`);
}
