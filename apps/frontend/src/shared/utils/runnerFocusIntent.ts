/** Hur länge en avsikt gäller: tillräckligt för att navigeringen och ritningen ska hinna, och sedan förfaller den om ingen sida tog den. */
export const FOCUS_INTENT_TTL_MS = 2000;

let pending: { runnerId: string; expiresAt: number } | null = null;

/**
 * En kortlivad avsikt i minnet: "fokusera löparens rad på sidan jag nu navigerar till". Används när navigeringen är ett steg bakåt (`navigate(-1)`), som inte kan bära route-state på
 * den post den landar på. Skalet (`useRestoreRunnerFocus`) tar avsikten vid nästa platsbyte.
 */
export function requestRunnerFocus(runnerId: string): void {
  pending = { runnerId, expiresAt: Date.now() + FOCUS_INTENT_TTL_MS };
}

/** Hämtar och rensar avsikten; null om den saknas eller har förfallit. */
export function takeRunnerFocus(): string | null {
  const intent = pending;
  pending = null;
  return intent !== null && intent.expiresAt >= Date.now() ? intent.runnerId : null;
}
