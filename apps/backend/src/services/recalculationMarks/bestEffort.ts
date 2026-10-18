// The two calls of the mark store that must never stop their caller: the mark written by a caller that has its own way to finish (the
// disconnect), and the clear after a recalculation that worked (a clear that fails leaves a mark the recovery job repeats once, which
// is harmless). A caller that must NOT go on without a mark (the nightly reconcile's deletions) calls store.mark itself and lets it throw.
//
// Logging: our user id, what failed and the error code. Never an error message.
import { errorCode } from '../../utils/errorCode.js';
import { logger } from '../../utils/logger.js';
import type { RecalculationMarkStore } from './ports.js';

/** Writes the mark; returns its version, or null when it could not be written (logged). */
export async function tryMark(store: RecalculationMarkStore, userId: string, fromDate: string, who: string): Promise<number | null> {
  try {
    return await store.mark(userId, fromDate);
  } catch (error) {
    logger.warn(`⚠️ ${who}: the recalculation mark of user ${userId} could not be written (${errorCode(error)}); carrying on without it`);
    return null;
  }
}

/** Clears the mark of this version (a newer mark stays). A failure is logged and swallowed. */
export async function tryClear(store: RecalculationMarkStore, userId: string, version: number, who: string): Promise<void> {
  try {
    await store.clear(userId, version);
  } catch (error) {
    logger.warn(`⚠️ ${who}: the recalculation mark of user ${userId} could not be cleared (${errorCode(error)}); the recovery job repeats the recalculation once`);
  }
}
