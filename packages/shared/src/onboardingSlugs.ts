// Onboarding-slugarna som sparas som "sett" per användare (user_seen_items). En källa för frontendens kö (features/onboarding/hooks/useOnboardingQueue.ts)
// och för e2e-stubben (apps/e2e/support/stubApi.ts), så en ny sidotur eller ett nytt prefix inte behöver skrivas på två ställen.
// Ändra aldrig en slug som redan släppts: den som sett den gamla slugen får annars turen igen (därför `_v2` i sidoturerna).

/** Förstagångsturen. Först i kön. */
export const ONBOARDING_TOUR_SLUG = 'onboarding_v1';

// Sidoturernas slugs, ett namn per sida. Sidan skickar sin konstant till `<FeatureTour slug=…>`, så sidan och kön kan inte glida isär.
export const LEADERBOARD_TOUR_SLUG = 'tour_leaderboard_v2';
export const TITLES_TOUR_SLUG = 'tour_titles_v2';
export const DUELS_TOUR_SLUG = 'tour_duels_v2';
export const EVENTS_TOUR_SLUG = 'tour_events_v2';
export const PROFILE_TOUR_SLUG = 'tour_profile_v2';
export const NEWS_TOUR_SLUG = 'tour_news_v2';

/** Sidoturerna i köns ordning. */
export const FEATURE_TOUR_SLUGS = [
  LEADERBOARD_TOUR_SLUG,
  TITLES_TOUR_SLUG,
  DUELS_TOUR_SLUG,
  EVENTS_TOUR_SLUG,
  PROFILE_TOUR_SLUG,
  NEWS_TOUR_SLUG,
] as const;

/** Slugarna som inte beror på changelog.json: förstagångsturen och sidoturerna. "What's new"-slugarna (`patch_v<version>`) kommer ur changelogen. */
export const FIXED_ONBOARDING_SLUGS: readonly string[] = [ONBOARDING_TOUR_SLUG, ...FEATURE_TOUR_SLUGS];

/** Prefixet på "What's new"-slugarna. */
export const PATCH_SLUG_PREFIX = 'patch_v';

/** Slugen som sparas som sett när användaren stängt "What's new" för en version. */
export const patchSlugForVersion = (version: string): string => `${PATCH_SLUG_PREFIX}${version}`;
