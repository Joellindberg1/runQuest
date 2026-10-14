import { describe, it, expect } from 'vitest';
import { activeLockKeyCount, ReentrantLockError, withKeyedLock, withUserLock } from '../keyedMutex.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets every promise callback that is already queued run, so "has not started" can be asserted without a timer.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('keyed mutex', () => {
  it('keyed mutex runs tasks for the same key one at a time in arrival order', async () => {
    const log: string[] = [];
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    const task = (name: keyof typeof gates) => async () => {
      log.push(`${name}:start`);
      await gates[name].promise;
      log.push(`${name}:end`);
    };

    const all = [withKeyedLock('k', task('a')), withKeyedLock('k', task('b')), withKeyedLock('k', task('c'))];
    await flush();
    expect(log).toEqual(['a:start']);

    // Releasing out of order must not let a later task jump the queue.
    gates.c.resolve();
    gates.b.resolve();
    await flush();
    expect(log).toEqual(['a:start']);

    gates.a.resolve();
    await Promise.all(all);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('keyed mutex runs tasks for different keys in parallel', async () => {
    const started: string[] = [];
    const gate = deferred();
    const task = (name: string) => async () => {
      started.push(name);
      await gate.promise;
      return name;
    };

    const both = Promise.all([withKeyedLock('x', task('x')), withKeyedLock('y', task('y'))]);
    await flush();
    expect(started.sort()).toEqual(['x', 'y']); // both started while neither had finished

    gate.resolve();
    expect(await both).toEqual(['x', 'y']);
  });

  it('keyed mutex releases the lock when a task throws', async () => {
    const boom = new Error('boom');
    const ran: string[] = [];

    const failing = withKeyedLock('k', async () => {
      ran.push('failing');
      throw boom;
    });
    const syncThrowing = withKeyedLock('k', () => {
      ran.push('syncThrowing');
      throw boom;
    });
    const after = withKeyedLock('k', async () => {
      ran.push('after');
      return 'ok';
    });

    await expect(failing).rejects.toBe(boom);
    await expect(syncThrowing).rejects.toBe(boom);
    await expect(after).resolves.toBe('ok');
    expect(ran).toEqual(['failing', 'syncThrowing', 'after']);
  });

  it('keyed mutex keeps no entry for an idle key', async () => {
    expect(activeLockKeyCount()).toBe(0);

    const gate = deferred();
    const first = withKeyedLock('k', () => gate.promise);
    const second = withKeyedLock('k', async () => 2);
    const other = withKeyedLock('other', async () => 3);
    expect(activeLockKeyCount()).toBe(2); // one entry per busy key, not per task

    gate.resolve();
    await Promise.all([first, second, other]);
    expect(activeLockKeyCount()).toBe(0);

    await expect(withKeyedLock('failed', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(activeLockKeyCount()).toBe(0);
  });

  it('keyed mutex passes the return value through unchanged', async () => {
    const value = { nested: [1, 2, 3] };
    await expect(withKeyedLock('k', async () => value)).resolves.toBe(value);
    await expect(withKeyedLock('k', () => 7)).resolves.toBe(7); // a synchronous fn works too
  });

  it('keyed mutex withUserLock uses the user id as the key', async () => {
    const gate = deferred();
    const order: string[] = [];
    const first = withUserLock('user-1', async () => { await gate.promise; order.push('first'); });
    const sameKey = withKeyedLock('user-1', async () => { order.push('second'); });
    await flush();
    expect(order).toEqual([]);
    gate.resolve();
    await Promise.all([first, sameKey]);
    expect(order).toEqual(['first', 'second']);
  });

  it('keyed mutex rejects a nested call for a held key instead of deadlocking', async () => {
    const result = withKeyedLock('k', async () => {
      await withKeyedLock('k', async () => 'never');
    });
    await expect(result).rejects.toBeInstanceOf(ReentrantLockError);
    expect(activeLockKeyCount()).toBe(0);
  });

  it('keyed mutex allows nesting for a different key and a call after the outer lock is released', async () => {
    let detached: Promise<string> | undefined;
    const outer = await withKeyedLock('outer', async () => {
      const inner = await withKeyedLock('inner', async () => 'inner');
      // Started inside the lock but run after it: the lock is not held then, so this is not a nested call.
      detached = (async () => {
        await flush();
        return withKeyedLock('outer', async () => 'later');
      })();
      return inner;
    });
    expect(outer).toBe('inner');
    await expect(detached).resolves.toBe('later');
  });

  it('keyed mutex rejects a nested lock on a key held further up the chain', async () => {
    // Without the chain walk this is a silent deadlock, so a hang must fail the test instead of the run.
    const guard = <T>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hung: nested lock was not detected')), 500)),
      ]);

    const chain = withKeyedLock('A', () =>
      withKeyedLock('B', () => withKeyedLock('A', async () => 'never')),
    );
    await expect(guard(chain)).rejects.toBeInstanceOf(ReentrantLockError);
    expect(activeLockKeyCount()).toBe(0);

    // The same key twice in sequence inside another key's lock is not nesting: the first has been released.
    const sequence = withKeyedLock('A', async () => {
      const first = await withKeyedLock('B', async () => 'first');
      const second = await withKeyedLock('B', async () => 'second');
      return [first, second];
    });
    await expect(guard(sequence)).resolves.toEqual(['first', 'second']);
    expect(activeLockKeyCount()).toBe(0);
  });

  it('keyed mutex keeps the queue intact when a new task arrives while a queued task runs', async () => {
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    const task = (name: keyof typeof gates) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`${name}:start`);
      await gates[name].promise;
      log.push(`${name}:end`);
      running -= 1;
    };

    const a = withKeyedLock('k', task('a'));
    const b = withKeyedLock('k', task('b'));
    gates.a.resolve();
    await a;
    await flush();
    expect(log).toEqual(['a:start', 'a:end', 'b:start']); // b runs now, and a's cleanup has already happened

    const c = withKeyedLock('k', task('c')); // arrives while b is running
    await flush();
    expect(log).toEqual(['a:start', 'a:end', 'b:start']); // c waits for b

    gates.b.resolve();
    await b;
    gates.c.resolve();
    await c;

    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(maxRunning).toBe(1);
    expect(activeLockKeyCount()).toBe(0);
  });

  it('keyed mutex keeps the key blocked while a task is hanging and frees it when the task settles', async () => {
    const hang = deferred<string>();
    const hanging = withKeyedLock('k', () => hang.promise);
    let waiterRan = false;
    const waiter = withKeyedLock('k', async () => { waiterRan = true; });
    await flush();
    await flush();
    expect(waiterRan).toBe(false); // there is deliberately no timeout: a task that never settles blocks its key

    hang.resolve('done');
    await expect(hanging).resolves.toBe('done');
    await waiter;
    expect(waiterRan).toBe(true);
  });
});
