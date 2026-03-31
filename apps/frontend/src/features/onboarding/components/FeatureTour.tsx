// 🎓 FeatureTour — page-specific first-visit tour
// Fires once when user first visits a page, as soon as global queue
// (onboarding_v1, patch notes) has cleared. Feature tours are independent
// of each other — they don't wait for other page tours to complete.
import { useState, useEffect } from 'react';
import { useOnboarding } from '../hooks/useOnboarding';
import { useOnboardingQueue } from '../hooks/useOnboardingQueue';
import { OnboardingTour } from './OnboardingTour';
import type { TourStep } from './OnboardingTour';

interface FeatureTourProps {
  slug: string;
  steps: TourStep[];
  delayMs?: number;
}

export function FeatureTour({ slug, steps, delayMs = 600 }: FeatureTourProps) {
  const { seen, markSeen } = useOnboarding(slug);
  const { currentItem, isLoading } = useOnboardingQueue();
  const [active, setActive] = useState(false);

  // Block only while a global item (onboarding_v1, patch note) is still pending.
  // Feature tours don't wait for each other — each page teaches itself independently.
  const blockedByGlobal = !isLoading && currentItem !== null && !currentItem.startsWith('tour_');
  const canShow = !seen && !isLoading && !blockedByGlobal;

  // Activate once. Using state (not a ref) so the tour survives parent re-renders
  // that happen during data loading — OnboardingTour stays mounted until onDone fires.
  useEffect(() => {
    if (canShow && !active) setActive(true);
  }, [canShow]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  return (
    <OnboardingTour
      steps={steps}
      onDone={() => {
        setActive(false);
        markSeen();
      }}
      delayMs={delayMs}
    />
  );
}
