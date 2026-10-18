// The port of the recalculation marks (migration 057, RUN-322): a persistent "this user needs a recalculation from date X", written
// BEFORE a change that needs one and cleared AFTER the recalculation worked. The real version is supabaseStore.ts; tests use
// test-utils/inMemoryRecalculationMarks.ts, which mirrors the SQL functions line by line.

/** One row of recalculation_marks. */
export interface PendingMark {
  userId: string;
  /** 'YYYY-MM-DD': the earliest date whose runs may have changed. Several marks of one user are one, with the earliest date. */
  fromDate: string;
  /** Goes up by one on every mark of the user. A clear that carries an older version does nothing. */
  version: number;
}

export interface RecalculationMarkStore {
  /**
   * mark_recalculation: an idempotent upsert, from_date = the earlier of the stored and the new date. Returns the new version.
   * THROWS on a database error (and on an answer that is not a version), so a mark that was not written can never be taken for one that was.
   */
  mark(userId: string, fromDate: string): Promise<number>;
  /**
   * clear_recalculation_mark: removes the mark only if its version is still `version`, that is if nothing has marked the user since the
   * caller got that version. Returns whether a row was removed; false = a newer mark (or none) stays. THROWS on a database error.
   */
  clear(userId: string, version: number): Promise<boolean>;
  /** The marks, oldest first, at most `limit`. THROWS on a database error. */
  listPending(limit: number): Promise<PendingMark[]>;
  /** The user's mark right now, or null. THROWS on a database error. */
  read(userId: string): Promise<PendingMark | null>;
}
