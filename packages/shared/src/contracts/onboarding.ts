// API-kontrakt för GET /api/onboarding/status och POST /api/onboarding/mark-seen: slugarna användaren redan sett (förstagångsturen, "What's new"-popuper, sidoturer). Endast typer.

/** Svar för GET /api/onboarding/status. Notera: ingen `success`-kuvert, bara listan. */
export interface OnboardingStatusResponse {
  seen: string[];
}

/** Brödtext till POST /api/onboarding/mark-seen. Idempotent: samma slug igen ändrar inget. */
export interface OnboardingMarkSeenRequest {
  slug: string;
}

/** Svar för POST /api/onboarding/mark-seen. Notera: `ok`, inte `success` (äldre form, ADR 007 A2). */
export interface OnboardingMarkSeenResponse {
  ok: true;
}
