// 🎓 OnboardingOrchestrator — processes the onboarding queue one item at a time
// Renders at app level. Shows patch notes, first-login tour, or nothing.
import React from 'react';
import { useOnboardingQueue } from '../hooks/useOnboardingQueue';
import { useOnboarding } from '../hooks/useOnboarding';
import { PatchNotesModal } from './PatchNotesModal';
import { OnboardingTour } from './OnboardingTour';
import { PATCH_NOTES } from '../patchNotes';
import { ONBOARDING_V1_STEPS } from '../onboardingSteps';
import { sidebarBridge } from '../sidebarBridge';

// Inner component: knows which slug to show, handles markSeen
function OnboardingItem({ slug }: { slug: string }) {
  const { markSeen } = useOnboarding(slug);

  // Patch note?
  const patchNote = PATCH_NOTES.find(n => n.slug === slug);
  if (patchNote) {
    return <PatchNotesModal note={patchNote} onClose={() => markSeen()} />;
  }

  // First-login tour — open sidebar on mobile so nav elements are visible
  if (slug === 'onboarding_v1') {
    return (
      <OnboardingTour
        steps={ONBOARDING_V1_STEPS}
        onDone={() => markSeen()}
        beforeStart={() => { if (window.innerWidth < 768) sidebarBridge.open(); }}
        afterEnd={() => { if (window.innerWidth < 768) sidebarBridge.close(); }}
      />
    );
  }

  // Feature tour slug — handled by page-level FeatureTour, not by the orchestrator
  if (slug.startsWith('tour_')) return null;

  // Truly unknown slug — mark as seen so queue advances (never call mutations during render)
  React.useEffect(() => { markSeen(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function OnboardingOrchestrator() {
  const { currentItem, isLoading } = useOnboardingQueue();

  if (isLoading || !currentItem) return null;

  return <OnboardingItem key={currentItem} slug={currentItem} />;
}
