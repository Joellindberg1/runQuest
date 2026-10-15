import { describe, expect, it } from 'vitest';
import { ONBOARDING_V1_STEPS, onboardingStepsFor } from './onboardingSteps';

const STRAVA_ANCHOR = '[data-tour="right-now-strava"]';

describe('onboardingStepsFor', () => {
  it('a user with Strava connected gets no Connect Strava step, and every other step is unchanged', () => {
    const steps = onboardingStepsFor(true);

    expect(steps.some((step) => step.element === STRAVA_ANCHOR)).toBe(false);
    expect(steps.map((step) => step.title)).not.toContain('Connect Strava');
    expect(steps).toEqual(ONBOARDING_V1_STEPS.filter((step) => step.element !== STRAVA_ANCHOR));
    expect(steps).toHaveLength(ONBOARDING_V1_STEPS.length - 1);
  });

  it('a user without Strava gets the Connect Strava step on the right-now-strava anchor, with its copy as before', () => {
    const step = onboardingStepsFor(false).find((candidate) => candidate.element === STRAVA_ANCHOR);

    expect(step).toEqual({
      element: STRAVA_ANCHOR,
      title: 'Connect Strava',
      description: 'Link Strava once and all your runs sync automatically — no manual logging needed. Settings → Strava to connect.',
    });
    expect(onboardingStepsFor(false)).toHaveLength(ONBOARDING_V1_STEPS.length);
  });

  it('an unknown status (the fetch failed) keeps the step', () => {
    expect(onboardingStepsFor(undefined)).toHaveLength(ONBOARDING_V1_STEPS.length);
  });
});
