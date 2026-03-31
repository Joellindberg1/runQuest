// 🎓 useOnboardingQueue — priority queue for onboarding items
// Priority order: onboarding_v1 → patch notes → feature tours
// Only one item is surfaced at a time. Next item appears after markSeen.
import { useQuery } from '@tanstack/react-query';
import { ONBOARDING_QUERY_KEY, ONBOARDING_STALE_TIME } from './useOnboarding';
import { fetchOnboardingStatus } from '../onboardingApi';
import { PATCH_NOTES } from '../patchNotes';

// All active onboarding slugs in priority order.
// Add new slugs here when features/tours are introduced.
function buildQueue(): string[] {
  const queue: string[] = [];

  // 1. First-login onboarding tour
  queue.push('onboarding_v1');

  // 2. Patch notes — most recent first
  for (const note of [...PATCH_NOTES].reverse()) {
    queue.push(note.slug);
  }

  // 3. Feature tours (added as they're built)
  // queue.push('tour_events_v1');
  // queue.push('tour_challenges_v1');

  return queue;
}

export function useOnboardingQueue() {
  const { data: seen = [], isLoading, isError } = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: fetchOnboardingStatus,
    staleTime: ONBOARDING_STALE_TIME,
    retry: false,
  });

  // Never block the app — if onboarding status can't be fetched, skip silently
  if (isLoading || isError) return { currentItem: null, isLoading };

  const queue = buildQueue();
  const currentItem = queue.find(slug => !seen.includes(slug)) ?? null;

  return { currentItem, isLoading: false };
}
