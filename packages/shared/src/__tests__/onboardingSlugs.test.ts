import { describe, expect, it } from 'vitest';
import {
  DUELS_TOUR_SLUG,
  EVENTS_TOUR_SLUG,
  FEATURE_TOUR_SLUGS,
  FIXED_ONBOARDING_SLUGS,
  LEADERBOARD_TOUR_SLUG,
  NEWS_TOUR_SLUG,
  ONBOARDING_TOUR_SLUG,
  PATCH_SLUG_PREFIX,
  PROFILE_TOUR_SLUG,
  TITLES_TOUR_SLUG,
  patchSlugForVersion,
} from '../onboardingSlugs.js';

describe('onboarding slugs', () => {
  it('the patch slug is the prefix followed by the version', () => {
    expect(patchSlugForVersion('0.8.1')).toBe(`${PATCH_SLUG_PREFIX}0.8.1`);
    expect(patchSlugForVersion('0.8.1')).toBe('patch_v0.8.1');
  });

  it('every side tour slug starts with tour_ and none repeats', () => {
    for (const slug of FEATURE_TOUR_SLUGS) expect(slug.startsWith('tour_')).toBe(true);
    expect(new Set(FEATURE_TOUR_SLUGS).size).toBe(FEATURE_TOUR_SLUGS.length);
  });

  it('every named side tour slug is in FEATURE_TOUR_SLUGS, in the queue order', () => {
    const named = [LEADERBOARD_TOUR_SLUG, TITLES_TOUR_SLUG, DUELS_TOUR_SLUG, EVENTS_TOUR_SLUG, PROFILE_TOUR_SLUG, NEWS_TOUR_SLUG];
    for (const slug of named) expect(FEATURE_TOUR_SLUGS).toContain(slug);
    expect([...FEATURE_TOUR_SLUGS]).toEqual(named);
  });

  it('the fixed slugs are the first-login tour followed by the side tours', () => {
    expect(FIXED_ONBOARDING_SLUGS).toEqual([ONBOARDING_TOUR_SLUG, ...FEATURE_TOUR_SLUGS]);
  });
});
