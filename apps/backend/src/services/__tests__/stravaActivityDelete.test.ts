/**
 * The webhook handler for activity:delete (ADR 010 decisions 7.1, 7.2 and 8), as behaviour through the real worker: in-memory event
 * store, the real Supabase adapters against createFakeDb (wrapped in the foreign key actions of the migrations, see
 * test-utils/runForeignKeys.ts), the real Strava client against installFakeStravaFetch, the real reprocessRunsFromDate.
 * Mocked at the edge: calculateUserTotals, which is asserted as a call. The criteria that need the real totals, badges and logs
 * are in stravaActivityDelete.chain.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { checkEventQualification } from '../eventService.js';
import { WeatherService } from '../weatherService.js';
import { setStravaRequestHooks } from '../stravaClient.js';
import { createStravaRateBudget } from '../stravaRateBudget.js';
import { createStravaWebhookWorker, webhookHandlerKey, type HandlerRegistry } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createActivityDeleteHandler } from '../stravaWebhook/handlers/activityDelete.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import type { Recompute, RunStore, StravaApi } from '../stravaWebhook/ports.js';
import type { WebhookHandlerContext } from '../stravaWebhookWorker.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryRunStore, createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import {
  installFakeStravaFetch,
  stravaActivity,
  stravaError,
  stravaTokenResponse,
  type FakeStrava,
  type FakeStravaFailure,
} from '../../test-utils/fakeStrava.js';

const START = new Date('2026-10-14T12:07:00.000Z');
const MINUTE = 60_000;
let clock = START;
const now = () => clock;

let strava: FakeStrava | undefined;
let restoreHooks: (() => void) | undefined;

beforeEach(() => {
  clock = START;
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  restoreHooks?.();
  restoreHooks = undefined;
  vi.restoreAllMocks();
  strava?.restore(); // throws when the code reached a Strava URL the test did not configure
  strava = undefined;
});

const TOKEN_ROW = {
  user_id: 'user-1',
  access_token: 'old-at',
  refresh_token: 'old-rt',
  expires_at: 9999999999,
  connection_date: '2026-09-01T09:00:00+00:00',
  sync_paused: false,
};

interface Setup {
  tables?: Partial<Record<string, Row[]>>;
  failWhen?: FakeDbOptions['failWhen'];
  handlers?: HandlerRegistry;
  /** Wraps the real recompute, e.g. to make the reprocess fail. */
  recompute?: (real: Recompute) => Recompute;
}

function build(setup: Setup = {}) {
  const t: Record<string, Row[]> = {
    strava_tokens: [{ ...TOKEN_ROW }],
    runs: [],
    user_boosts: [],
    run_weather: [],
    event_entries: [],
    user_badges: [],
    users: [{ id: 'user-1', event_xp: 0 }],
    ...(setup.tables as Record<string, Row[]>),
  };
  const db = createFakeDb(t, { autoIds: true, failWhen: setup.failWhen, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, t) as any);

  const reprocessCalls: Array<{ userId: string; fromDate: string }> = [];
  const real = createRecompute();
  const counting: Recompute = {
    ...real,
    reprocessFrom: (userId, fromDate) => {
      reprocessCalls.push({ userId, fromDate });
      return real.reprocessFrom(userId, fromDate);
    },
  };
  const store = createInMemoryWebhookStore({ now });
  const worker = createStravaWebhookWorker({
    store,
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: setup.recompute ? setup.recompute(counting) : counting,
    handlers: setup.handlers ?? STRAVA_WEBHOOK_HANDLERS,
    now,
  });
  return { t, db, store, worker, reprocessCalls };
}

const stravaRun = (over: Row = {}): Row => ({
  id: 'run-old', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-11', distance: 5, xp_gained: 20, streak_day: 1, ...over,
});

const seedDelete = (store: ReturnType<typeof build>['store'], objectId: number, over: Record<string, unknown> = {}) =>
  store.seed({ object_id: objectId, aspect_type: 'delete', ...over });

const runMutations = (db: ReturnType<typeof build>['db']) => db.queries.filter((q) => q.table === 'runs' && q.mutation === 'delete');

/** Both pieces of the reprocess that matter here: it started at all, and from which date. */
const answers = (...values: Array<ReturnType<typeof stravaActivity> | FakeStravaFailure>) => (call: { count: number }) => values[Math.min(call.count, values.length) - 1];

describe('activity delete', () => {
  it('delete event for an activity Strava no longer has removes the run and recalculates from its date', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const earlier = stravaRun({ id: 'run-earlier', external_id: '1000', date: '2026-09-01', xp_gained: 7, base_xp: 7, streak_day: 1 });
    const { t, store, worker, reprocessCalls } = build({ tables: { runs: [earlier, stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs.map((run) => run.id)).toEqual(['run-earlier']);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted', attempts: 0 });
    expect(strava.activityCalls(1001)).toBe(1);
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-11' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(t.runs[0]).toMatchObject({ xp_gained: 7, base_xp: 7 }); // the earlier run is not reprocessed
  });

  it('delete event removes the run of a later date and gives the following runs a fresh streak', async () => {
    strava = installFakeStravaFetch({ activities: { 1002: stravaError(404) } });
    // Three days in a row; the middle one goes, so the third starts over at 1.
    const runs = [
      stravaRun({ id: 'd1', external_id: '1001', date: '2026-10-10', streak_day: 1 }),
      stravaRun({ id: 'd2', external_id: '1002', date: '2026-10-11', streak_day: 2 }),
      stravaRun({ id: 'd3', external_id: '1003', date: '2026-10-12', streak_day: 3, xp_gained: 999 }),
    ];
    const { t, store, worker } = build({ tables: { runs } });
    seedDelete(store, 1002);

    await worker.drain();

    expect(t.runs.map((run) => run.id)).toEqual(['d1', 'd3']);
    expect(t.runs.find((run) => run.id === 'd3')).toMatchObject({ streak_day: 1 });
    expect(t.runs.find((run) => run.id === 'd3')!.xp_gained).not.toBe(999);
  });

  it("delete event removes the run's weather row", async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const weather = [
      { run_id: 'run-old', temperature_c: 12 },
      { run_id: 'run-keep', temperature_c: 15 },
    ];
    const { t, db, store, worker } = build({ tables: { runs: [stravaRun(), stravaRun({ id: 'run-keep', external_id: '1002', date: '2026-10-12' })], run_weather: weather } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs.map((run) => run.id)).toEqual(['run-keep']);
    expect(t.run_weather).toEqual([{ run_id: 'run-keep', temperature_c: 15 }]);
    // The chain never touches run_weather itself: the row goes with the run (ON DELETE CASCADE), as in the database.
    expect(db.queries.filter((q) => q.table === 'run_weather' && q.mutation)).toEqual([]);
  });

  it('delete event for a run that qualified an event keeps the entry and its xp and sets run_id to null', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const entry = { id: 'entry-1', event_id: 'event-1', user_id: 'user-1', run_id: 'run-old', xp_awarded: 40 };
    const { t, db, store, worker } = build({
      tables: { runs: [stravaRun()], event_entries: [entry], users: [{ id: 'user-1', event_xp: 40 }] },
    });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(t.event_entries).toEqual([{ ...entry, run_id: null }]); // the entry and its XP stay (D2)
    expect(t.users[0].event_xp).toBe(40);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    // run_id becomes NULL through the foreign key (migration 047), not through a write of ours; the chain writes neither
    // event_entries nor users, so no XP can move.
    expect(db.queries.filter((q) => (q.table === 'event_entries' || q.table === 'users') && q.mutation)).toEqual([]);
    expect(checkEventQualification).not.toHaveBeenCalled(); // a deletion never qualifies anything
  });

  it('delete event for a still visible running activity deletes nothing', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaActivity({ id: 1001, start_date_local: '2026-10-11T08:00:00Z' }) } });
    const { t, db, store, worker, reprocessCalls } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ id: 'run-old', xp_gained: 20 });
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_not_confirmed' });
    expect(runMutations(db)).toEqual([]);
    expect(reprocessCalls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('forged delete event against a live activity removes nothing', async () => {
    // A POST nobody signed: it claims a deletion (and a private flag) for activities that Strava still shows. The detail call decides.
    strava = installFakeStravaFetch({
      activities: {
        1001: stravaActivity({ id: 1001, start_date_local: '2026-10-11T08:00:00Z' }),
        1002: stravaActivity({ id: 1002, start_date_local: '2026-10-12T08:00:00Z' }),
      },
    });
    const { t, db, store, worker } = build({
      tables: { runs: [stravaRun(), stravaRun({ id: 'run-two', external_id: '1002', date: '2026-10-12' })] },
    });
    seedDelete(store, 1001, { updates: { private: 'true' } });
    seedDelete(store, 1002);
    seedDelete(store, 1002, { event_time: new Date(START.getTime() + 1000).toISOString() }); // repeated for good measure

    await worker.drain();

    expect(t.runs.map((run) => run.id).sort()).toEqual(['run-old', 'run-two']);
    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([
      ['done', 'ignored_not_confirmed'],
      ['done', 'ignored_not_confirmed'],
      ['done', 'ignored_not_confirmed'],
    ]);
    expect(strava.activityCalls(1001)).toBe(1); // the detail call is made every time
    expect(strava.activityCalls(1002)).toBe(2);
    expect(runMutations(db)).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('delete event delivered twice is a no-op the second time', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const { t, db, store, worker, reprocessCalls } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);
    seedDelete(store, 1001); // a different row: the dedupe key includes the event time

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(store.rows().map((row) => row.outcome)).toEqual(['deleted', 'not_a_run']);
    expect(runMutations(db)).toHaveLength(1);
    expect(reprocessCalls).toHaveLength(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);

    seedDelete(store, 1001); // and once more, in a later batch
    await worker.drain();

    expect(store.row(3)).toMatchObject({ status: 'done', outcome: 'not_a_run', attempts: 0 });
    expect(runMutations(db)).toHaveLength(1);
    expect(reprocessCalls).toHaveLength(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('delete event for an unknown activity is a no-op', async () => {
    strava = installFakeStravaFetch({ activities: { 5555: stravaError(404) } });
    const { t, db, store, worker, reprocessCalls } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 5555);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'not_a_run', attempts: 0 });
    expect(strava.activityCalls(5555)).toBe(1);
    expect(runMutations(db)).toEqual([]);
    expect(reprocessCalls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('delete event for a paused user is processed as usual', async () => {
    strava = installFakeStravaFetch({
      activities: { 1001: stravaError(404), 1002: stravaActivity({ id: 1002, start_date_local: '2026-10-12T08:00:00Z' }) },
    });
    const { t, store, worker } = build({
      tables: {
        strava_tokens: [{ ...TOKEN_ROW, sync_paused: true }],
        runs: [stravaRun(), stravaRun({ id: 'run-live', external_id: '1002', date: '2026-10-12' })],
      },
    });
    seedDelete(store, 1001);
    seedDelete(store, 1002);

    await worker.drain();

    // The gone activity is deleted even though the user paused; the live one is "not confirmed", not "paused".
    expect(t.runs.map((run) => run.id)).toEqual(['run-live']);
    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([
      ['done', 'deleted'],
      ['done', 'ignored_not_confirmed'],
    ]);
    expect(strava.activityCalls(1001)).toBe(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('removal never deletes a manual run', async () => {
    strava = installFakeStravaFetch({ activities: { 4001: stravaError(404) } });
    // A manual run that carries the activity's id (a copy) and a Strava run of ANOTHER user with the same id.
    const manual = { id: 'run-manual', user_id: 'user-1', source: 'manual', external_id: '4001', date: '2026-10-11', distance: 5, xp_gained: 20 };
    const other = stravaRun({ id: 'run-other-user', user_id: 'user-2', external_id: '4001' });
    const { t, db, store, worker } = build({ tables: { runs: [manual, other] } });
    seedDelete(store, 4001);

    await worker.drain();

    expect(t.runs.map((run) => run.id).sort()).toEqual(['run-manual', 'run-other-user']);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'not_a_run' });
    expect(runMutations(db)).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('removal of several runs for one user triggers one reprocess from the oldest date and one calculateUserTotals', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404), 1002: stravaError(404), 1003: stravaError(404) } });
    const runs = [
      stravaRun({ id: 'a', external_id: '1001', date: '2026-10-05' }),
      stravaRun({ id: 'b', external_id: '1002', date: '2026-09-20' }),
      stravaRun({ id: 'c', external_id: '1003', date: '2026-10-09' }),
      stravaRun({ id: 'kept', external_id: '1004', date: '2026-08-01' }),
    ];
    const { t, store, worker, reprocessCalls } = build({ tables: { runs } });
    seedDelete(store, 1001);
    seedDelete(store, 1002);
    seedDelete(store, 1003);

    await worker.drain();

    expect(t.runs.map((run) => run.id)).toEqual(['kept']);
    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([['done', 'deleted'], ['done', 'deleted'], ['done', 'deleted']]);
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-09-20' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('failed reprocess marks the events as failed for retry', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404), 1002: stravaError(404) } });
    const { t, store, worker } = build({
      tables: { runs: [stravaRun(), stravaRun({ id: 'run-two', external_id: '1002', date: '2026-10-12' }), stravaRun({ id: 'later', external_id: '1003', date: '2026-10-13' })] },
      failWhen: (q) => (q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed' } : null),
    });
    seedDelete(store, 1001);
    seedDelete(store, 1002);

    await worker.drain();

    // The deletes happened; the recalculation did not, so both events go back to the queue instead of finishing.
    expect(t.runs.map((run) => run.id)).toEqual(['later']);
    expect(store.rows().map((row) => [row.status, row.attempts, row.last_error])).toEqual([
      ['pending', 1, 'recompute_failed'],
      ['pending', 1, 'recompute_failed'],
    ]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('a retry that meets the already deleted run recalculates from the earliest run and finishes', async () => {
    // Attempt 1 deleted the run and died in the reprocess. Attempt 2 gets a 404 and finds NO run, so decideAction has no date
    // (recalculateUnknown) and the worker falls back to the user's earliest run: always correct, only more work.
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    let failing = true;
    const { t, store, worker, reprocessCalls } = build({
      tables: {
        runs: [
          stravaRun({ id: 'earliest', external_id: '1000', date: '2026-09-01', streak_day: 1 }),
          stravaRun({ id: 'deleted', external_id: '1001', date: '2026-10-11' }),
          stravaRun({ id: 'later', external_id: '1002', date: '2026-10-12', streak_day: 2, xp_gained: 999 }),
        ],
      },
      failWhen: (q) => (failing && q.table === 'runs' && q.mutation === 'update' ? { message: 'update failed' } : null),
    });
    seedDelete(store, 1001);

    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'recompute_failed' });
    expect(t.runs.map((run) => run.id)).toEqual(['earliest', 'later']);

    failing = false;
    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(reprocessCalls.map((call) => call.fromDate)).toEqual(['2026-10-11', '2026-09-01']);
    // The outcome of the retry is not_a_run (the run was already gone); the event is done and the totals were recalculated once.
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'not_a_run', attempts: 1 });
    expect(t.runs.find((run) => run.id === 'later')).toMatchObject({ streak_day: 1 }); // 1 September to 12 October is a gap
    expect(t.runs.find((run) => run.id === 'later')!.xp_gained).not.toBe(999);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('delete event for an activity that turned into another sport removes the run', async () => {
    // The same chain serves the update handler (private or type change): a delete event that finds a non-run goes the same way.
    strava = installFakeStravaFetch({ activities: { 1001: stravaActivity({ id: 1001, sport_type: 'Ride', type: 'Ride' }) } });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'removed_not_running' });
  });

  it('a failed delete is a failed attempt, and nothing is recalculated', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const { t, store, worker, reprocessCalls } = build({
      tables: { runs: [stravaRun()] },
      failWhen: (q) => (q.table === 'runs' && q.mutation === 'delete' ? ({ message: 'db down', code: '57P01' } as never) : null),
    });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'handler_error:57P01' });
    expect(reprocessCalls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });
});

describe('the connection and the token', () => {
  it('delete event for a user without a Strava connection finishes as ignored_unknown_owner without calling Strava', async () => {
    strava = installFakeStravaFetch({});
    const { t, store, worker } = build({ tables: { strava_tokens: [], runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(t.runs).toHaveLength(1); // the disconnect has deleted the Strava runs already; nothing is guessed here
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_unknown_owner' });
  });

  it('a failed read of the connection is retried: the user is never taken for not paused', async () => {
    strava = installFakeStravaFetch({});
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] }, failWhen: (q) => (q.table === 'strava_tokens' ? { message: 'db down' } : null) });
    seedDelete(store, 1001);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'connection_read_failed' });
  });

  it('an expired token is renewed once and the activity is fetched with the new token', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }),
      activities: { 1001: stravaError(404) },
    });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()], strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(strava.calls.oauthToken).toBe(1);
    expect(strava.requests.find((request) => request.route === 'activity')?.headers.authorization).toBe('Bearer new-at');
    expect(t.runs).toHaveLength(0);
  });

  it('a token that cannot be renewed is a failed attempt with a short code and deletes nothing', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400) });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()], strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'token_refresh_failed' });
  });
});

describe('what Strava answers', () => {
  it('a 401 renews the token once and fetches again, then deletes', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'renewed-at', refresh_token: 'new-rt', expires_at: 9999999990 }),
      activities: { 1001: answers(stravaError(401), stravaError(404)) },
    });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    const reads = strava.requests.filter((request) => request.route === 'activity');
    expect(reads.map((request) => request.headers.authorization)).toEqual(['Bearer old-at', 'Bearer renewed-at']);
    expect(strava.calls.oauthToken).toBe(1);
    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted', attempts: 0 });
  });

  it('a 401 that persists after the renewal is a failed attempt and deletes nothing', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'renewed-at', expires_at: 9999999990 }),
      activities: { 1001: stravaError(401) },
    });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(strava.calls.activity).toBe(2);
    expect(strava.calls.oauthToken).toBe(1);
    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'unauthorized' });
  });

  it('a 5xx is a failed attempt that deletes nothing, and the next try deletes', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: answers(stravaError(503), stravaError(404)) } });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'server_error' });
    expect(t.runs).toHaveLength(1);

    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    expect(t.runs).toHaveLength(0);
  });

  it('a network failure is a failed attempt that deletes nothing', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).includes('/activities/')) return Promise.reject(new TypeError('socket hang up'));
      return real(input, init);
    });

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'network_error' });
  });

  it('a 429 is a wait, not a failed attempt, and deletes nothing', async () => {
    const budget = createStravaRateBudget({ now: () => START.getTime() });
    restoreHooks = setStravaRequestHooks({ after: (url, response) => budget.recordResponse(url, response) });
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(429) }, rateLimit: { read: { usage: [300, 900] } } });
    const { t, store, worker } = build({
      tables: { runs: [stravaRun()] },
      handlers: { [webhookHandlerKey('activity', 'delete')]: createActivityDeleteHandler({ budget }) },
    });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 0, last_error: 'rate_limit_wait' });
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('an answer that is not a usable activity is a failed attempt, never a reason to delete', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: { ...stravaActivity({ id: 1001 }), distance: undefined } as never } }); // a run with no distance
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1 });
  });
});

describe('the handler on its own ports', () => {
  /** A StravaApi that answers with one status for every activity, and counts the calls. */
  function apiAnswering(response: Awaited<ReturnType<StravaApi['fetchActivity']>>): StravaApi & { reads: number } {
    const token = { ok: true as const, accessToken: 'at', refreshed: false, expiresAt: null, connectionDate: null, consentVersion: null };
    const api = {
      reads: 0,
      getAccessToken: async () => token,
      refreshAccessToken: async () => token,
      fetchActivity: async () => {
        api.reads += 1;
        return response;
      },
      fetchAthlete: async () => ({ kind: 'http' as const, status: 200 }),
    };
    return api;
  }
  const ctxFor = (api: StravaApi, runs: RunStore, attempts = 0) =>
    ({ event: { id: 1, object_id: 4001, aspect_type: 'delete' }, userId: 'user-1', attempts, strava: api, runs, now: () => START }) as unknown as WebhookHandlerContext;

  it('removal never deletes a manual run, whatever Strava answers', async () => {
    const runs = createInMemoryRunStore();
    const manual = { source: 'manual', date: '2026-10-11', distance: 5 } as never;
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-11', run: manual });
    const handler = createActivityDeleteHandler();

    for (const answer of [
      { kind: 'http' as const, status: 404 },
      { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, sport_type: 'Ride', type: 'Ride' }) },
      { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, private: true }) },
    ]) {
      const result = await handler(ctxFor(apiAnswering(answer), runs));
      expect(result).toMatchObject({ status: 'done', outcome: 'not_a_run', recalculateFrom: null });
    }

    expect(runs.removeCalls).toEqual([]);
    expect(runs.runs).toHaveLength(1);
  });

  it('reports the date of the deleted run for the recalculation', async () => {
    const runs = createInMemoryRunStore();
    const stored = { source: 'strava', date: '2026-10-11', distance: 5 } as never;
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-11', run: stored });

    const result = await createActivityDeleteHandler()(ctxFor(apiAnswering({ kind: 'http', status: 404 }), runs));

    expect(result).toMatchObject({ status: 'done', outcome: 'deleted', recalculateFrom: '2026-10-11' });
    expect(runs.removeCalls).toEqual([{ userId: 'user-1', externalId: '4001' }]);
    expect(runs.runs).toEqual([]);
  });

  it('still recalculates from the stored date when the row was gone by the time of the delete', async () => {
    const runs = createInMemoryRunStore();
    const stored = { source: 'strava', date: '2026-10-11', distance: 5 } as never;
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-11', run: stored });
    runs.removeStravaRun = async () => ({ removed: false, date: null }); // the polling or another event deleted it in between

    const result = await createActivityDeleteHandler()(ctxFor(apiAnswering({ kind: 'http', status: 404 }), runs));

    expect(result).toMatchObject({ status: 'done', outcome: 'deleted', recalculateFrom: '2026-10-11' });
  });

  it('a retry after a failed attempt that finds no run reports an unknown date', async () => {
    const runs = createInMemoryRunStore();

    const result = await createActivityDeleteHandler()(ctxFor(apiAnswering({ kind: 'http', status: 404 }), runs, 1));

    expect(result).toMatchObject({ status: 'done', outcome: 'not_a_run', recalculateFrom: null, recalculateUnknown: true });
    expect(runs.removeCalls).toEqual([]);
  });
});

describe('registration', () => {
  it('is registered for activity:delete in the default registry', () => {
    expect(STRAVA_WEBHOOK_HANDLERS[webhookHandlerKey('activity', 'delete')]).toBeTypeOf('function');
  });

  it('leaves the create handler registered', () => {
    expect(STRAVA_WEBHOOK_HANDLERS[webhookHandlerKey('activity', 'create')]).toBeTypeOf('function');
  });

  it('makes no weather or event qualification call for a deletion', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const { store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedDelete(store, 1001);

    await worker.drain();

    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
    expect(checkEventQualification).not.toHaveBeenCalled();
  });
});
