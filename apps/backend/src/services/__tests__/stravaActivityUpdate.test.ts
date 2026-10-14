/**
 * The webhook handler for activity:update (ADR 010 decisions 1, 7.1, 7.3, 7.5 and 8), as behaviour through the real worker: in-memory
 * event store, the real Supabase adapters against createFakeDb (wrapped in the foreign key actions of the migrations), the real
 * Strava client against installFakeStravaFetch, the real reprocessRunsFromDate. Mocked at the edge: calculateUserTotals (asserted as a
 * call), the weather service and event qualification. The permutation test is in stravaActivityUpdate.order.test.ts, the XP-column
 * guard against a misbehaving decision in stravaActivityUpdate.guard.test.ts and the token renewal limit in
 * stravaActivityUpdate.refreshLimit.test.ts.
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
import { buildStravaRunRow } from '../stravaImport.js';
import { setStravaRequestHooks } from '../stravaClient.js';
import { createStravaRateBudget } from '../stravaRateBudget.js';
import { createStravaWebhookWorker, webhookHandlerKey, type HandlerRegistry, type WebhookHandlerContext } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createActivityUpdateHandler } from '../stravaWebhook/handlers/activityUpdate.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import type { Recompute, StravaApi } from '../stravaWebhook/ports.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryRecompute, createInMemoryRunStore, createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
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

/** Every column a Strava update may write (the decision's RunChanges) and every column only the recompute may write. */
const WRITABLE_COLUMNS = [
  'date', 'distance', 'start_time', 'moving_time', 'total_elevation_gain', 'sport_type', 'avg_heartrate', 'max_heartrate',
  'suffer_score', 'start_lat', 'start_lng', 'pace_std_dev', 'is_treadmill',
];
const XP_COLUMNS = ['xp_gained', 'base_xp', 'km_xp', 'distance_bonus', 'streak_bonus', 'multiplier', 'streak_day'];

interface Setup {
  tables?: Partial<Record<string, Row[]>>;
  failWhen?: FakeDbOptions['failWhen'];
  handlers?: HandlerRegistry;
  /** Replaces the real recompute, or wraps it, e.g. to make the reprocess fail. */
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
  const db = createFakeDb(t, {
    autoIds: true,
    failWhen: setup.failWhen,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    primaryKeys: { strava_tokens: ['user_id'] },
  });
  // The columns each update of `runs` writes: the fake database records no values, so the client is wrapped.
  const runUpdates: string[][] = [];
  const wrapped = withRunForeignKeys(db.client, t) as typeof db.client;
  const client = {
    ...wrapped,
    from: (table: string) => {
      const builder = wrapped.from(table);
      if (table === 'runs') {
        const update = builder.update;
        builder.update = (values: Row) => {
          runUpdates.push(Object.keys(values));
          return update.call(builder, values);
        };
      }
      return builder;
    },
  };
  vi.mocked(getSupabaseClient).mockReturnValue(client as any);

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
  return { t, db, store, worker, reprocessCalls, runUpdates };
}

const XP_OF_THE_STORED_RUN = { xp_gained: 20, base_xp: 20, km_xp: 15, distance_bonus: 5, streak_bonus: 0, multiplier: 1, streak_day: 1 };

/** An activity as Strava shows it: 07:30 local on 12 October unless the test says otherwise. */
const activityOf = (id: number, over: Parameters<typeof stravaActivity>[0] = {}) =>
  stravaActivity({ id, start_date: '2026-10-12T05:30:00Z', start_date_local: '2026-10-12T07:30:00Z', ...over });

/** The run row that holds `activity` exactly as the import would have stored it, plus a stored XP the recompute would change. */
const storedRun = (activity: ReturnType<typeof stravaActivity>, over: Row = {}): Row => {
  const { created_at: _createdAt, ...columns } = buildStravaRunRow('user-1', activity, activity);
  return { id: `run-${activity.id}`, ...columns, ...XP_OF_THE_STORED_RUN, ...over };
};

const seedUpdate = (store: ReturnType<typeof build>['store'], objectId: number, over: Record<string, unknown> = {}) =>
  store.seed({ object_id: objectId, aspect_type: 'update', ...over });

const mutations = (db: ReturnType<typeof build>['db'], table: string, kind: 'insert' | 'update' | 'delete') =>
  db.queries.filter((q) => q.table === table && q.mutation === kind);

const answers = (...values: Array<ReturnType<typeof stravaActivity> | FakeStravaFailure>) => (call: { count: number }) => values[Math.min(call.count, values.length) - 1];

describe('activity update', () => {
  it('update event changes distance and recomputes xp, streak and totals', async () => {
    const before = activityOf(1001);
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000 }) } });
    const later = storedRun(activityOf(1002, { start_date_local: '2026-10-13T07:30:00Z' }), { streak_day: 5, xp_gained: 999 });
    const earlier = storedRun(activityOf(1000, { start_date_local: '2026-09-01T07:30:00Z' }), { xp_gained: 7, base_xp: 7 });
    const { t, store, worker, reprocessCalls } = build({ tables: { runs: [earlier, storedRun(before), later] } });
    seedUpdate(store, 1001);

    await worker.drain();

    const updated = t.runs.find((run) => run.id === 'run-1001')!;
    expect(updated.distance).toBe(8);
    expect(updated.xp_gained).toBeGreaterThan(0);
    expect(updated.xp_gained).not.toBe(20); // recalculated by the reprocess, never copied from anywhere
    expect(t.runs.find((run) => run.id === 'run-1002')).toMatchObject({ streak_day: 2 }); // the day after
    expect(t.runs.find((run) => run.id === 'run-1000')).toMatchObject({ xp_gained: 7, base_xp: 7 }); // before the date: untouched
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'updated', attempts: 0 });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(strava.activityCalls(1001)).toBe(1);
  });

  it('update event moving the date reprocesses from the earlier of old and new date', async () => {
    const cases = [
      { label: 'later', newDate: '2026-10-15', expectedFrom: '2026-10-12' },
      { label: 'earlier', newDate: '2026-10-09', expectedFrom: '2026-10-09' },
    ];
    for (const { label, newDate, expectedFrom } of cases) {
      strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { start_date_local: `${newDate}T07:30:00Z` }) } });
      const { t, store, worker, reprocessCalls } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
      seedUpdate(store, 1001);

      await worker.drain();

      expect(t.runs[0].date, label).toBe(newDate);
      expect(reprocessCalls, label).toEqual([{ userId: 'user-1', fromDate: expectedFrom }]);
      expect(calculateUserTotals, label).toHaveBeenCalledTimes(1);
      expect(store.row(1), label).toMatchObject({ status: 'done', outcome: 'updated' });
      strava.restore();
      strava = undefined;
      vi.mocked(calculateUserTotals).mockClear();
    }
  });

  it('update event keeps start_time as local wall clock', async () => {
    // 00:30 local on the 12th is 22:30 UTC on the 11th: the stored value is the wall clock with Strava's Z, never the UTC instant.
    const moved = activityOf(1001, { start_date: '2026-10-11T22:30:00Z', start_date_local: '2026-10-12T00:30:00Z' });
    strava = installFakeStravaFetch({ activities: { 1001: moved } });
    const { t, store, worker } = build({ tables: { runs: [storedRun(activityOf(1001, { start_date_local: '2026-10-11T07:30:00Z' }))] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(t.runs[0]).toMatchObject({ date: '2026-10-12', start_time: '2026-10-12T00:30:00Z' });
  });

  it('update event with only a title change finishes as noop without recompute', async () => {
    const stored = storedRun(activityOf(1001), { start_time: '2026-10-12T07:30:00+00:00' }); // the database writes +00:00 where Strava writes Z
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { name: 'A brand new title' }) } });
    const { t, db, store, worker, reprocessCalls } = build({ tables: { runs: [stored] } });
    seedUpdate(store, 1001, { updates: { title: 'A brand new title' } });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop', attempts: 0 });
    expect(t.runs[0]).toEqual(stored);
    expect(mutations(db, 'runs', 'update')).toEqual([]);
    expect(reprocessCalls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(strava.activityCalls(1001)).toBe(1);
  });

  it('update event delivered twice leaves the same state', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000 }) } });
    const { t, store, worker, reprocessCalls, runUpdates } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001);

    await worker.drain();
    const afterFirst = JSON.parse(JSON.stringify(t.runs));

    seedUpdate(store, 1001); // Strava delivers it again: a different row, because the dedupe key includes the event time
    await worker.drain();

    expect(store.rows().map((row) => row.outcome)).toEqual(['updated', 'noop']);
    expect(t.runs).toEqual(afterFirst);
    expect(reprocessCalls).toHaveLength(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(runUpdates.filter((columns) => columns.includes('distance'))).toHaveLength(1); // the second delivery wrote nothing
  });

  it('update event clears the weather row when start time or start location changes', async () => {
    const weather = (id: number) => ({ run_id: `run-${id}`, temperature_c: 12 });
    const activities = {
      1001: activityOf(1001, { start_date_local: '2026-10-12T08:15:00Z' }), // another start time
      1002: activityOf(1002, { start_latlng: [60.1, 24.9] }), // another start location
      1003: activityOf(1003, { distance: 9000 }), // neither: the weather stays
    };
    strava = installFakeStravaFetch({ activities });
    const runs = [1001, 1002, 1003].map((id) => storedRun(activityOf(id)));
    const { t, store, worker } = build({ tables: { runs, run_weather: [weather(1001), weather(1002), weather(1003), weather(1004)] } });
    for (const id of [1001, 1002, 1003]) seedUpdate(store, id);

    await worker.drain();

    expect(t.run_weather).toEqual([weather(1003), weather(1004)]);
    expect(t.runs.find((run) => run.id === 'run-1001')).toMatchObject({ start_time: '2026-10-12T08:15:00Z' });
    expect(t.runs.find((run) => run.id === 'run-1002')).toMatchObject({ start_lat: 60.1, start_lng: 24.9 });
    // The weather is not fetched here: the run now lacks a run_weather row, which is exactly what the scheduler's
    // WeatherService.backfillMissingWeather looks for (it runs after the backup sync).
    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
  });

  it('update event never writes the xp columns directly', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000, total_elevation_gain: 80, start_date_local: '2026-10-13T07:30:00Z' }) } });
    // The recompute is switched off, so every XP column the row ends with was written by the update handler or not at all.
    const { t, store, worker, runUpdates } = build({
      tables: { runs: [storedRun(activityOf(1001))] },
      recompute: () => createInMemoryRecompute(),
    });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'updated' });
    expect(t.runs[0]).toMatchObject({ distance: 8, date: '2026-10-13', total_elevation_gain: 80, ...XP_OF_THE_STORED_RUN });
    expect(runUpdates).toHaveLength(1);
    for (const column of runUpdates[0]) expect(WRITABLE_COLUMNS).toContain(column);
    for (const column of XP_COLUMNS) expect(runUpdates[0]).not.toContain(column);
  });

  it('update event writes only the columns that differ', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { total_elevation_gain: 80 }) } });
    const { store, worker, runUpdates } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(runUpdates.filter((columns) => !columns.some((c) => XP_COLUMNS.includes(c)))).toEqual([['total_elevation_gain']]);
  });

  it('update to a non-running type removes the run via the shared removal chain', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { sport_type: 'Ride', type: 'Ride' }) } });
    const gone = storedRun(activityOf(1001), { date: '2026-10-11' });
    const later = storedRun(activityOf(1002, { start_date_local: '2026-10-12T07:30:00Z' }), { streak_day: 2, xp_gained: 999 });
    const { t, db, store, worker, reprocessCalls } = build({ tables: { runs: [gone, later], run_weather: [{ run_id: 'run-1001', temperature_c: 9 }] } });
    seedUpdate(store, 1001, { updates: { type: 'Ride' } });

    await worker.drain();

    expect(t.runs.map((run) => run.id)).toEqual(['run-1002']);
    expect(t.runs[0]).toMatchObject({ streak_day: 1 }); // the streak starts over without the removed day
    expect(t.runs[0].xp_gained).not.toBe(999);
    expect(t.run_weather).toEqual([]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'removed_not_running' });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-11' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    // The one deletion query of services/stravaRemoval.ts: only ever a Strava run.
    const deletes = mutations(db, 'runs', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toContainEqual({ op: 'eq', column: 'source', value: 'strava' });
  });

  it('update to private removes the run via the shared removal chain', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { private: true }) } });
    const { t, db, store, worker, reprocessCalls } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001, { updates: { private: 'true' } });

    await worker.drain();

    expect(t.runs).toEqual([]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'removed_private' });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(mutations(db, 'runs', 'delete')[0].filters).toContainEqual({ op: 'eq', column: 'source', value: 'strava' });
  });

  it('update for an activity Strava no longer shows removes the run', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(404) } });
    const { t, store, worker, reprocessCalls } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(t.runs).toEqual([]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
  });

  it('update to public again imports the run again', async () => {
    // Event 1 sees the activity private and removes the run; event 2 (made public again) finds no run and imports it.
    strava = installFakeStravaFetch({ activities: { 1001: answers(activityOf(1001, { private: true }), activityOf(1001, { distance: 6000 })) } });
    const { t, store, worker, reprocessCalls } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001, { updates: { private: 'true' } });
    seedUpdate(store, 1001, { updates: { private: 'false' } });

    await worker.drain();

    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([['done', 'removed_private'], ['done', 'imported']]);
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ external_id: '1001', source: 'strava', date: '2026-10-12', distance: 6 });
    expect(t.runs[0].xp_gained).toBeGreaterThan(0); // the placeholder 0 was recalculated
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledTimes(1);
    expect(checkEventQualification).toHaveBeenCalledTimes(1);
    expect(strava.activityCalls(1001)).toBe(2); // one detail call per event, none for the insert
  });

  it('update for an unknown running activity imports it as a new run', async () => {
    strava = installFakeStravaFetch({ activities: { 2001: activityOf(2001, { average_heartrate: 150 }) } });
    const { t, store, worker, reprocessCalls } = build({ tables: { runs: [storedRun(activityOf(1000, { start_date_local: '2026-10-11T07:30:00Z' }))] } });
    seedUpdate(store, 2001);

    await worker.drain();

    const imported = t.runs.find((run) => run.external_id === '2001')!;
    expect(imported).toMatchObject({ user_id: 'user-1', source: 'strava', date: '2026-10-12', distance: 5, start_time: '2026-10-12T07:30:00Z', avg_heartrate: 150 });
    expect(imported.xp_gained).toBeGreaterThan(0);
    expect(imported.streak_day).toBe(2);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'imported', attempts: 0 });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    // The insert is made from the detail we hold: ONE Strava call, not a second one for the detail.
    expect(strava.activityCalls(2001)).toBe(1);
    expect(strava.requests).toHaveLength(1);
    // A new run is imported like by create: weather and event qualification follow.
    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledWith([expect.objectContaining({ id: imported.id, external_id: '2001' })]);
    expect(checkEventQualification).toHaveBeenCalledWith({ userId: 'user-1', runId: imported.id, runDate: '2026-10-12', distanceKm: 5, isTreadmill: false });
  });

  it('update for an activity dated before the connection day imports nothing', async () => {
    strava = installFakeStravaFetch({ activities: { 3001: activityOf(3001, { start_date_local: '2026-08-15T07:30:00Z' }) } }); // connected 2026-09-01
    const { t, db, store, worker, reprocessCalls } = build();
    seedUpdate(store, 3001);

    await worker.drain();

    expect(t.runs).toEqual([]);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(mutations(db, 'runs', 'insert')).toEqual([]);
    expect(reprocessCalls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
  });

  it('update for an existing run from before the connection day is still updated', async () => {
    const old = activityOf(3001, { start_date_local: '2026-08-15T07:30:00Z' });
    strava = installFakeStravaFetch({ activities: { 3001: { ...old, distance: 7000 } } });
    const { t, store, worker, reprocessCalls } = build({ tables: { runs: [storedRun(old)] } });
    seedUpdate(store, 3001);

    await worker.drain();

    expect(t.runs[0]).toMatchObject({ date: '2026-08-15', distance: 7 });
    expect(store.row(1)).toMatchObject({ outcome: 'updated' });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-08-15' }]);
  });

  it('update does not run event qualification for an existing run', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000 }) } });
    const { store, worker } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ outcome: 'updated' });
    expect(checkEventQualification).not.toHaveBeenCalled();
    expect(WeatherService.fetchAndSaveWeatherForRuns).not.toHaveBeenCalled();
  });

  it('update does not disqualify an event the run already qualified', async () => {
    // The run shrinks from 5 km to 1 km: it would not qualify for a 3 km event any more, but an entry is never taken back.
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 1000 }) } });
    const entry = { id: 'entry-1', event_id: 'event-1', user_id: 'user-1', run_id: 'run-1001', xp_awarded: 40 };
    const { t, db, store, worker } = build({
      tables: { runs: [storedRun(activityOf(1001))], event_entries: [entry], users: [{ id: 'user-1', event_xp: 40 }] },
    });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(t.runs[0]).toMatchObject({ distance: 1 });
    expect(t.event_entries).toEqual([entry]);
    expect(t.users[0].event_xp).toBe(40);
    expect(db.queries.filter((q) => (q.table === 'event_entries' || q.table === 'users') && q.mutation)).toEqual([]);
    expect(checkEventQualification).not.toHaveBeenCalled();
  });

  it('update for a paused user with a visible run is ignored and writes nothing', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000 }), 1002: activityOf(1002, { start_date_local: '2026-10-13T07:30:00Z' }) } });
    const stored = storedRun(activityOf(1001));
    const { t, db, store, worker, reprocessCalls } = build({
      tables: { strava_tokens: [{ ...TOKEN_ROW, sync_paused: true }], runs: [stored] },
    });
    seedUpdate(store, 1001); // differs from Strava
    seedUpdate(store, 1002); // unknown to us

    await worker.drain();

    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([['done', 'ignored_paused'], ['done', 'ignored_paused']]);
    expect(t.runs).toEqual([stored]);
    expect(db.queries.filter((q) => q.table === 'runs' && q.mutation)).toEqual([]);
    expect(reprocessCalls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(strava.activityCalls(1001)).toBe(1); // fetched: the activity might have gone private or changed type
    expect(strava.activityCalls(1002)).toBe(1);
  });

  it('update for a paused user removes a run that went private, changed type or disappeared', async () => {
    strava = installFakeStravaFetch({
      activities: {
        1001: activityOf(1001, { private: true }),
        1002: activityOf(1002, { sport_type: 'Ride', type: 'Ride' }),
        1003: stravaError(404),
        1004: activityOf(1004, { start_date_local: '2026-10-13T07:30:00Z' }),
      },
    });
    const runs = [1001, 1002, 1003, 1004].map((id) => storedRun(activityOf(id), { date: `2026-10-0${id - 1000}` }));
    const { t, store, worker } = build({ tables: { strava_tokens: [{ ...TOKEN_ROW, sync_paused: true }], runs } });
    for (const id of [1001, 1002, 1003, 1004]) seedUpdate(store, id);

    await worker.drain();

    expect(store.rows().map((row) => row.outcome)).toEqual(['removed_private', 'removed_not_running', 'deleted', 'ignored_paused']);
    expect(t.runs.map((run) => run.external_id)).toEqual(['1004']);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('a failed update is a failed attempt, and the retry updates and recomputes', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000 }) } });
    let failing = true;
    const stored = storedRun(activityOf(1001));
    const { t, store, worker, reprocessCalls } = build({
      tables: { runs: [stored] },
      failWhen: (q) => (failing && q.table === 'runs' && q.mutation === 'update' ? ({ message: 'db down', code: '57P01' } as never) : null),
    });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'handler_error:57P01' });
    expect(t.runs[0]).toEqual(stored);
    expect(reprocessCalls).toEqual([]);

    failing = false;
    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'updated', attempts: 1 });
    expect(t.runs[0].distance).toBe(8);
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });

  it('a retry that meets a run already updated by the failed attempt still recomputes', async () => {
    // Attempt 1 wrote the run and died in the reprocess. Attempt 2 finds nothing to change, but an attempt >= 1 always recomputes.
    strava = installFakeStravaFetch({ activities: { 1001: activityOf(1001, { distance: 8000 }) } });
    let failing = true;
    const { t, store, worker, reprocessCalls } = build({
      tables: { runs: [storedRun(activityOf(1001))] },
      recompute: (real) => ({ ...real, reprocessFrom: (userId, from) => (failing ? Promise.reject(Object.assign(new Error('x'), { code: '57P02' })) : real.reprocessFrom(userId, from)) }),
    });
    seedUpdate(store, 1001);

    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'recompute_failed' });
    expect(t.runs[0].distance).toBe(8);

    failing = false;
    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'noop', attempts: 1 });
    expect(t.runs[0].xp_gained).toBeGreaterThan(0);
    expect(t.runs[0].xp_gained).not.toBe(20);
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]); // the failed first try's call threw before it was counted
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
  });
});

describe('the connection and the token', () => {
  it('update event for a user without a Strava connection finishes as ignored_unknown_owner without calling Strava', async () => {
    strava = installFakeStravaFetch({});
    const { t, store, worker } = build({ tables: { strava_tokens: [], runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(t.runs).toHaveLength(1);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_unknown_owner' });
  });

  it('a failed read of the connection is retried: the user is never taken for not paused', async () => {
    strava = installFakeStravaFetch({});
    const { store, worker } = build({ tables: { runs: [storedRun(activityOf(1001))] }, failWhen: (q) => (q.table === 'strava_tokens' ? { message: 'db down' } : null) });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(strava.requests).toHaveLength(0);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'connection_read_failed' });
  });

  it('a token that cannot be renewed is a failed attempt with a short code and changes nothing', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaError(400) });
    const stored = storedRun(activityOf(1001));
    const { t, store, worker } = build({ tables: { runs: [stored], strava_tokens: [{ ...TOKEN_ROW, expires_at: 100 }] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(t.runs).toEqual([stored]);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'token_refresh_failed' });
  });
});

describe('what Strava answers', () => {
  it('a 401 renews the token once and fetches again, then updates', async () => {
    strava = installFakeStravaFetch({
      oauthToken: stravaTokenResponse({ access_token: 'renewed-at', refresh_token: 'new-rt', expires_at: 9999999990 }),
      activities: { 1001: answers(stravaError(401), activityOf(1001, { distance: 8000 })) },
    });
    const { t, store, worker } = build({ tables: { runs: [storedRun(activityOf(1001))] } });
    seedUpdate(store, 1001);

    await worker.drain();

    const reads = strava.requests.filter((request) => request.route === 'activity');
    expect(reads.map((request) => request.headers.authorization)).toEqual(['Bearer old-at', 'Bearer renewed-at']);
    expect(strava.calls.oauthToken).toBe(1);
    expect(t.runs[0].distance).toBe(8);
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'updated', attempts: 0 });
  });

  it('a 5xx is a failed attempt that changes nothing, and the next try updates', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: answers(stravaError(503), activityOf(1001, { distance: 8000 })) } });
    const stored = storedRun(activityOf(1001));
    const { t, store, worker } = build({ tables: { runs: [stored] } });
    seedUpdate(store, 1001);

    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'server_error' });
    expect(t.runs).toEqual([stored]);

    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'updated' });
    expect(t.runs[0].distance).toBe(8);
  });

  it('an answer that is not a usable activity is a failed attempt, never a reason to delete or update', async () => {
    strava = installFakeStravaFetch({ activities: { 1001: { ...activityOf(1001), distance: undefined } as never } });
    const stored = storedRun(activityOf(1001));
    const { t, store, worker } = build({ tables: { runs: [stored] } });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(t.runs).toEqual([stored]);
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('waits for the next quarter hour on a 429 without counting a failed attempt and changes nothing', async () => {
    const budget = createStravaRateBudget({ now: () => START.getTime() });
    restoreHooks = setStravaRequestHooks({ after: (url, response) => budget.recordResponse(url, response) });
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(429) }, rateLimit: { read: { usage: [300, 900] } } });
    const stored = storedRun(activityOf(1001));
    const { t, store, worker } = build({
      tables: { runs: [stored] },
      handlers: { [webhookHandlerKey('activity', 'update')]: createActivityUpdateHandler({ budget }) },
    });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(t.runs).toEqual([stored]);
    const row = store.row(1);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, last_error: 'rate_limit_wait' });
    expect(row.next_attempt_at).toBe(new Date(Math.floor(START.getTime() / (15 * MINUTE)) * 15 * MINUTE + 15 * MINUTE + 30_000).toISOString());
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('waits for UTC midnight when the daily limit is hit', async () => {
    const budget = createStravaRateBudget({ now: () => START.getTime() });
    restoreHooks = setStravaRequestHooks({ after: (url, response) => budget.recordResponse(url, response) });
    strava = installFakeStravaFetch({ activities: { 1001: stravaError(429) }, rateLimit: { read: { usage: [120, 3000] } } });
    const { store, worker } = build({
      tables: { runs: [storedRun(activityOf(1001))] },
      handlers: { [webhookHandlerKey('activity', 'update')]: createActivityUpdateHandler({ budget }) },
    });
    seedUpdate(store, 1001);

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(Date.parse(store.row(1).next_attempt_at)).toBeGreaterThan(START.getTime() + 60 * MINUTE);
  });
});

describe('the handler on its own ports', () => {
  /** A StravaApi that answers with one response for every activity, and counts the calls. */
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
  const ctxFor = (api: StravaApi, runs: ReturnType<typeof createInMemoryRunStore>, attempts = 0) =>
    ({ event: { id: 1, object_id: 4001, aspect_type: 'update' }, userId: 'user-1', attempts, strava: api, runs, now: () => START }) as unknown as WebhookHandlerContext;
  const manualRun = () => {
    const runs = createInMemoryRunStore();
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-11', run: { source: 'manual', date: '2026-10-11', distance: 5 } as never });
    return runs;
  };

  it('update never removes or changes a manual run, whatever Strava answers', async () => {
    const runs = manualRun();
    const handler = createActivityUpdateHandler();

    for (const answer of [
      { kind: 'http' as const, status: 404 },
      { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, sport_type: 'Ride', type: 'Ride' }) },
      { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, private: true }) },
    ]) {
      expect(await handler(ctxFor(apiAnswering(answer), runs))).toMatchObject({ status: 'done', outcome: 'not_a_run', recalculateFrom: null });
    }
    // A visible run under the same id: left alone, not updated and not imported a second time.
    const visible = { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, distance: 9000 }) };
    expect(await handler(ctxFor(apiAnswering(visible), runs))).toMatchObject({ status: 'done', outcome: 'noop', recalculateFrom: null });

    expect(runs.removeCalls).toEqual([]);
    expect(runs.updateCalls).toEqual([]);
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0].run).toMatchObject({ source: 'manual', distance: 5 });
  });

  it('reports the earlier of the stored and the new date for the recalculation', async () => {
    const runs = createInMemoryRunStore();
    const stored = { ...storedRun(stravaActivity({ id: 4001, start_date_local: '2026-10-11T07:30:00Z' })), source: 'strava' } as never;
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-11', run: stored });
    const answer = { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, start_date_local: '2026-10-14T07:30:00Z' }) };

    const result = await createActivityUpdateHandler()(ctxFor(apiAnswering(answer), runs));

    expect(result).toMatchObject({ status: 'done', outcome: 'updated', recalculateFrom: '2026-10-11' });
    expect(result).not.toHaveProperty('importedRuns');
    expect(runs.updateCalls).toHaveLength(1);
    expect(runs.updateCalls[0].patch).toMatchObject({ date: '2026-10-14' });
  });

  it('still recalculates from the stored date when the row was gone by the time of the removal', async () => {
    const runs = createInMemoryRunStore();
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-11', run: { source: 'strava', date: '2026-10-11', distance: 5 } as never });
    runs.removeStravaRun = async () => ({ removed: false, date: null });

    const result = await createActivityUpdateHandler()(ctxFor(apiAnswering({ kind: 'http', status: 404 }), runs));

    expect(result).toMatchObject({ status: 'done', outcome: 'deleted', recalculateFrom: '2026-10-11' });
  });

  it('retries when the run vanished between the read and the update', async () => {
    const runs = createInMemoryRunStore();
    const stored = { ...storedRun(stravaActivity({ id: 4001 })), source: 'strava' } as never;
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-12', run: stored });
    runs.updateStravaRun = async () => ({ updated: false, previousDate: null });
    const answer = { kind: 'http' as const, status: 200, activity: stravaActivity({ id: 4001, distance: 9000 }) };

    expect(await createActivityUpdateHandler()(ctxFor(apiAnswering(answer), runs))).toEqual({ status: 'retry', error: 'run_missing_for_update' });
  });

  it('asks for the weather row to be cleared only when the decision says so', async () => {
    const runs = createInMemoryRunStore();
    const stored = { ...storedRun(stravaActivity({ id: 4001 })), source: 'strava' } as never;
    runs.runs.push({ userId: 'user-1', externalId: '4001', date: '2026-10-12', run: stored });
    const handler = createActivityUpdateHandler();

    await handler(ctxFor(apiAnswering({ kind: 'http', status: 200, activity: stravaActivity({ id: 4001, distance: 9000 }) }), runs));
    await handler(ctxFor(apiAnswering({ kind: 'http', status: 200, activity: stravaActivity({ id: 4001, distance: 9000, start_latlng: [1, 2] }) }), runs));

    expect(runs.updateCalls.map((call) => call.clearWeather)).toEqual([false, true]);
  });
});

describe('the logs', () => {
  it('an update writes no strava id, coordinates or title to logs or activity_log', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
      });
    }
    const leaky = 'failed for 987654321 at 59.3293,18.0686 hr 171 "My secret morning run" owner 555111';
    strava = installFakeStravaFetch({
      activities: { 987654321: activityOf(987654321, { name: 'My secret morning run', distance: 8000, average_heartrate: 171, max_heartrate: 188 }) },
    });
    let failing = true;
    const { t, store, worker } = build({
      tables: { runs: [storedRun(activityOf(987654321), { id: 'r1' })] },
      failWhen: (q) => (failing && q.table === 'runs' && q.mutation === 'update' ? ({ message: leaky, code: '57P01' } as never) : null),
    });
    const seed = () => store.seed({ object_id: 987654321, aspect_type: 'update', owner_id: 555111 });

    seed(); // 1: the update itself fails
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'handler_error:57P01' });

    failing = false; // 2: it works
    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'updated' });

    seed(); // 3: a fresh delivery: the no-op path logs nothing about the activity either
    await worker.drain();

    const text = [lines.join('\n'), JSON.stringify(t.activity_log ?? []), JSON.stringify(store.rows().map((row) => row.last_error))].join('\n');
    expect(lines.some((line) => line.includes('user-1'))).toBe(true); // the failure IS logged, with our user id and a code
    expect(text).toContain('57P01');
    for (const secret of ['987654321', '555111', '59.3293', '18.0686', '188', 'secret morning', 'old-at']) expect(text).not.toContain(secret);
    expect(text).not.toContain('hr 171');
  });
});

describe('registration', () => {
  it('is registered for activity:update in the default registry, next to create and delete', () => {
    expect(STRAVA_WEBHOOK_HANDLERS[webhookHandlerKey('activity', 'update')]).toBeTypeOf('function');
    expect(STRAVA_WEBHOOK_HANDLERS[webhookHandlerKey('activity', 'create')]).toBeTypeOf('function');
    expect(STRAVA_WEBHOOK_HANDLERS[webhookHandlerKey('activity', 'delete')]).toBeTypeOf('function');
  });
});
