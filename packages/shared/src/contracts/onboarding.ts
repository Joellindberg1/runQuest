// API-kontrakt för GET /api/onboarding/status: slugarna användaren redan sett (förstagångsturen, "What's new"-popuper, sidoturer). Endast typer.

/** Svar för GET /api/onboarding/status. Notera: ingen `success`-kuvert, bara listan. */
export interface OnboardingStatusResponse {
  seen: string[];
}
