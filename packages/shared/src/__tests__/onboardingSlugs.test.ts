import { describe, expect, it } from 'vitest';
import { FEATURE_TOUR_SLUGS, FIXED_ONBOARDING_SLUGS, ONBOARDING_TOUR_SLUG, PATCH_SLUG_PREFIX, patchSlugForVersion } from '../onboardingSlugs.js';

describe('onboarding slugs', () => {
  it('the patch slug is the prefix followed by the version', () => {
    expect(patchSlugForVersion('0.8.1')).toBe(`${PATCH_SLUG_PREFIX}0.8.1`);
    expect(patchSlugForVersion('0.8.1')).toBe('patch_v0.8.1');
  });

  it('every side tour slug starts with tour_ and none repeats', () => {
    for (const slug of FEATURE_TOUR_SLUGS) expect(slug.startsWith('tour_')).toBe(true);
    expect(new Set(FEATURE_TOUR_SLUGS).size).toBe(FEATURE_TOUR_SLUGS.length);
  });

  it('the fixed slugs are the first-login tour followed by the side tours', () => {
    expect(FIXED_ONBOARDING_SLUGS).toEqual([ONBOARDING_TOUR_SLUG, ...FEATURE_TOUR_SLUGS]);
  });
});
