/**
 * The in-memory event store must claim like claim_strava_webhook_events (migration 046), or the worker's behaviour tests prove
 * nothing about the database. One test per RPC step; the real SQL is checked against PGlite in the critic's run.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryRunStore, createInMemoryWebhookStore } from '../inMemoryWebhookPorts.js';

const START = new Date('2026-10-14T12:00:00.000Z');
let clock = START;
const make = () => {
  clock = START;
  return createInMemoryWebhookStore({ now: () => clock });
};
const at = (seconds: number) => new Date(START.getTime() + seconds * 1000).toISOString();

describe('in-memory claim mirrors the claim RPC', () => {
  it('step 1: rejects a non-positive lease or batch size and changes nothing', async () => {
    const store = make();
    store.seed();

    await expect(store.claim(0, 25)).rejects.toMatchObject({ code: '22023' });
    await expect(store.claim(300, 0)).rejects.toMatchObject({ code: '22023' });
    await expect(store.claim(Number.NaN, 25)).rejects.toMatchObject({ code: '22023' });
    expect(store.row(1).status).toBe('pending');
  });

  it('step 1: two claims at once never return the same row', async () => {
    const store = make();
    for (let i = 0; i < 4; i += 1) store.seed({ owner_id: 5001 + (i % 2) });

    const [first, second] = await Promise.all([store.claim(300, 25), store.claim(300, 25)]);

    const ids = [...first, ...second].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.length + second.length).toBe(4);
    expect(new Set(first.map((row) => row.owner_id)).size).toBe(1);
    expect(new Set(second.map((row) => row.owner_id)).size).toBe(1);
  });

  it('step 2: an expired lease, or no lease, goes back to pending with one more attempt; a live lease stays', async () => {
    const store = make();
    store.seed({ status: 'processing', owner_id: 1, attempts: 0, claimed_at: at(-400), lease_expires_at: at(-1) });
    store.seed({ status: 'processing', owner_id: 2, attempts: 2, claimed_at: at(-400), lease_expires_at: null });
    store.seed({ status: 'processing', owner_id: 3, attempts: 0, claimed_at: at(-10), lease_expires_at: at(290), next_attempt_at: at(5000) });

    await store.claim(300, 25);

    const [expired, noLease, live] = store.rows();
    // The two released rows are due again and are claimed in the same call (owner 1 first, owner 2 has to wait for it).
    expect(expired).toMatchObject({ status: 'processing', attempts: 1, last_error: 'lease expired' });
    expect(noLease).toMatchObject({ status: 'pending', attempts: 3, last_error: 'lease expired', claimed_at: null, lease_expires_at: null });
    expect(live).toMatchObject({ status: 'processing', attempts: 0, lease_expires_at: at(290) });
  });

  it('step 3: the owner with the oldest due event goes first, ties broken by id, owners with a live lease skipped', async () => {
    const store = make();
    store.seed({ owner_id: 10, event_time: at(-10) });
    store.seed({ owner_id: 20, event_time: at(-30) });
    store.seed({ owner_id: 30, event_time: at(-30) });
    store.seed({ owner_id: 20, status: 'processing', claimed_at: at(-5), lease_expires_at: at(295), event_time: at(-50) });

    const first = await store.claim(300, 25);
    expect(first.map((row) => row.owner_id)).toEqual([30]); // 20 is busy; 30 and 10 compete and 30's event is older

    const second = await store.claim(300, 25);
    expect(second.map((row) => row.owner_id)).toEqual([10]);
    expect(await store.claim(300, 25)).toEqual([]);
  });

  it('step 3: takes at most p_max rows of that owner, oldest first, as processing with a lease', async () => {
    const store = make();
    for (let i = 0; i < 5; i += 1) store.seed({ owner_id: 7, event_time: at(-100 + i) });
    store.seed({ owner_id: 8, event_time: at(-1) });

    const claimed = await store.claim(120, 3);

    expect(claimed.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(claimed.every((row) => row.status === 'processing' && row.claimed_at === START.toISOString() && row.lease_expires_at === at(120))).toBe(true);
    expect(store.row(4).status).toBe('pending');
    expect(store.row(6).status).toBe('pending');
  });

  it('step 3: rows due in the future are not claimed', async () => {
    const store = make();
    store.seed({ next_attempt_at: at(60) });

    expect(await store.claim(300, 25)).toEqual([]);
    clock = new Date(START.getTime() + 61_000);
    expect(await store.claim(300, 25)).toHaveLength(1);
  });
});

describe('in-memory status writes', () => {
  it('only touch a row that is still processing', async () => {
    const store = make();
    store.seed();
    store.seed();
    const [first] = await store.claim(300, 1);

    expect(await store.markDone(first, 'noop', START)).toBe(true);
    expect(await store.markDone(first, 'noop', START)).toBe(false);
    expect(await store.markDone(store.row(2), 'noop', START)).toBe(false);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop', claimed_at: null, lease_expires_at: null });
    expect(store.row(2).status).toBe('pending');
  });

  it('drop a late write from an old claim once the row has been claimed again', async () => {
    const store = make();
    store.seed();
    const [oldClaim] = await store.claim(300, 25);
    clock = new Date(START.getTime() + 301_000);
    const [newClaim] = await store.claim(300, 25); // the lease ran out: back to pending, attempts + 1, claimed again

    expect(newClaim.claimed_at).not.toBe(oldClaim.claimed_at);
    expect(await store.markDone(oldClaim, 'imported', clock)).toBe(false);
    expect(await store.release(oldClaim, { attempts: 9, nextAttemptAt: clock, lastError: 'late' })).toBe(false);
    expect(store.row(1)).toMatchObject({ status: 'processing', attempts: 1, claimed_at: newClaim.claimed_at });
    expect(await store.markDone(newClaim, 'imported', clock)).toBe(true);
  });
});

describe('in-memory run store removal mirrors the adapter', () => {
  const stravaRow = { source: 'strava', date: '2026-10-11', distance: 5 } as never;

  it('removes only the Strava run of that user and activity and reports its date', async () => {
    const runs = createInMemoryRunStore();
    runs.runs.push(
      { userId: 'user-1', externalId: '1', date: '2026-10-11', run: stravaRow },
      { userId: 'user-1', externalId: '2', date: '2026-10-12', run: stravaRow },
      { userId: 'user-2', externalId: '1', date: '2026-10-11', run: stravaRow },
    );

    expect(await runs.removeStravaRun('user-1', '1')).toEqual({ removed: true, date: '2026-10-11' });
    expect(runs.runs.map((run) => `${run.userId}:${run.externalId}`)).toEqual(['user-1:2', 'user-2:1']);
    expect(await runs.removeStravaRun('user-1', '1')).toEqual({ removed: false, date: null });
    expect(runs.removeCalls).toHaveLength(2);
  });

  it('never removes a manual run, or an entry that is not known to be a Strava run', async () => {
    const runs = createInMemoryRunStore();
    runs.runs.push(
      { userId: 'user-1', externalId: '1', date: '2026-10-11', run: { source: 'manual', date: '2026-10-11', distance: 5 } as never },
      { userId: 'user-1', externalId: '2', date: '2026-10-12' },
    );

    expect(await runs.removeStravaRun('user-1', '1')).toEqual({ removed: false, date: null });
    expect(await runs.removeStravaRun('user-1', '2')).toEqual({ removed: false, date: null });
    expect(runs.runs).toHaveLength(2);
  });

  it('fails when told to, like a database that is down', async () => {
    const runs = createInMemoryRunStore();
    runs.removeError = new Error('db down');
    await expect(runs.removeStravaRun('user-1', '1')).rejects.toThrow('db down');
  });
});
