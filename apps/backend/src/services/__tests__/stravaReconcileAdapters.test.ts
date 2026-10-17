/**
 * The real ports of the nightly reconcile (services/stravaReconcile/adapters.ts): the queries against createFakeDb and the activity
 * list against the fake Strava. The rules that use them are in stravaReconcile.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createReconcilePorts } from '../stravaReconcile/adapters.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaActivity, stravaError, type FakeStrava, type FakeStravaRoutes } from '../../test-utils/fakeStrava.js';

let strava: FakeStrava | undefined;
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});
beforeEach(() => vi.clearAllMocks());

function database(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

describe('reconcile ports: users', () => {
  it('lists every connected user with the pause flag, and nobody without a token', async () => {
    database({
      strava_tokens: [
        { user_id: 'b', access_token: 'x', sync_paused: false },
        { user_id: 'a', access_token: 'x', sync_paused: true },
        { user_id: 'c', access_token: null, sync_paused: false },
      ],
    });

    const users = await createReconcilePorts().listConnectedUsers();

    expect(users).toEqual([
      { userId: 'a', syncPaused: true },
      { userId: 'b', syncPaused: false },
    ]);
  });

  it('counts a pause flag that is not a plain false as paused', async () => {
    database({ strava_tokens: [{ user_id: 'a', access_token: 'x', sync_paused: null }, { user_id: 'b', access_token: 'x' }] });

    const users = await createReconcilePorts().listConnectedUsers();

    expect(users.map((user) => user.syncPaused)).toEqual([true, true]);
  });

  it('reads past the first page of rows', async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => ({ user_id: `u${String(i).padStart(5, '0')}`, access_token: 'x', sync_paused: false }));
    database({ strava_tokens: rows });

    const users = await createReconcilePorts().listConnectedUsers();

    expect(users).toHaveLength(2300);
  });

  it('throws with the database code only when the users cannot be read', async () => {
    database({ strava_tokens: [] }, { errors: { strava_tokens: { code: '57014', message: 'a message with user-1 and a secret' } } });

    const failure = await createReconcilePorts().listConnectedUsers().catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe('57014');
    expect(failure.message).not.toContain('secret');
  });
});

describe('reconcile ports: runs', () => {
  const run = (over: Row): Row => ({ user_id: 'user-1', source: 'strava', external_id: '1', date: '2026-10-01', distance: 5, ...over });

  it('lists the user\'s Strava runs, oldest first, and no manual run and no one else\'s', async () => {
    database({
      runs: [
        run({ id: 'r3', external_id: '3', date: '2026-10-03' }),
        run({ id: 'r1', external_id: '1', date: '2026-10-01' }),
        run({ id: 'r2', external_id: '2', date: '2026-10-02', distance: '7.25' }),
        run({ id: 'm1', external_id: null, source: 'manual' }),
        run({ id: 'm2', external_id: '9', source: 'manual' }),
        run({ id: 'o1', external_id: '8', user_id: 'user-2' }),
      ],
    });

    const runs = await createReconcilePorts().listStravaRuns('user-1');

    expect(runs).toEqual([
      { externalId: '1', date: '2026-10-01', distance: 5 },
      { externalId: '2', date: '2026-10-02', distance: 7.25 },
      { externalId: '3', date: '2026-10-03', distance: 5 },
    ]);
  });

  it('reads all of a long history, past the first page', async () => {
    const rows = Array.from({ length: 2100 }, (_, i) => run({ id: `r${String(i).padStart(5, '0')}`, external_id: String(i + 1), date: '2026-01-01' }));
    database({ runs: rows });

    const runs = await createReconcilePorts().listStravaRuns('user-1');

    expect(runs).toHaveLength(2100);
    expect(new Set(runs.map((r) => r.externalId)).size).toBe(2100);
  });

  it('reads a history that fills its last page exactly', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => run({ id: `r${String(i).padStart(5, '0')}`, external_id: String(i + 1) }));
    database({ runs: rows });

    expect(await createReconcilePorts().listStravaRuns('user-1')).toHaveLength(1000);
  });

  it('throws with the database code only when the runs cannot be read', async () => {
    database({ runs: [] }, { errors: { runs: { code: '57014', message: 'a message with 7345001' } } });

    const failure = await createReconcilePorts().listStravaRuns('user-1').catch((error) => error);

    expect(failure.code).toBe('57014');
    expect(failure.message).not.toContain('7345001');
  });
});

describe('reconcile ports: the activity list', () => {
  const list = (routes: FakeStravaRoutes) => {
    strava = installFakeStravaFetch(routes);
    return createReconcilePorts().listActivities('the-token', 1_758_000_000, 1);
  };
  const recent = (id: number) => stravaActivity({ id, start_date: '2026-10-12T05:30:00Z', start_date_local: '2026-10-12T07:30:00Z' });

  it('asks for 200 activities after the given time with the token, and gives the summaries', async () => {
    const result = await list({ athleteActivities: [recent(1), recent(2)] });

    expect(result).toMatchObject({ kind: 'ok' });
    expect(result.kind === 'ok' && result.activities.map((a) => a.id)).toEqual([1, 2]);
    expect(strava!.requests[0]).toMatchObject({
      method: 'GET',
      query: { after: '1758000000', per_page: '200' },
      headers: { authorization: 'Bearer the-token' },
    });
    expect(strava!.requests[0].query.page).toBeUndefined();
  });

  it('asks for the page it is given', async () => {
    strava = installFakeStravaFetch({ athleteActivities: Array.from({ length: 250 }, (_, i) => recent(100 + i)) });

    const second = await createReconcilePorts().listActivities('t', 1_758_000_000, 2);

    expect(strava.requests[0].query.page).toBe('2');
    expect(second.kind === 'ok' && second.activities).toHaveLength(50);
  });

  it('reports a status that is not 200 as no list, with the status', async () => {
    expect(await list({ athleteActivities: stravaError(500) })).toEqual({ kind: 'failed', status: 500 });
  });

  it('reports an answer that is not a list as no list', async () => {
    expect(await list({ athleteActivities: { message: 'surprise' } as any })).toMatchObject({ kind: 'failed' });
  });

  it('reports a network error as no list, without throwing', async () => {
    const result = await list({
      athleteActivities: () => {
        throw new Error('connection reset');
      },
    });

    expect(result).toEqual({ kind: 'failed', status: null });
  });
});
