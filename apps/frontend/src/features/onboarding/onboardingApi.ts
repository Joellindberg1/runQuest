// 🎓 Onboarding API — thin wrappers around /api/onboarding
import type { OnboardingMarkSeenRequest, OnboardingStatusResponse } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';

const BASE = '/onboarding';

/**
 * Kastar när status inte går att hämta (ingen token, serverfel): ett tomt svar skulle annars cachas som "inget är sett" i 10 min
 * och spela om hela touren för någon som sett allt. Köhooken och prefetchen tolkar felet som "visa inget".
 */
export async function fetchOnboardingStatus(): Promise<string[]> {
  const token = backendApi.getToken();
  if (!token) throw new Error('Onboarding status needs a signed-in user');
  const res = await fetch(
    `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}${BASE}/status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Onboarding status failed (${res.status})`);
  const data = (await res.json()) as Partial<OnboardingStatusResponse>;
  return data.seen ?? [];
}

export async function markOnboardingSeen(slug: string): Promise<void> {
  const token = backendApi.getToken();
  const res = await fetch(
    `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}${BASE}/mark-seen`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug } satisfies OnboardingMarkSeenRequest),
    }
  );
  if (!res.ok) throw new Error(`Marking onboarding item as seen failed (${res.status})`);
}
