// calculateUserTotals never throws: it catches and logs everything, and says whether the users row was written by RETURNING true or false.
// A recalculation that is to be recoverable (a mark that is cleared only when it worked) must therefore read the answer and turn a false into
// an error of its own, or a failed totals run looks like a successful one and the mark is cleared for nothing.
import { errorWithCode } from '../../utils/errorCode.js';

/** The code a recalculation fails with when the totals were not written. Logged as it is; never a message. */
export const TOTALS_NOT_WRITTEN = 'totals_not_written';

/** Throws when `written` is an explicit false (Recompute.recalculateTotals, calculateUserTotals). Anything else, true or a test fake's nothing, passes. */
export function assertTotalsWritten(written: unknown): void {
  if (written === false) throw errorWithCode('the totals were not written', { code: TOTALS_NOT_WRITTEN });
}
