// 🎓 OnboardingOrchestrator — processes the onboarding queue one item at a time
// Renders at app level. Shows patch notes, first-login tour, or nothing.
import React from 'react';
import { useOnboardingQueue } from '../hooks/useOnboardingQueue';
import { useOnboarding } from '../hooks/useOnboarding';
import { PatchNotesModal } from './PatchNotesModal';
import { OnboardingTour } from './OnboardingTour';
import { PATCH_NOTES } from '../patchNotes';
import { ONBOARDING_V1_STEPS } from '../onboardingSteps';

// Inner component: knows which slug to show, handles markSeen
function OnboardingItem({ slug }: { slug: string }) {
  const { markSeen } = useOnboarding(slug);

  // Patch note?
  const patchNote = PATCH_NOTES.find(n => n.slug === slug);
  if (patchNote) {
    return <PatchNotesModal note={patchNote} onClose={() => markSeen()} />;
  }

  // First-login tour?
  if (slug === 'onboarding_v1') {
    return <OnboardingTour steps={ONBOARDING_V1_STEPS} onDone={() => markSeen()} />;
  }

  // Unknown slug — mark as seen silently so queue advances
  markSeen();
  return null;
}

export function OnboardingOrchestrator() {
  const { currentItem, isLoading } = useOnboardingQueue();

  if (isLoading || !currentItem) return null;

  return <OnboardingItem key={currentItem} slug={currentItem} />;
}
