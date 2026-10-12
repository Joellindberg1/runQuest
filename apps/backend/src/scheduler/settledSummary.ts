import { logger } from '../utils/logger.js';

export interface SettledSummary {
  total: number;
  failed: number;
  succeeded: number;
}

/**
 * Sammanfattar ett Promise.allSettled-resultat. Förkastade löften är annars osynliga (allSettled kastar aldrig):
 * antalet fel loggas som error, med orsakerna som kontext, så att ett jobb där allt föll inte ser lyckat ut.
 */
export function summarizeSettled(label: string, results: PromiseSettledResult<unknown>[]): SettledSummary {
  const reasons = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  const summary: SettledSummary = { total: results.length, failed: reasons.length, succeeded: results.length - reasons.length };
  if (summary.failed > 0) {
    logger.error(`❌ ${label}: ${summary.failed} of ${summary.total} failed`, reasons);
  }
  return summary;
}
