// Onboarding-slugarna som sparas som "sett" per användare (user_seen_items). En källa för frontendens kö (features/onboarding/hooks/useOnboardingQueue.ts)
// och för e2e-stubben (apps/e2e/support/stubApi.ts), så en ny sidotur eller ett nytt prefix inte behöver skrivas på två ställen.
// Ändra aldrig en slug som redan släppts: den som sett den gamla slugen får annars turen igen (därför `_v2` i sidoturerna).

/** Förstagångsturen. Först i kön. */
export const ONBOARDING_TOUR_SLUG = 'onboarding_v1';

/** Sidoturerna i köns ordning. Varje sida visar sin egen tur med samma slug (`<FeatureTour slug=…>`). */
export const FEATURE_TOUR_SLUGS = [
  'tour_leaderboard_v2',
  'tour_titles_v2',
  'tour_duels_v2',
  'tour_events_v2',
  'tour_profile_v2',
  'tour_news_v2',
] as const;

/** Slugarna som inte beror på changelog.json: förstagångsturen och sidoturerna. "What's new"-slugarna (`patch_v<version>`) kommer ur changelogen. */
export const FIXED_ONBOARDING_SLUGS: readonly string[] = [ONBOARDING_TOUR_SLUG, ...FEATURE_TOUR_SLUGS];

/** Prefixet på "What's new"-slugarna. */
export const PATCH_SLUG_PREFIX = 'patch_v';

/** Slugen som sparas som sett när användaren stängt "What's new" för en version. */
export const patchSlugForVersion = (version: string): string => `${PATCH_SLUG_PREFIX}${version}`;
