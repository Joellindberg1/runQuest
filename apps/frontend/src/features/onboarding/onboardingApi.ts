// 🎓 Onboarding API — thin wrappers around /api/onboarding
import { backendApi } from '@/shared/services/backendApi';

const BASE = '/onboarding';

export async function fetchOnboardingStatus(): Promise<string[]> {
  const token = backendApi.getToken();
  const res = await fetch(
    `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}${BASE}/status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error('Failed to fetch onboarding status');
  const data = await res.json();
  return data.seen as string[];
}

export async function markOnboardingSeen(slug: string): Promise<void> {
  const token = backendApi.getToken();
  await fetch(
    `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}${BASE}/mark-seen`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug }),
    }
  );
}
