/**
 * Provtagningstalet för prestandaspårningen (RUN-287), EN källa för backend och frontend.
 *
 * Taket 0,1 kommer från storyn (inom Sentrys gratisnivå). Miljövariabeln (SENTRY_TRACES_SAMPLE_RATE i backend,
 * VITE_SENTRY_TRACES_SAMPLE_RATE i frontend) kan bara sänka talet, aldrig höja det över taket; 0 stänger av spårningen.
 */
export const MAX_TRACES_SAMPLE_RATE = 0.1;
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/** Ett tal inom 0 till taket. Något som inte är ett ändligt tal ger standarden. */
export function clampTracesSampleRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRACES_SAMPLE_RATE;
  return Math.min(Math.max(value, 0), MAX_TRACES_SAMPLE_RATE);
}

/** Provtagningstalet ur en miljövariabel. Saknat, tomt eller ogiltigt värde ger standarden. */
export function tracesSampleRateOf(raw: string | undefined): number {
  const text = raw?.trim();
  if (!text) return DEFAULT_TRACES_SAMPLE_RATE;
  return clampTracesSampleRate(Number(text));
}
