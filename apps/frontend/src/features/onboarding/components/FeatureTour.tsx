// 🎓 FeatureTour — page-specific first-visit tour
// Fires once when user first visits a page, as soon as global queue
// (onboarding_v1, patch notes) has cleared. Feature tours are independent
// of each other — they don't wait for other page tours to complete.
import { useState, useLayoutEffect } from 'react';
import { useOnboarding } from '../hooks/useOnboarding';
import { useOnboardingQueue } from '../hooks/useOnboardingQueue';
import { OnboardingTour } from './OnboardingTour';
import type { TourStep } from './OnboardingTour';

/**
 * Attribute on <body> holding the number of page tours that are activated but maybe not yet running.
 * BadgeUpgradeHost reads it by name (importing it would make the badges feature depend on this component).
 */
const TOUR_PENDING_ATTR = 'data-rq-tour-pending';

function adjustPendingTours(delta: number) {
  const next = Math.max(0, Number(document.body.getAttribute(TOUR_PENDING_ATTR) ?? 0) + delta);
  if (next === 0) document.body.removeAttribute(TOUR_PENDING_ATTR);
  else document.body.setAttribute(TOUR_PENDING_ATTR, String(next));
}

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
  // Layout effect: the pending marker below must be up before the first paint, not a frame later.
  useLayoutEffect(() => {
    if (canShow && !active) setActive(true);
  }, [canShow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the shell a page tour is on its way from the moment it is activated — driver.js only adds
  // `driver-active` after delayMs, and in that gap the badge upgrade popup would flash up first.
  // A counter, so two tours mounted at once don't clear each other's marker.
  useLayoutEffect(() => {
    if (!active) return;
    adjustPendingTours(1);
    return () => adjustPendingTours(-1);
  }, [active]);

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
