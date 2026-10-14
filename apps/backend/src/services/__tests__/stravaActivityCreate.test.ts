/**
 * The webhook handler for activity:create (ADR 010 decisions 1, 7.1, 7.5 and 8), as behaviour through the real worker:
 * in-memory event store, the real Supabase adapters against createFakeDb (with the unique index on (user_id, external_id)), the
 * real Strava client against installFakeStravaFetch (an unconfigured Strava URL fails the test), the real reprocessRunsFromDate.
 * Mocked at the edge: calculateUserTotals, weather and event qualification, which are asserted as calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MS_DAY } from '@runquest/shared';

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
import { buildStravaRunRow } from '../stravaImport.js';
import { createStravaWebhookWorker, webhookHandlerKey, type HandlerRegistry } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createActivityCreateHandler } from '../stravaWebhook/handlers/activityCreate.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import type { RunStore } from '../stravaWebhook/ports.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
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
  vi.restoreAllMocks(); // before strava.restore(): a spy on fetch sits on top of the fake
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
  /** Replaces the run store's findRun. */
  findRun?: RunStore['findRun'];
  beforeInsert?: (table: string, tables: Record<string, Row[]>) => void;
  failWhen?: FakeDbOptions['failWhen'];
  handlers?: HandlerRegistry;
}

function build(setup: Setup = {}) {
  const t: Record<string, Row[]> = {
    strava_tokens: [{ ...TOKEN_ROW }],
    runs: [],
    user_boosts: [],
    ...(setup.tables as Record<string, Row[]>),
  };
  const db = createFakeDb(t, {
    autoIds: true,
    failWhen: setup.failWhen,
    beforeInsert: setup.beforeInsert,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    primaryKeys: { strava_tokens: ['user_id'] },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

  const store = createInMemoryWebhookStore({ now });
  const realRuns = createRunStore();
  const runs: RunStore = setup.findRun ? { ...realRuns, findRun: setup.findRun } : realRuns;
  const worker = createStravaWebhookWorker({
    store,
    strava: createStravaApi(),
    runs,
    recompute: createRecompute(),
    handlers: setup.handlers ?? STRAVA_WEBHOOK_HANDLERS,
    now,
  });
  return { t, db, store, worker };
}

/** The activity as Strava's detail call returns it: 00:30 local on the 12th is 22:30 UTC on the 11th. */
const lateNight = (id: number, over: Parameters<typeof stravaActivity>[0] = {}) =>
  stravaActivity({ id, start_date: '2026-10-11T22:30:00Z', start_date_local: '2026-10-12T00:30:00Z', ...over });

const stravaRun = (over: Row = {}): Row => ({
  id: 'run-old', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-11', distance: 5, xp_gained: 20, streak_day: 1, ...over,
});

const seedCreate = (store: ReturnType<typeof build>['store'], objectId: number, over: Record<string, unknown> = {}) =>
  store.seed({ object_id: objectId, aspect_type: 'create', ...over });

const runIds = (t: Record<string, Row[]>) => t.runs.map((run) => run.external_id).sort();

describe('activity create', () => {
  it('create event imports the run with XP, streak and start_time as local wall clock', async () => {
    const activity = lateNight(2001, { average_heartrate: 150, suffer_score: 42 });
    strava = installFakeStravaFetch({ activities: { 2001: activity } });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedCreate(store, 2001);

    await worker.drain();

    expect(t.runs).toHaveLength(2);
    const imported = t.runs.find((run) => run.external_id === '2001')!;
    expect(imported).toMatchObject({
      user_id: 'user-1',
      source: 'strava',
      date: '2026-10-12',
      distance: 5,
      start_time: '2026-10-12T00:30:00Z', // the local wall clock with Strava's Z, not 22:30 on the 11th
      moving_time: 1500,
      sport_type: 'Run',
      is_treadmill: false,
      avg_heartrate: 150,
      suffer_score: 42,
    });
    expect(imported.xp_gained).toBeGreaterThan(0); // recalculated from the placeholder 0 by the reprocess
    expect(imported.streak_day).toBe(2); // the day after the existing run
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported', attempts: 0 });
    expect(strava.activityCalls(2001)).toBe(1); // exactly one Strava call per create event
    expect(strava.requests).toHaveLength(1);
  });

  it('the reprocess starts from the date of the new run and leaves earlier runs untouched', async () => {
    strava = installFakeStravaFetch({ activities: { 2020: lateNight(2020) } });
    // An earlier run whose stored XP is deliberately not what a reprocess would compute: any rewrite of it shows.
    const earlier = stravaRun({ id: 'run-earlier', external_id: '1000', date: '2026-09-01', xp_gained: 7, base_xp: 7, streak_day: 1 });
    const { t, store, worker } = build({ tables: { runs: [earlier] } });
    seedCreate(store, 2020);

    await worker.drain();

    expect(t.runs.find((run) => run.id === 'run-earlier')).toMatchObject({ xp_gained: 7, base_xp: 7, streak_day: 1 });
    expect(t.runs.find((run) => run.external_id === '2020')!.xp_gained).toBeGreaterThan(0);
  });

  it('create event delivered twice yields exactly one run', async () => {
    strava = installFakeStravaFetch({ activities: { 2002: lateNight(2002) } });
    const { t, store, worker } = build();
    seedCreate(store, 2002);
    seedCreate(store, 2002); // Strava delivers again; a different row, because the dedupe key includes the event time

    await worker.drain();

    expect(runIds(t)).toEqual(['2002']);
    expect(store.rows().map((row) => row.outcome).sort()).toEqual(['imported', 'noop']);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);

    seedCreate(store, 2002); // and once more in a later batch
    await worker.drain();

    expect(runIds(t)).toEqual(['2002']);
    expect(store.row(3)).toMatchObject({ status: 'done', outcome: 'noop' });
  });

  it('create event for an activity that polling already imported is a no-op', async () => {
    const activity = lateNight(2003);
    strava = installFakeStravaFetch({ activities: { 2003: activity } });
    const polled = { id: 'run-polled', ...buildStravaRunRow('user-1', activity, activity), xp_gained: 33, streak_day: 2 };
    const { t, store, worker } = build({ tables: { runs: [polled] } });
    seedCreate(store, 2003);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ id: 'run-polled', xp_gained: 33, streak_day: 2 });
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
    expect(checkEventQualification).not.toHaveBeenCalled();
  });

  it('create event for a non-running activity finishes as not_a_run', async () => {
    strava = installFakeStravaFetch({ activities: { 2004: stravaActivity({ id: 2004, sport_type: 'Ride' }) } });
    const { t, store, worker } = build();
    seedCreate(store, 2004);

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'not_a_run' });
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('create event for a private or missing activity imports nothing', async () => {
    strava = installFakeStravaFetch({
      activities: {
        2005: stravaActivity({ id: 2005, private: true }),
        2006: stravaError(404), // deleted, or private under activity:read: Strava does not say which
      },
    });
    const { t, store, worker } = build();
    seedCreate(store, 2005);
    seedCreate(store, 2006);
    seedCreate(store, 2007); // an id Strava does not know at all

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([
      ['done', 'not_a_run'],
      ['done', 'not_a_run'],
      ['done', 'not_a_run'],
    ]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('create event for a paused user finishes as ignored_paused without calling Strava', async () => {
    // The stored token has expired: a refresh would be a Strava call too, and fakeStrava has no route for it.
    strava = installFakeStravaFetch({});
    const { t, store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, sync_paused: true, expires_at: 100 }] } });
    seedCreate(store, 2008);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_paused', attempts: 0 });
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('create event runs weather, calculateUserTotals and event qualification for the new run only', async () => {
    strava = installFakeStravaFetch({ activities: { 2009: lateNight(2009, { distance: 7500 }) } });
    const { t, store, worker } = build({ tables: { runs: [stravaRun()] } });
    seedCreate(store, 2009);
    let xpWhenWeatherWasFetched: unknown;
    vi.mocked(WeatherService.fetchAndSaveWeatherForRuns).mockImplementation(async () => {
      xpWhenWeatherWasFetched = t.runs.find((run) => run.external_id === '2009')?.xp_gained;
    });

    await worker.drain();

    const imported = t.runs.find((run) => run.external_id === '2009')!;
    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledTimes(1);
    const [weatherRuns] = vi.mocked(WeatherService.fetchAndSaveWeatherForRuns).mock.calls[0];
    expect(weatherRuns).toHaveLength(1);
    expect(weatherRuns[0]).toMatchObject({ id: imported.id, external_id: '2009', start_time: '2026-10-12T00:30:00Z', is_treadmill: false });
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    // The polling's arguments, for the new run only (not for the run that was already there).
    expect(checkEventQualification).toHaveBeenCalledTimes(1);
    expect(checkEventQualification).toHaveBeenCalledWith({ userId: 'user-1', runId: imported.id, runDate: '2026-10-12', distanceKm: 7.5, isTreadmill: false });
    // The polling's order: the reprocess gave the run its XP, then weather, then totals, then event qualification.
    expect(xpWhenWeatherWasFetched).toBeGreaterThan(0);
    const order = (fn: unknown) => (fn as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    expect(order(WeatherService.fetchAndSaveWeatherForRuns)).toBeLessThan(order(calculateUserTotals));
    expect(order(calculateUserTotals)).toBeLessThan(order(checkEventQualification));
  });

  it('create event survives a duplicate key race with polling', async () => {
    const activity = lateNight(2010);
    strava = installFakeStravaFetch({ activities: { 2010: activity } });
    const polled = { id: 'run-polled', ...buildStravaRunRow('user-1', activity, activity), xp_gained: 33, streak_day: 1 };
    let polling = true;
    // The polling commits its insert just before the handler's insert is evaluated, after the handler looked and found nothing.
    const { t, store, worker } = build({
      beforeInsert: (table, tables) => {
        if (table === 'runs' && polling) {
          polling = false;
          tables.runs.push({ ...polled });
        }
      },
    });
    seedCreate(store, 2010);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(t.runs[0].id).toBe('run-polled');
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop', attempts: 0 });
    expect(calculateUserTotals).not.toHaveBeenCalled(); // the polling that inserted it recomputes
    expect(checkEventQualification).not.toHaveBeenCalled(); // and qualifies, as the inserter
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('a duplicate key whose row is gone by the time it is read again is retried', async () => {
    strava = installFakeStravaFetch({ activities: { 2011: lateNight(2011) } });
    const { store, worker } = build({
      beforeInsert: (table, tables) => {
        if (table === 'runs') tables.runs.push({ id: 'run-ghost', user_id: 'user-1', external_id: '2011', source: 'strava', date: '2026-10-12', distance: 5 });
      },
      findRun: async () => null, // the conflicting row was deleted again before the handler could read it
    });
    seedCreate(store, 2011);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'duplicate_row_missing' });
  });

  it('create event for an activity dated before the connection day imports nothing', async () => {
    // Connected on 12 October (Stockholm); the activity is from the evening of the 11th.
    strava = installFakeStravaFetch({ activities: { 2012: stravaActivity({ id: 2012, start_date_local: '2026-10-11T18:30:00Z', start_date: '2026-10-11T16:30:00Z' }) } });
    const { t, store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, connection_date: '2026-10-12T07:00:00+00:00' }] } });
    seedCreate(store, 2012);

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop', attempts: 0 });
    expect(strava.activityCalls(2012)).toBe(1);
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
    expect(checkEventQualification).not.toHaveBeenCalled();
  });

  it('create event for an activity on the connection day itself is imported', async () => {
    strava = installFakeStravaFetch({ activities: { 2013: stravaActivity({ id: 2013, start_date_local: '2026-10-12T00:10:00Z', start_date: '2026-10-11T22:10:00Z' }) } });
    // 21:30 UTC on the 11th is 23:30 on the 11th in Stockholm; 22:30 UTC is 00:30 on the 12th.
    const { t, store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, connection_date: '2026-10-11T22:30:00+00:00' }] } });
    seedCreate(store, 2013);

    await worker.drain();

    expect(runIds(t)).toEqual(['2013']);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported' });
  });

  it('create event for a user with no connection date has no day restriction', async () => {
    strava = installFakeStravaFetch({ activities: { 2014: stravaActivity({ id: 2014, start_date_local: '2020-03-01T08:00:00Z' }) } });
    const { t, store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, connection_date: null }] } });
    seedCreate(store, 2014);

    await worker.drain();

    expect(runIds(t)).toEqual(['2014']);
  });
});

describe('the connection and the token', () => {
  it('create event for a user without a Strava connection finishes as ignored_unknown_owner without calling Strava', async () => {
    strava = installFakeStravaFetch({});
    const { t, store, worker } = build({ tables: { strava_tokens: [] } });
    seedCreate(store, 2101);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_unknown_owner' });
  });

  it('a failed read of the connection is retried: the user is never taken for not paused', async () => {
    strava = installFakeStravaFetch({});
    const { t, store, worker } = build({ failWhen: (q) => (q.table === 'strava_tokens' ? { message: 'db down' } : null) });
    seedCreate(store, 2102);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'connection_read_failed' });
  });

  it('an expired token is renewed once and the activity is fetched with the new token', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999990 }),
      activities: { 2103: lateNight(2103) },
    });
    const { t, store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] } });
    seedCreate(store, 2103);

    await worker.drain();

    expect(strava.calls.oauthToken).toBe(1);
    expect(strava.requests.find((request) => request.route === 'activity')?.headers.authorization).toBe('Bearer new-at');
    expect(runIds(t)).toEqual(['2103']);
  });

  it('a token that cannot be renewed is a failed attempt with a short code', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400) });
    const { store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] } });
    seedCreate(store, 2104);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'token_refresh_failed' });
  });

  it('a stored connection without a refresh token is a failed attempt', async () => {
    strava = installFakeStravaFetch({});
    const { store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, expires_at: 100, refresh_token: null }] } });
    seedCreate(store, 2105);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'no_refresh_token' });
  });
});

describe('what Strava answers', () => {
  const answers = (...values: Array<ReturnType<typeof lateNight> | FakeStravaFailure>) => (call: { count: number }) => values[Math.min(call.count, values.length) - 1];

  it('a 401 renews the token once and fetches again, in all two Strava reads and one renewal', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'renewed-at', refresh_token: 'new-rt', expires_at: 9999999990 }),
      activities: { 2201: answers(stravaError(401), lateNight(2201)) },
    });
    const { t, store, worker } = build();
    seedCreate(store, 2201);

    await worker.drain();

    expect(strava.calls.activity).toBe(2);
    expect(strava.calls.oauthToken).toBe(1);
    const reads = strava.requests.filter((request) => request.route === 'activity');
    expect(reads.map((request) => request.headers.authorization)).toEqual(['Bearer old-at', 'Bearer renewed-at']);
    expect(runIds(t)).toEqual(['2201']);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported', attempts: 0 });
  });

  it('a 401 that persists after the renewal is a failed attempt, not a second renewal', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'renewed-at', expires_at: 9999999990 }),
      activities: { 2202: stravaError(401) },
    });
    const { t, store, worker } = build();
    seedCreate(store, 2202);

    await worker.drain();

    expect(strava.calls.activity).toBe(2);
    expect(strava.calls.oauthToken).toBe(1);
    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'unauthorized' });
  });

  it('a 401 whose renewal fails is a failed attempt', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400), activities: { 2203: stravaError(401) } });
    const { store, worker } = build();
    seedCreate(store, 2203);

    await worker.drain();

    expect(strava.calls.activity).toBe(1);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'token_refresh_failed' });
  });

  it('a 5xx is a failed attempt, and the next try imports the run', async () => {
    strava = installFakeStravaFetch({ activities: { 2204: answers(stravaError(503), lateNight(2204)) } });
    const { t, store, worker } = build();
    seedCreate(store, 2204);

    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'server_error' });
    expect(t.runs).toHaveLength(0);

    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported' });
    expect(runIds(t)).toEqual(['2204']);
  });

  it('a network failure is a failed attempt', async () => {
    strava = installFakeStravaFetch({ activities: { 2205: lateNight(2205) } });
    const { store, worker } = build();
    seedCreate(store, 2205);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).includes('/activities/')) return Promise.reject(new TypeError('socket hang up'));
      return real(input, init);
    });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'network_error' });
  });

  describe('429', () => {
    function withBudget() {
      const budget = createStravaRateBudget({ now: () => START.getTime() });
      restoreHooks = setStravaRequestHooks({ after: (url, response) => budget.recordResponse(url, response) });
      return budget;
    }
    const handlersFor = (budget: ReturnType<typeof createStravaRateBudget>): HandlerRegistry => ({
      [webhookHandlerKey('activity', 'create')]: createActivityCreateHandler({ budget }),
    });

    it('waits for the next quarter hour when the 15-minute limit is hit, without counting a failed attempt', async () => {
      const budget = withBudget();
      strava = installFakeStravaFetch({
        activities: { 2301: stravaError(429) },
        rateLimit: { read: { usage: [300, 900] } },
      });
      const { t, store, worker } = build({ handlers: handlersFor(budget) });
      seedCreate(store, 2301);

      await worker.drain();

      expect(t.runs).toHaveLength(0);
      const row = store.row(1);
      expect(row).toMatchObject({ status: 'pending', attempts: 0, last_error: 'rate_limit_wait' });
      expect(row.next_attempt_at).toBe(new Date(Math.floor(START.getTime() / (15 * MINUTE)) * 15 * MINUTE + 15 * MINUTE + 30_000).toISOString());
      expect(calculateUserTotals).not.toHaveBeenCalled();
    });

    it('waits for UTC midnight when the daily limit is hit', async () => {
      const budget = withBudget();
      strava = installFakeStravaFetch({
        activities: { 2302: stravaError(429) },
        rateLimit: { read: { usage: [120, 3000] } },
      });
      const { store, worker } = build({ handlers: handlersFor(budget) });
      seedCreate(store, 2302);

      await worker.drain();

      const row = store.row(1);
      expect(row).toMatchObject({ status: 'pending', attempts: 0 });
      expect(row.next_attempt_at).toBe(new Date((Math.floor(START.getTime() / MS_DAY) + 1) * MS_DAY + 60_000).toISOString());
    });

    it('treats a 429 without rate limit headers as the 15-minute limit', async () => {
      const budget = withBudget();
      strava = installFakeStravaFetch({ activities: { 2303: stravaError(429) } });
      const { store, worker } = build({ handlers: handlersFor(budget) });
      seedCreate(store, 2303);

      await worker.drain();

      const row = store.row(1);
      expect(row.attempts).toBe(0);
      expect(Date.parse(row.next_attempt_at) - START.getTime()).toBeLessThanOrEqual(15 * MINUTE + 30_000);
    });
  });
});

describe('a create event that meets a run that already exists', () => {
  it('leaves a run that differs from Strava to the update event: no write, no recompute', async () => {
    const activity = lateNight(2401, { distance: 6000 });
    strava = installFakeStravaFetch({ activities: { 2401: activity } });
    const stored = { id: 'run-polled', ...buildStravaRunRow('user-1', lateNight(2401), lateNight(2401)), xp_gained: 33 };
    const { t, store, worker } = build({ tables: { runs: [stored] } });
    seedCreate(store, 2401);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ distance: 5, xp_gained: 33 });
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('leaves a manual run with the same id alone', async () => {
    strava = installFakeStravaFetch({ activities: { 2402: lateNight(2402) } });
    const { t, store, worker } = build({ tables: { runs: [{ id: 'run-manual', user_id: 'user-1', source: 'manual', external_id: '2402', date: '2026-10-12', distance: 5, xp_gained: 20 }] } });
    seedCreate(store, 2402);

    await worker.drain();

    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
  });

  it('a retry whose earlier try inserted the run and died before the recalculation recomputes from the run date', async () => {
    const activity = lateNight(2403);
    strava = installFakeStravaFetch({ activities: { 2403: activity } });
    // The earlier try inserted the row with the placeholder XP and failed in the reprocess.
    const orphan = { id: 'run-orphan', ...buildStravaRunRow('user-1', activity, activity) };
    const { t, store, worker } = build({ tables: { runs: [orphan] } });
    seedCreate(store, 2403, { attempts: 1 });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(t.runs[0].xp_gained).toBeGreaterThan(0);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });
});

describe('the handler and the logs', () => {
  it('logs no Strava id, title or token for an imported run', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
    strava = installFakeStravaFetch({ activities: { 987654321: lateNight(987654321, { name: 'My secret morning run' }) } });
    const { store, worker } = build();
    seedCreate(store, 987654321, { owner_id: 555111 });

    await worker.drain();

    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(text).not.toContain('987654321');
    expect(text).not.toContain('555111');
    expect(text).not.toContain('secret morning');
    expect(text).not.toContain('old-at');
  });

  it('logs no Strava id, coordinate, heart rate or title when the insert fails', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
      });
    }
    strava = installFakeStravaFetch({
      activities: { 987654321: lateNight(987654321, { name: 'My secret morning run', start_latlng: [59.3293, 18.0686], average_heartrate: 171, max_heartrate: 188 }) },
    });
    const { t, store, worker } = build({
      // A database message can carry the values of the row; none of it may reach the log.
      failWhen: (q) =>
        q.table === 'runs' && q.mutation === 'insert' ? { message: 'insert failed for 987654321 at 59.3293,18.0686 hr 171 "My secret morning run"' } : null,
    });
    seedCreate(store, 987654321, { owner_id: 555111 });

    await worker.drain();

    expect(t.runs).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(lines.some((line) => line.includes('Failed to insert a Strava run for user user-1'))).toBe(true); // the failure is logged, with our user id
    const text = lines.join('\n') + store.row(1).last_error;
    for (const secret of ['987654321', '555111', '59.3293', '18.0686', '171', '188', 'secret morning']) expect(text).not.toContain(secret);
    expect(text).toContain('user-1');
  });

  it('is registered for activity:create in the default registry', () => {
    expect(STRAVA_WEBHOOK_HANDLERS[webhookHandlerKey('activity', 'create')]).toBeTypeOf('function');
  });
});
