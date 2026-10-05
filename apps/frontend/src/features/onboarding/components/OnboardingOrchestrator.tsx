// 🎓 OnboardingOrchestrator — processes the onboarding queue one item at a time
// Renders at app level. Shows patch notes, first-login tour, or nothing.
import React from 'react';
import { useOnboardingQueue } from '../hooks/useOnboardingQueue';
import { useOnboarding } from '../hooks/useOnboarding';
import { PatchNotesModal } from './PatchNotesModal';
import { OnboardingTour } from './OnboardingTour';
import { changelog } from '@/features/changelog/changelogData';
import { announcedNotes } from '@/features/changelog/changelogModel';
import { ONBOARDING_V1_STEPS } from '../onboardingSteps';

// Inner component: knows which slug to show, handles markSeen
function OnboardingItem({ slug }: { slug: string }) {
  const { markSeen } = useOnboarding(slug);

  const patchNote = announcedNotes(changelog.releases).find(n => n.slug === slug);
  const isKnownSlug = !!patchNote || slug === 'onboarding_v1' || slug.startsWith('tour_');

  // Truly unknown slug — mark as seen so queue advances (never call mutations during render).
  // Hooken körs ovillkorligt (rules-of-hooks); villkoret ligger inne i effekten.
  // markSeen (TanStack mutate) har stabil identitet, så effekten kör högst en gång per slug-instans.
  React.useEffect(() => {
    if (!isKnownSlug) markSeen();
  }, [isKnownSlug, markSeen]);

  // Patch note?
  if (patchNote) {
    return <PatchNotesModal note={patchNote} onClose={() => markSeen()} />;
  }

  // First-login tour — ankarna ägs av app-skalet (ADR 006 beslut 8)
  if (slug === 'onboarding_v1') {
    return (
      <OnboardingTour steps={ONBOARDING_V1_STEPS} onDone={() => markSeen()} />
    );
  }

  // Feature tour slug — handled by page-level FeatureTour, not by the orchestrator
  return null;
}

export function OnboardingOrchestrator() {
  const { currentItem, isLoading } = useOnboardingQueue();

  if (isLoading || !currentItem) return null;

  return <OnboardingItem key={currentItem} slug={currentItem} />;
}
