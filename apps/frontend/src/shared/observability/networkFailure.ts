import { errorMessage } from '@/shared/utils/staleChunkReload';

// Webbläsarnas meddelande när ett anrop inte fick något svar alls (backend nere, tappat nät, blockerat). Chrome, Firefox och Safari; Sentry 11
// lägger gärna till värdnamnet efteråt ("Failed to fetch (api.runquest.dev)").
const NO_RESPONSE_MESSAGE = /^(failed to fetch|networkerror when attempting to fetch resource|load failed)\b/i;

/**
 * Anrop utan svar rapporteras inte. När backenden ligger nere fångar varje anrops catch samma fel, och det blir en flod av identiska händelser
 * som inte säger något backendens egen övervakning inte redan säger. Svar med 5xx är något annat och rapporteras (se logHttpFailure).
 */
export function isNetworkFailure(error: unknown): boolean {
  return NO_RESPONSE_MESSAGE.test(errorMessage(error));
}
