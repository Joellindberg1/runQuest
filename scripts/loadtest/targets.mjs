// Lasttestets mål, nedskrivna FÖRE första körningen (docs/loadtest.md, "Mål"). Ändra dem inte för att få en körning att gå grönt:
// ändra dem bara med en motivering i docs/loadtest.md och i commit-meddelandet.

export const TARGETS = {
  /** Samtidiga användare. Dagens grupper har drygt tio medlemmar; 20 är ungefär dubbelt så mycket som en riktig topptimme. */
  concurrentUsers: 20,
  /** Hur länge belastningen står på. */
  durationSeconds: 120,
  /** Andel misslyckade anrop (5xx, andra 4xx än 429, nätverksfel, timeout, omdirigering) av alla anrop. */
  maxErrorRate: 0.01,
  /** Antal 429-svar. Noll: ett 429 betyder att provet överskred en gräns som används som skydd, vilket är ett fynd. */
  maxRateLimited: 0,
  /** p95 per scenario i millisekunder, mätt hos klienten (inklusive nätverket mellan provkörarens dator och Railway). */
  p95Ms: {
    login: 1500,
    leaderboard: 800,
    news: 800,
    'log-run': 3000,
  },
};

/** Sant för en körning som är stor nog att räknas som mätningen. Mindre körningar är rökprov. */
export function isMeasurementRun(config) {
  return config.vus >= TARGETS.concurrentUsers && config.durationSeconds >= TARGETS.durationSeconds;
}

/** Scenariernas vikt i blandningen (heltal, summan spelar ingen roll). Inloggning och rundloggning begränsas dessutom av var sin budget. */
export const SCENARIO_WEIGHTS = {
  leaderboard: 45,
  news: 40,
  'log-run': 10,
  login: 5,
};
