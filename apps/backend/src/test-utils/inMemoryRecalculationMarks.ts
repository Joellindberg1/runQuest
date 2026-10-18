/**
 * In-memory version of the recalculation mark store (migration 057, RUN-322). Only for tests: server.ts never imports this folder.
 * It mirrors the SQL functions: `mark` is the upsert with least(from_date) and a version from a sequence (nextval), `clear` deletes only
 * when the version is the caller's. The real SQL is proved against PGlite; these rules are the same ones.
 */
import type { PendingMark, RecalculationMarkStore } from '../services/recalculationMarks/ports.js';

export interface InMemoryMarkStore extends RecalculationMarkStore {
  /** Copies of the rows, oldest mark first. */
  rows(): PendingMark[];
  /** Every call, in order, as 'mark:<user>:<date>', 'clear:<user>:<version>', 'list' or 'read:<user>'. */
  calls: string[];
  /** Set to make every call of that kind fail with this error (until cleared to null). */
  failMark: Error | null;
  failClear: Error | null;
  failRead: Error | null;
  /** Runs once, right after the next successful `mark` has written its row: lets a test write a newer mark "meanwhile". */
  afterNextMark: (() => Promise<void> | void) | null;
}

export function createInMemoryMarkStore(): InMemoryMarkStore {
  const table = new Map<string, { fromDate: string; version: number; seq: number }>();
  let seq = 0;
  // recalculation_mark_version_seq: one counter for all users that only goes up, so a version is never used twice, not even after the
  // row was cleared and written again (the ABA case: version + 1 on the row would start over at 1).
  let versionSequence = 0;

  const store: InMemoryMarkStore = {
    calls: [],
    failMark: null,
    failClear: null,
    failRead: null,
    afterNextMark: null,
    rows: () =>
      [...table.entries()].sort((a, b) => a[1].seq - b[1].seq).map(([userId, row]) => ({ userId, fromDate: row.fromDate, version: row.version })),
    async mark(userId, fromDate) {
      store.calls.push(`mark:${userId}:${fromDate}`);
      if (store.failMark) throw store.failMark;
      const existing = table.get(userId);
      versionSequence += 1;
      const version = versionSequence;
      seq += 1;
      table.set(userId, { fromDate: existing && existing.fromDate < fromDate ? existing.fromDate : fromDate, version, seq });
      const hook = store.afterNextMark;
      if (hook) {
        store.afterNextMark = null;
        await hook();
      }
      return version;
    },
    async clear(userId, version) {
      store.calls.push(`clear:${userId}:${version}`);
      if (store.failClear) throw store.failClear;
      const existing = table.get(userId);
      if (!existing || existing.version !== version) return false;
      table.delete(userId);
      return true;
    },
    async listPending(limit) {
      store.calls.push('list');
      if (store.failRead) throw store.failRead;
      return store.rows().slice(0, limit);
    },
    async read(userId) {
      store.calls.push(`read:${userId}`);
      if (store.failRead) throw store.failRead;
      const row = table.get(userId);
      return row ? { userId, fromDate: row.fromDate, version: row.version } : null;
    },
  };
  return store;
}
