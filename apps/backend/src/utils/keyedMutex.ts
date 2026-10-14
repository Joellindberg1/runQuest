/**
 * In-process mutex per key (ADR 010 decision 6). The key is a user id in practice: polling, the webhook batch and the
 * disconnect for one user must never overlap, because Strava runs leave no tombstone and a poll that listed Strava before a
 * deletion and inserts after it would bring the deleted run back.
 *
 * Guarantees: FIFO per key, different keys run in parallel, the lock is released however `fn` ends, the return value and the
 * error of `fn` pass through unchanged, and an idle key leaves no entry behind.
 *
 * Limits, on purpose:
 * - One process. With more than one backend replica the lock does not hold (ADR 010 revisit trigger: a database lease).
 * - Not reentrant. A task holding a key that awaits another task on the same key would wait for itself forever; such a nested
 *   call is rejected with `ReentrantLockError` instead of deadlocking. Callers must not nest; take the lock at the outermost
 *   entry point and call the unlocked inner functions from there.
 * - No timeout. A timeout cannot cancel `fn`, so it would only let a second task run next to one that is still working, which
 *   is exactly the overlap the lock exists to prevent. A task that never settles blocks its key until the process restarts.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export class ReentrantLockError extends Error {
  constructor(public readonly key: string) {
    super(`Nested lock request for key "${key}" from inside a task that already holds it`);
    this.name = 'ReentrantLockError';
  }
}

// One frame per task that holds a key; `released` keeps a task that was spawned inside the lock but outlives it from being
// mistaken for a nested call.
interface HeldLock {
  key: string;
  released: boolean;
  parent: HeldLock | undefined;
}

const held = new AsyncLocalStorage<HeldLock>();

// The tail of each busy key's queue. It never rejects, so a failed task cannot poison the ones behind it.
const tails = new Map<string, Promise<void>>();

function holdsKey(key: string): boolean {
  for (let frame = held.getStore(); frame; frame = frame.parent) {
    if (frame.key === key && !frame.released) return true;
  }
  return false;
}

export function withKeyedLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  if (holdsKey(key)) return Promise.reject(new ReentrantLockError(key));

  const previous = tails.get(key) ?? Promise.resolve();
  const parent = held.getStore();
  const run = previous.then(() => {
    const frame: HeldLock = { key, released: false, parent };
    return held.run(frame, async () => {
      try {
        return await fn();
      } finally {
        frame.released = true;
      }
    });
  });

  // Registered before `run` is handed to the caller, so the entry is gone by the time the caller's `await` continues.
  const release = () => {
    if (tails.get(key) === tail) tails.delete(key);
  };
  const tail: Promise<void> = run.then(release, release);
  tails.set(key, tail);
  return run;
}

export function withUserLock<T>(userId: string, fn: () => Promise<T> | T): Promise<T> {
  return withKeyedLock(userId, fn);
}

/** Number of keys that currently have a task running or queued. For tests: it must be 0 when nothing is in flight. */
export function activeLockKeyCount(): number {
  return tails.size;
}
