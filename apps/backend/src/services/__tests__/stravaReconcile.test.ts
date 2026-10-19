/**
 * The nightly Strava reconcile (services/stravaReconcile.ts), as behaviour: the real Supabase adapters against createFakeDb (wrapped
 * in the foreign key actions of the migrations), the real Strava client against installFakeStravaFetch, the real update handler and
 * the real reprocessRunsFromDate. Mocked at the edge: calculateUserTotals (asserted as a call), the weather service and event
 * qualification. Nothing here reaches Strava: a request the test did not configure fails the test.
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
import { plainRow, tokenCols } from '../../test-utils/stravaTokens.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { withUserLock } from '../../utils/keyedMutex.js';
import { buildStravaRunRow } from '../stravaImport.js';
import { createStravaRateBudget } from '../stravaRateBudget.js';
import { setStravaRequestHooks } from '../stravaClient.js';
import { createStravaReconciler, type ReconcileDeps } from '../stravaReconcile.js';
import { createRecalculationRecovery } from '../recalculationMarks/recovery.js';
import { createInMemoryMarkStore, type InMemoryMarkStore } from '../../test-utils/inMemoryRecalculationMarks.js';
import { createReconcilePorts } from '../stravaReconcile/adapters.js';
import { nightIndex } from '../stravaReconcile/plan.js';
import type { ReconcilePorts } from '../stravaReconcile/ports.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import type { Recompute } from '../stravaWebhook/ports.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import {
  installFakeStravaFetch,
  stravaActivity,
  stravaError,
  type FakeStrava,
  type FakeStravaRoutes,
} from '../../test-utils/fakeStrava.js';

// 04:15 in Stockholm (CEST) on 17 October. The list window (30 days) starts on 17 September, its checked part on 18 September.
const NIGHT = new Date('2026-10-17T02:15:00.000Z');
const now = () => NIGHT;

let strava: FakeStrava | undefined;
let restoreHooks: (() => void) | undefined;
let logLines: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  logLines = [];
  const collect = (...args: unknown[]) => {
    logLines.push(args.map(String).join(' '));
  };
  vi.spyOn(logger, 'info').mockImplementation(collect);
  vi.spyOn(logger, 'warn').mockImplementation(collect);
  vi.spyOn(logger, 'error').mockImplementation(collect);
});
afterEach(() => {
  restoreHooks?.();
  restoreHooks = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  strava?.restore(); // throws when the code reached a Strava URL the test did not configure
  strava = undefined;
});

const tokenRow = (userId: string, over: Row = {}): Row => ({
  user_id: userId,
  ...tokenCols(userId, 'old-at', 'old-rt'),
  expires_at: 9999999999,
  connection_date: '2026-01-01T09:00:00+00:00',
  sync_paused: false,
  ...over,
});

const XP_OF_THE_STORED_RUN = { xp_gained: 20, base_xp: 20, km_xp: 15, distance_bonus: 5, streak_bonus: 0, multiplier: 1, streak_day: 1 };

/** An activity as Strava shows it: 07:30 local on 12 October unless the test says otherwise. Ids are long on purpose, so a log leak is easy to see. */
const activityOf = (id: number, over: Parameters<typeof stravaActivity>[0] = {}) =>
  stravaActivity({ id, start_date: '2026-10-12T05:30:00Z', start_date_local: '2026-10-12T07:30:00Z', ...over });

/** The run row that holds `activity` exactly as the import would have stored it. */
const storedRun = (activity: ReturnType<typeof stravaActivity>, userId = 'user-1', over: Row = {}): Row => {
  const { created_at: _createdAt, ...columns } = buildStravaRunRow(userId, activity, activity);
  return { id: `run-${activity.id}`, ...columns, ...XP_OF_THE_STORED_RUN, ...over };
};

interface Setup {
  tables?: Partial<Record<string, Row[]>>;
  failWhen?: FakeDbOptions['failWhen'];
  routes?: FakeStravaRoutes;
  recompute?: (real: Recompute) => Recompute;
  ports?: (real: ReconcilePorts) => ReconcilePorts;
  deps?: Partial<ReconcileDeps>;
  /** The recalculation marks the reconcile writes (migration 057). Default: a fresh in-memory store. */
  marks?: InMemoryMarkStore;
}

function build(setup: Setup = {}) {
  const t: Record<string, Row[]> = {
    strava_tokens: [tokenRow('user-1')],
    runs: [],
    user_boosts: [],
    run_weather: [],
    event_entries: [],
    user_badges: [],
    users: [{ id: 'user-1', event_xp: 0 }, { id: 'user-2', event_xp: 0 }],
    ...(setup.tables as Record<string, Row[]>),
  };
  const db = createFakeDb(t, {
    autoIds: true,
    failWhen: setup.failWhen,
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
    primaryKeys: { strava_tokens: ['user_id'] },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, t) as any);
  strava = installFakeStravaFetch(setup.routes ?? {});

  const reprocessCalls: Array<{ userId: string; fromDate: string }> = [];
  const real = createRecompute();
  const counting: Recompute = {
    ...real,
    reprocessFrom: (userId, fromDate) => {
      reprocessCalls.push({ userId, fromDate });
      return real.reprocessFrom(userId, fromDate);
    },
  };
  const realPorts = createReconcilePorts();
  const marks = setup.marks ?? createInMemoryMarkStore();
  const reconciler = createStravaReconciler({
    ports: setup.ports ? setup.ports(realPorts) : realPorts,
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: setup.recompute ? setup.recompute(counting) : counting,
    marks,
    now,
    ...setup.deps,
  });
  /** The job that picks up what a night left marked, with the real recalculation (the counting one, so a test sees the dates). */
  const recovery = createRecalculationRecovery({ store: marks, recompute: counting });
  return { t, db, reconciler, reprocessCalls, strava: strava!, marks, recovery };
}

const ids = (rows: Row[]) => rows.map((row) => row.external_id).sort();

describe('nightly reconcile', () => {
  it('reconcile deletes a run that Strava reports as 404', async () => {
    const kept = activityOf(7345001);
    const gone = activityOf(7345002, { start_date: '2026-10-13T05:30:00Z', start_date_local: '2026-10-13T07:30:00Z' });
    const { t, reconciler, reprocessCalls, strava } = build({
      tables: { runs: [storedRun(kept), storedRun(gone)] },
      routes: { athleteActivities: [kept], activities: {} }, // 7345002 is not in the list and the detail call answers 404
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001']);
    expect(summary).toMatchObject({ checked: 1, removed: 1, updated: 0, failed: 0 });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-13' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(strava.activityCalls(7345002)).toBe(1);
    expect(strava.activityCalls(7345001)).toBe(0); // listed and unchanged: no detail call
  });

  it('reconcile keeps a run when Strava lookup fails with a non-404 error', async () => {
    // The handler's own word for the failure ends up in the log: a server error or a status Strava does not use for a missing activity.
    const failures = [
      { answer: stravaError(500), reason: 'server_error' },
      { answer: stravaError(502), reason: 'server_error' },
      { answer: stravaError(403), reason: 'unexpected_status' },
      { answer: stravaError(410), reason: 'unexpected_status' },
    ];
    for (const { answer: failure, reason } of failures) {
      const listedRun = activityOf(7345001);
      const unknown = activityOf(7345002);
      const { t, reconciler, strava } = build({
        tables: { runs: [storedRun(listedRun), storedRun(unknown)] },
        routes: { athleteActivities: [listedRun], activities: { 7345002: failure } },
      });

      const summary = await reconciler.run();

      expect(ids(t.runs), `status ${failure.status}`).toEqual(['7345001', '7345002']);
      expect(summary.removed, `status ${failure.status}`).toBe(0);
      expect(calculateUserTotals, `status ${failure.status}`).not.toHaveBeenCalled();
      expect(strava.activityCalls(7345002), `status ${failure.status}`).toBe(1);
      // The log says that and why, by code, and never which activity.
      expect(logLines.join('\n'), `status ${failure.status}`).toContain(reason);
      expect(logLines.join('\n')).not.toContain('7345002');
      strava.restore();
      vi.mocked(calculateUserTotals).mockClear();
    }
  });

  it('reconcile stops for the night and keeps the run when Strava answers 429', async () => {
    const listedRun = activityOf(7345001);
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(listedRun), storedRun(activityOf(7345002)), storedRun(activityOf(7345003))] },
      routes: { athleteActivities: [listedRun], activities: { 7345002: stravaError(429), 7345003: stravaError(404) } },
    });

    const summary = await reconciler.run();

    expect(summary.stopped).toBe('rate_limit');
    expect(ids(t.runs)).toEqual(['7345001', '7345002', '7345003']); // the check after the 429 waits for the next night
    expect(strava.calls.activity).toBe(1);
  });

  it('reconcile keeps a run when the lookup fails on the network', async () => {
    const listedRun = activityOf(7345001);
    const unknown = activityOf(7345002);
    const { t, reconciler } = build({
      tables: { runs: [storedRun(listedRun), storedRun(unknown)] },
      routes: {
        athleteActivities: [listedRun],
        activities: {
          7345002: () => {
            throw new Error('connection reset');
          },
        },
      },
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001', '7345002']);
    expect(summary).toMatchObject({ removed: 0, failed: 1 });
  });

  it('reconcile never deletes anything when the user\'s token cannot be refreshed', async () => {
    const expired = { expires_at: 1 };
    const refreshFailures = [
      { label: 'rejected', answer: stravaError(400, { body: { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } }) },
      { label: 'server error', answer: stravaError(500) },
    ];
    for (const { label, answer } of refreshFailures) {
      const a = activityOf(7345001);
      const { t, reconciler, strava } = build({
        tables: { strava_tokens: [tokenRow('user-1', expired)], runs: [storedRun(a), storedRun(activityOf(7345002))] },
        routes: { oauthToken: answer, athleteActivities: [], activities: {} },
      });

      const summary = await reconciler.run();

      expect(ids(t.runs), label).toEqual(['7345001', '7345002']);
      expect(summary, label).toMatchObject({ removed: 0, updated: 0 });
      expect(strava.calls.oauthToken, label).toBe(1);
      expect(strava.calls.athleteActivities, label).toBe(0); // no list without a token, so nothing to compare
      expect(strava.calls.activity, label).toBe(0);
      expect(calculateUserTotals, label).not.toHaveBeenCalled();
      strava.restore();
    }
  });

  it('reconcile never deletes anything when the activity list fails', async () => {
    for (const answer of [stravaError(500), stravaError(401), stravaError(429)]) {
      const { t, reconciler, strava } = build({
        tables: { runs: [storedRun(activityOf(7345001)), storedRun(activityOf(7345002))] },
        routes: { athleteActivities: answer, activities: {} },
      });

      const summary = await reconciler.run();

      expect(ids(t.runs), `status ${answer.status}`).toEqual(['7345001', '7345002']);
      expect(summary.removed).toBe(0);
      expect(strava.calls.activity, `status ${answer.status}`).toBe(0); // an empty or missing list must not turn into 404 checks
      strava.restore();
    }
  });

  it('reconcile never deletes anything when the list may be cut short', async () => {
    // Five full pages of 200 and the list is still not finished: what is missing from it proves nothing.
    const page = Array.from({ length: 200 }, (_, i) => activityOf(8000000 + i));
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(activityOf(7345001))] },
      routes: { athleteActivities: Array.from({ length: 5 }, () => page).flat(), activities: {} },
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001']);
    expect(summary.removed).toBe(0);
    expect(strava.calls.activity).toBe(0);
  });

  it('reconcile reads the whole list when it takes more than one page', async () => {
    // 250 activities over 2 pages; the stored run is on the second page and must not be mistaken for a missing one.
    const filler = Array.from({ length: 249 }, (_, i) => activityOf(8000000 + i));
    const wanted = activityOf(7345001);
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(wanted)] },
      routes: { athleteActivities: [...filler, wanted], activities: {} },
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001']);
    expect(summary).toMatchObject({ removed: 0, updated: 0, failed: 0 });
    expect(strava.calls.athleteActivities).toBe(2);
    expect(strava.calls.activity).toBe(0);
  });

  it('reconcile updates a run whose distance or start date changed on Strava', async () => {
    const before = activityOf(7345001);
    const movedBefore = activityOf(7345002);
    const same = activityOf(7345003);
    const later = storedRun(activityOf(7345004, { start_date: '2026-10-14T05:30:00Z', start_date_local: '2026-10-14T07:30:00Z' }), 'user-1', { streak_day: 5, xp_gained: 999 });
    const { t, reconciler, reprocessCalls, strava } = build({
      tables: { runs: [storedRun(before), storedRun(movedBefore), storedRun(same), later] },
      routes: {
        athleteActivities: [
          activityOf(7345001, { distance: 8000 }), // longer
          activityOf(7345002, { start_date: '2026-10-15T05:30:00Z', start_date_local: '2026-10-15T07:30:00Z' }), // moved to the 15th
          same,
          activityOf(7345004, { start_date: '2026-10-14T05:30:00Z', start_date_local: '2026-10-14T07:30:00Z' }),
        ],
        activities: {
          7345001: activityOf(7345001, { distance: 8000 }),
          7345002: activityOf(7345002, { start_date: '2026-10-15T05:30:00Z', start_date_local: '2026-10-15T07:30:00Z' }),
        },
      },
    });

    const summary = await reconciler.run();

    expect(summary).toMatchObject({ checked: 2, removed: 0, updated: 2, failed: 0 });
    expect(t.runs.find((r) => r.external_id === '7345001')).toMatchObject({ distance: 8, date: '2026-10-12' });
    expect(t.runs.find((r) => r.external_id === '7345002')).toMatchObject({ date: '2026-10-15' });
    // XP is the reprocess's to write: the updated run no longer holds the placeholder it was stored with, and nothing is copied from Strava.
    expect(t.runs.find((r) => r.external_id === '7345001')!.xp_gained).not.toBe(20);
    // ONE reprocess, from the earliest affected date, and ONE totals run for both changes.
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(strava.activityCalls(7345003)).toBe(0);
    expect(strava.activityCalls(7345004)).toBe(0);
  });

  it('reconcile removes a run whose activity turned into something else than a run', async () => {
    const ride = activityOf(7345001);
    const { t, reconciler, reprocessCalls } = build({
      tables: { runs: [storedRun(ride)] },
      routes: {
        athleteActivities: [activityOf(7345001, { sport_type: 'Ride', type: 'Ride' })],
        activities: { 7345001: activityOf(7345001, { sport_type: 'Ride', type: 'Ride' }) },
      },
    });

    const summary = await reconciler.run();

    expect(t.runs).toEqual([]);
    expect(summary).toMatchObject({ removed: 1 });
    expect(reprocessCalls).toHaveLength(1);
  });

  it('reconcile checks the older runs on a rotation and finds a deletion there', async () => {
    const old = (n: number) => activityOf(7346000 + n, { start_date: `2026-07-0${n}T05:30:00Z`, start_date_local: `2026-07-0${n}T07:30:00Z` });
    const runs = [1, 2, 3, 4, 5, 6].map((n) => storedRun(old(n)));
    const { t, reconciler, strava } = build({
      tables: { runs },
      routes: {
        athleteActivities: [],
        // Only run 3 was deleted on Strava; the others still answer.
        activities: Object.fromEntries([1, 2, 4, 5, 6].map((n) => [7346000 + n, old(n)])),
      },
      deps: { oldRunsPerUser: 6 },
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7346001', '7346002', '7346004', '7346005', '7346006']);
    expect(summary).toMatchObject({ checked: 6, removed: 1 });
    expect(strava.calls.activity).toBe(6);
  });

  it('reconcile checks at most the per-user count of older runs a night and moves on the next night', async () => {
    const old = (n: number) => activityOf(7346000 + n, { start_date: `2026-07-0${n}T05:30:00Z`, start_date_local: `2026-07-0${n}T07:30:00Z` });
    const runs = [1, 2, 3, 4, 5, 6].map((n) => storedRun(old(n)));
    const routes = { athleteActivities: [], activities: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [7346000 + n, old(n)])) };
    const night = (day: string) => new Date(`${day}T02:15:00.000Z`);
    const seen = new Set<number>();
    const nightlyCalls: number[] = [];

    for (const day of ['2026-10-17', '2026-10-18', '2026-10-19']) {
      const nightly = build({ tables: { runs: runs.map((r) => ({ ...r })) }, routes, deps: { oldRunsPerUser: 2, now: () => night(day) } });
      await nightly.reconciler.run();
      nightlyCalls.push(nightly.strava.calls.activity);
      for (const n of [1, 2, 3, 4, 5, 6]) if (nightly.strava.activityCalls(7346000 + n) > 0) seen.add(n);
      nightly.strava.restore();
    }

    expect(nightlyCalls).toEqual([2, 2, 2]);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]); // three nights, six runs, two a night: all of them had their turn
  });

  it('reconcile respects the nightly request budget', async () => {
    const old = (user: string, n: number) =>
      activityOf(Number(`${user === 'user-1' ? 71 : 72}000${String(n).padStart(2, '0')}`), {
        start_date: '2026-07-01T05:30:00Z',
        start_date_local: '2026-07-01T07:30:00Z',
      });
    const mine = Array.from({ length: 30 }, (_, i) => old('user-1', i));
    const theirs = Array.from({ length: 30 }, (_, i) => old('user-2', i));
    const everything = [...mine, ...theirs];
    const { reconciler, strava } = build({
      tables: {
        strava_tokens: [tokenRow('user-1'), tokenRow('user-2')],
        runs: [...mine.map((a) => storedRun(a, 'user-1')), ...theirs.map((a) => storedRun(a, 'user-2'))],
      },
      routes: { athleteActivities: [], activities: Object.fromEntries(everything.map((a) => [a.id, a])) },
      deps: { requestBudget: 10, oldRunsPerUser: 20 },
    });

    const summary = await reconciler.run();

    expect(strava.requests.length).toBeLessThanOrEqual(10);
    expect(summary.requests).toBe(strava.requests.length);
    expect(summary.requests).toBeGreaterThan(0);
    // Both users got a list and a share of the older runs: the first user does not eat the night.
    expect(strava.calls.athleteActivities).toBe(2);
    expect(strava.calls.activity).toBeGreaterThan(2);
  });

  it('reconcile does not read a page of the list that the budget has no request for', async () => {
    const filler = Array.from({ length: 249 }, (_, i) => activityOf(8000000 + i));
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(activityOf(7345001))] },
      routes: { athleteActivities: filler, activities: {} },
      deps: { requestBudget: 1 },
    });

    const summary = await reconciler.run();

    expect(strava.requests.length).toBe(1); // page 1 only
    expect(summary).toMatchObject({ removed: 0, skippedUnavailable: 1, stopped: 'budget' });
    expect(ids(t.runs)).toEqual(['7345001']); // half a list is no list: nothing was judged by it
  });

  it('reconcile does not renew a token that the budget has no request for', async () => {
    const gone = activityOf(7345001);
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(gone)] },
      routes: {
        athleteActivities: [],
        activities: { 7345001: () => stravaError(401) },
        oauthToken: { token_type: 'Bearer', access_token: 'new-at', refresh_token: 'new-rt', expires_at: 9999999999, expires_in: 21600 },
      },
      deps: { requestBudget: 2 }, // the list and the lookup; the renewal that the 401 asks for would be a third
    });

    const summary = await reconciler.run();

    expect(strava.requests.length).toBe(2);
    expect(strava.calls.oauthToken).toBe(0);
    expect(summary).toMatchObject({ removed: 0, failed: 1 });
    expect(ids(t.runs)).toEqual(['7345001']);
  });

  it('reconcile makes no Strava request for a user without Strava runs', async () => {
    // An expired token would cost a renewal request; a user with nothing to reconcile must not even get that far.
    const manual = storedRun(activityOf(7345001), 'user-1', { source: 'manual', external_id: null, id: 'manual-1' });
    const { reconciler, strava } = build({
      tables: { strava_tokens: [tokenRow('user-1', { expires_at: 1 })], runs: [manual] },
      routes: {}, // any request at all fails the test
    });

    const summary = await reconciler.run();

    expect(strava.requests).toEqual([]);
    expect(summary).toMatchObject({ users: 1, checked: 0, requests: 0, skippedUnavailable: 0 });
  });

  it('reconcile leaves budget for later users when one user has many runs in doubt', async () => {
    // user-1 is first on an even night. Their list is empty (a Strava fault), so all 60 runs look missing; user-2 has 30 old runs.
    const evenNight = [new Date('2026-10-17T02:15:00.000Z'), new Date('2026-10-18T02:15:00.000Z')].find((day) => nightIndex(day) % 2 === 0)!;
    const missing = Array.from({ length: 60 }, (_, i) => activityOf(7350000 + i));
    const old = Array.from({ length: 30 }, (_, i) => activityOf(7360000 + i, { start_date: '2026-07-01T05:30:00Z', start_date_local: '2026-07-01T07:30:00Z' }));
    const { reconciler, strava } = build({
      tables: {
        strava_tokens: [tokenRow('user-1'), tokenRow('user-2')],
        runs: [...missing.map((a) => storedRun(a, 'user-1')), ...old.map((a) => storedRun(a, 'user-2'))],
      },
      routes: { athleteActivities: [], activities: { ...Object.fromEntries(missing.map((a) => [a.id, stravaError(500)])), ...Object.fromEntries(old.map((a) => [a.id, a])) } }, // the 60 fail (no removal cap to stop them), the old ones answer
      deps: { requestBudget: 40, now: () => evenNight },
    });

    const summary = await reconciler.run();

    const usersLooked = (ids: number[]) => ids.reduce((sum, id) => sum + strava.activityCalls(id), 0);
    expect(strava.requests.length).toBeLessThanOrEqual(40);
    expect(strava.calls.athleteActivities).toBe(2); // the second user was listed
    expect(usersLooked(missing.map((a) => a.id))).toBeLessThanOrEqual(19 + 5); // an even share of the 39 left after the list, plus the margin
    expect(usersLooked(old.map((a) => a.id))).toBeGreaterThan(0); // and still had room for their rotation
    expect(summary.stopped).toBeNull();
  });

  it('reconcile spends no more than the budget even when every run is in doubt', async () => {
    const stored = Array.from({ length: 12 }, (_, i) => activityOf(7347000 + i));
    const { t, reconciler, strava } = build({
      tables: { runs: stored.map((a) => storedRun(a)) },
      routes: { athleteActivities: [], activities: {} }, // every run is missing from the list and answers 404
      deps: { requestBudget: 5 },
    });

    const summary = await reconciler.run();

    expect(strava.requests.length).toBeLessThanOrEqual(5);
    expect(summary.stopped).toBe('budget');
    // What was confirmed gone went; what was not reached stays for the next night.
    expect(t.runs.length).toBe(12 - summary.removed);
    expect(summary.removed).toBe(4); // 1 for the list, 4 for the checks
  });

  it('reconcile removes at most the cap of runs from one user in a night and finishes the next night', async () => {
    // Fourteen runs Strava says are gone (not in the list, 404 on the lookup): the night removes ten, the next one the other four.
    const stored = Array.from({ length: 14 }, (_, i) => activityOf(7348000 + i));
    const routes = { athleteActivities: [], activities: {} };
    const first = build({ tables: { runs: stored.map((a) => storedRun(a)) }, routes });

    const night1 = await first.reconciler.run();

    expect(night1.removed).toBe(10);
    expect(first.t.runs).toHaveLength(4);
    expect(logLines.join('\n')).toContain('the cap');
    expect(first.reprocessCalls).toHaveLength(1); // the ten are one recalculation
    first.strava.restore();

    const second = build({ tables: { runs: first.t.runs.map((r) => ({ ...r })) }, routes });
    const night2 = await second.reconciler.run();

    expect(night2.removed).toBe(4);
    expect(second.t.runs).toEqual([]);
  });

  it('reconcile asks about an id only when it is written the way Strava writes it', async () => {
    // '007' and '1e3' would be looked up as 7 and 1000: another activity than the one stored.
    const odd = [storedRun(activityOf(7345001), 'user-1', { external_id: '007', id: 'odd-1' }), storedRun(activityOf(7345002), 'user-1', { external_id: '1e3', id: 'odd-2' })];
    const { t, reconciler, strava } = build({ tables: { runs: odd }, routes: { athleteActivities: [], activities: {} } });

    const summary = await reconciler.run();

    expect(t.runs).toHaveLength(2);
    expect(summary).toMatchObject({ checked: 0, removed: 0 });
    expect(strava.calls.activity).toBe(0);
  });

  it('reconcile stops for the night when the Strava rate budget is over its soft limit', async () => {
    const rate = createStravaRateBudget({ now: () => NIGHT.getTime() });
    restoreHooks = setStravaRequestHooks({ after: (url, response) => rate.recordResponse(url, response) });
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(activityOf(7345001)), storedRun(activityOf(7345002))] },
      routes: {
        athleteActivities: [activityOf(7345001)],
        activities: {},
        rateLimit: { read: { usage: [250, 400] } }, // the 15 minute window is at 250 of 300: over the soft limit of 210
      },
      deps: { budget: rate },
    });

    const summary = await reconciler.run();

    expect(summary.stopped).toBe('rate_limit');
    expect(strava.calls.activity).toBe(0); // the list went through (and told the budget), the checks did not
    expect(ids(t.runs)).toEqual(['7345001', '7345002']);
  });

  it('reconcile is idempotent', async () => {
    const kept = activityOf(7345001);
    const changed = activityOf(7345002);
    const gone = activityOf(7345003);
    const { t, reconciler, reprocessCalls } = build({
      tables: { runs: [storedRun(kept), storedRun(changed), storedRun(gone)] },
      routes: {
        athleteActivities: [kept, activityOf(7345002, { distance: 9000 })],
        activities: { 7345002: activityOf(7345002, { distance: 9000 }) },
      },
    });

    const first = await reconciler.run();
    const afterFirst = JSON.parse(JSON.stringify(t.runs));
    const reprocessAfterFirst = reprocessCalls.length;
    const totalsAfterFirst = vi.mocked(calculateUserTotals).mock.calls.length;
    const second = await reconciler.run();

    expect(first).toMatchObject({ removed: 1, updated: 1 });
    expect(second).toMatchObject({ removed: 0, updated: 0, failed: 0 });
    expect(t.runs).toEqual(afterFirst);
    expect(reprocessCalls).toHaveLength(reprocessAfterFirst);
    expect(calculateUserTotals).toHaveBeenCalledTimes(totalsAfterFirst);
  });

  it('reconcile only removes runs for paused users', async () => {
    const changed = activityOf(7345001);
    const gone = activityOf(7345002, { start_date: '2026-10-13T05:30:00Z', start_date_local: '2026-10-13T07:30:00Z' });
    const ride = activityOf(7345003);
    const { t, reconciler, reprocessCalls, strava } = build({
      tables: {
        strava_tokens: [tokenRow('user-1', { sync_paused: true })],
        runs: [storedRun(changed), storedRun(gone), storedRun(ride)],
      },
      routes: {
        athleteActivities: [
          activityOf(7345001, { distance: 8000, start_date: '2026-10-15T05:30:00Z', start_date_local: '2026-10-15T07:30:00Z' }), // longer and moved
          activityOf(7345003, { sport_type: 'Ride', type: 'Ride' }),
        ],
        activities: {
          7345001: activityOf(7345001, { distance: 8000, start_date: '2026-10-15T05:30:00Z', start_date_local: '2026-10-15T07:30:00Z' }),
          7345003: activityOf(7345003, { sport_type: 'Ride', type: 'Ride' }),
        },
      },
    });
    const before = JSON.parse(JSON.stringify(t.runs.find((r) => r.external_id === '7345001')));

    const summary = await reconciler.run();

    // The 404 run and the run that became a ride go (the deletion rules hold under a pause); the changed run is left exactly as it was.
    expect(ids(t.runs)).toEqual(['7345001']);
    expect(t.runs[0]).toMatchObject({ date: before.date, distance: before.distance, start_time: before.start_time }); // XP may follow the reprocess; Strava's columns do not move
    expect(summary).toMatchObject({ users: 1, pausedUsers: 1, removed: 2, updated: 0, failed: 0 });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-12' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(strava.activityCalls(7345002)).toBe(1);
  });

  it('reconcile imports nothing and updates nothing for a paused user', async () => {
    const { t, reconciler } = build({
      tables: { strava_tokens: [tokenRow('user-1', { sync_paused: true })], runs: [storedRun(activityOf(7345001))] },
      routes: {
        athleteActivities: [activityOf(7345001, { distance: 9000 }), activityOf(7349999)], // a changed run and a new activity
        activities: { 7345001: activityOf(7345001, { distance: 9000 }) },
      },
    });

    const summary = await reconciler.run();

    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ distance: 5 });
    expect(summary).toMatchObject({ removed: 0, updated: 0 });
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('reconcile treats a user paused after the night began as paused: removals only', async () => {
    // The user list was read while the user was not paused; the pause lands while the list is on its way back.
    const { t, reconciler } = build({
      tables: { runs: [storedRun(activityOf(7345001)), storedRun(activityOf(7345002)), storedRun(activityOf(7345003))] },
      routes: {
        athleteActivities: [activityOf(7345001, { distance: 8000 }), activityOf(7345002)],
        activities: { 7345001: activityOf(7345001, { distance: 8000 }) }, // 7345003 is gone
      },
      ports: (real) => ({
        ...real,
        listActivities: async (...args) => {
          const result = await real.listActivities(...args);
          await (getSupabaseClient() as any).from('strava_tokens').update({ sync_paused: true }).eq('user_id', 'user-1');
          return result;
        },
      }),
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001', '7345002']);
    expect(t.runs.find((r) => r.external_id === '7345001')).toMatchObject({ distance: 5 });
    expect(summary).toMatchObject({ removed: 1, updated: 0 });
  });

  it('reconcile skips a user who is not connected any more', async () => {
    const { t, reconciler, strava } = build({
      tables: { strava_tokens: [], runs: [storedRun(activityOf(7345001))] },
      routes: {},
    });

    const summary = await reconciler.run();

    expect(summary.users).toBe(0);
    expect(strava.requests).toEqual([]);
    expect(ids(t.runs)).toEqual(['7345001']);
  });

  it('reconcile never touches a manual run, also when its id looks like a missing Strava activity', async () => {
    const manual = storedRun(activityOf(7345001), 'user-1', { source: 'manual', external_id: null, id: 'manual-1' });
    const { t, reconciler, strava } = build({
      tables: { runs: [manual] },
      routes: {},
    });

    const summary = await reconciler.run();

    expect(t.runs).toHaveLength(1);
    expect(summary.checked).toBe(0);
    expect(strava.requests).toEqual([]);
  });

  it('reconcile takes the user lock for the changes it makes', async () => {
    const gone = activityOf(7345001);
    const order: string[] = [];
    const { reconciler } = build({
      tables: { runs: [storedRun(gone)] },
      routes: { athleteActivities: [], activities: {} },
      recompute: (real) => ({
        ...real,
        reprocessFrom: async (userId, from) => {
          order.push('reprocess');
          await real.reprocessFrom(userId, from);
        },
      }),
    });

    // A poll holding the user's lock: the reconcile may read and list, but nothing is checked or deleted until the poll lets go.
    let release!: () => void;
    const holding = withUserLock('user-1', () => new Promise<void>((resolve) => { release = resolve; }));
    const running = reconciler.run().then((summary) => {
      order.push('reconcile done');
      return summary;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual([]);
    release();
    await holding;
    const summary = await running;

    expect(order).toEqual(['reprocess', 'reconcile done']);
    expect(summary.removed).toBe(1);
  });

  it('reconcile does not stop on one user failing', async () => {
    const mine = activityOf(7345001);
    const theirs = activityOf(7345002);
    const { t, reconciler } = build({
      tables: {
        strava_tokens: [tokenRow('user-1'), tokenRow('user-2')],
        runs: [storedRun(mine, 'user-1'), storedRun(theirs, 'user-2')],
      },
      routes: { athleteActivities: [], activities: {} },
      failWhen: (q) => (q.table === 'runs' && q.filters.some((f) => f.column === 'user_id' && f.value === 'user-1') && !q.mutation ? { code: '57014', message: 'timeout' } : null),
    });

    const summary = await reconciler.run();

    expect(summary.removed).toBe(1); // user-2's run is gone; user-1's runs could not even be read
    expect(ids(t.runs)).toEqual(['7345001']);
  });

  it('reconcile logs counts and codes, never a Strava id, a title or a token', async () => {
    const gone = activityOf(7345001, { name: 'Secret Title Run' });
    const { reconciler } = build({
      tables: { runs: [storedRun(gone), storedRun(activityOf(7345002))] },
      routes: { athleteActivities: [], activities: { 7345002: stravaError(500) } },
    });

    await reconciler.run();

    const all = logLines.join('\n');
    expect(all).not.toContain('7345001');
    expect(all).not.toContain('7345002');
    expect(all).not.toContain('Secret Title Run');
    expect(all).not.toContain('old-at');
    expect(all).not.toContain('old-rt');
  });

  it('reconcile tries the recalculation again once when it fails after a deletion', async () => {
    const gone = activityOf(7345001);
    let attempts = 0;
    const { t, reconciler, reprocessCalls } = build({
      tables: { runs: [storedRun(gone)] },
      routes: { athleteActivities: [], activities: {} },
      recompute: (real) => ({
        ...real,
        reprocessFrom: async (userId, from) => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error('boom'), { code: '57014' });
          await real.reprocessFrom(userId, from);
        },
      }),
    });

    const summary = await reconciler.run();

    expect(t.runs).toEqual([]);
    expect(summary.removed).toBe(1);
    expect(attempts).toBe(2);
    expect(reprocessCalls).toHaveLength(1); // the failing wrapper sits in front of the counting one: only the second try got through
    expect(calculateUserTotals).toHaveBeenCalledTimes(1); // totals only after a reprocess that worked
  });
});

describe('nightly reconcile and the recalculation marks', () => {
  const D12 = { start_date: '2026-10-12T05:30:00Z', start_date_local: '2026-10-12T07:30:00Z' };
  const D13 = { start_date: '2026-10-13T05:30:00Z', start_date_local: '2026-10-13T07:30:00Z' };
  const D14 = { start_date: '2026-10-14T05:30:00Z', start_date_local: '2026-10-14T07:30:00Z' };
  const boom = () => Object.assign(new Error('boom'), { code: '57014' });

  /** Three runs on three days in a row: the 13th is gone on Strava, and the 14th still holds the streak and XP it had with the 13th. */
  const threeDays = () => {
    const first = activityOf(7345001, D12);
    const gone = activityOf(7345002, D13);
    const last = activityOf(7345003, D14);
    return {
      tables: {
        runs: [
          storedRun(first, 'user-1', { streak_day: 1 }),
          storedRun(gone, 'user-1', { streak_day: 2 }),
          storedRun(last, 'user-1', { streak_day: 3, xp_gained: 777 }),
        ],
      },
      routes: { athleteActivities: [first, last], activities: {} }, // 7345002 is not listed and answers 404
    };
  };

  it('reconcile recalculates after a night that was cut off after the deletion, at the next run of the recovery', async () => {
    // The process dies (or the database does) between the deletion and the recalculation: the deletion is done, the recalculation is not,
    // and both tries fail. What is left behind is the same either way: no run, a stale 14th, and the mark.
    const { t, reconciler, marks, recovery, reprocessCalls } = build({
      ...threeDays(),
      recompute: (real) => ({
        ...real,
        reprocessFrom: async () => {
          throw boom();
        },
      }),
    });

    const night = await reconciler.run();

    expect(night).toMatchObject({ removed: 1, failed: 1 });
    expect(ids(t.runs)).toEqual(['7345001', '7345003']);
    expect(t.runs.find((r) => r.external_id === '7345003')).toMatchObject({ streak_day: 3, xp_gained: 777 }); // stale: the recalculation never ran
    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-10-13', version: 1 }]);
    expect(calculateUserTotals).not.toHaveBeenCalled();

    // The next run of the recovery (at start, or at 04:05): the right recalculation, from the date of the run that went.
    const recovered = await recovery.run();

    expect(recovered).toEqual({ found: 1, recalculated: 1, failed: 0 });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-13' }]);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(t.runs.find((r) => r.external_id === '7345003')).toMatchObject({ streak_day: 1 }); // the 13th is gone: the streak starts over
    expect(t.runs.find((r) => r.external_id === '7345003')!.xp_gained).not.toBe(777);
    expect(marks.rows()).toEqual([]);

    // And nothing more is done afterwards.
    reprocessCalls.length = 0;
    expect(await recovery.run()).toEqual({ found: 0, recalculated: 0, failed: 0 });
    expect(reprocessCalls).toEqual([]);
  });

  it('reconcile marks the user before it deletes the run, with the date of the run', async () => {
    let markedWhenDeleting: unknown = 'the delete was never seen';
    const marks = createInMemoryMarkStore();
    const { reconciler } = build({
      ...threeDays(),
      marks,
      failWhen: (query) => {
        if (query.table === 'runs' && query.mutation === 'delete') markedWhenDeleting = marks.rows();
        return null;
      },
    });

    await reconciler.run();

    expect(markedWhenDeleting).toEqual([{ userId: 'user-1', fromDate: '2026-10-13', version: 1 }]);
  });

  it('reconcile clears the mark when the recalculation worked, also after a first try that failed', async () => {
    let attempts = 0;
    const { t, reconciler, marks } = build({
      ...threeDays(),
      recompute: (real) => ({
        ...real,
        reprocessFrom: async (userId, from) => {
          attempts += 1;
          if (attempts === 1) throw boom();
          await real.reprocessFrom(userId, from);
        },
      }),
    });

    const summary = await reconciler.run();

    expect(summary).toMatchObject({ removed: 1, failed: 0 });
    expect(attempts).toBe(2);
    expect(t.runs.find((r) => r.external_id === '7345003')).toMatchObject({ streak_day: 1 });
    expect(marks.calls).toEqual(['mark:user-1:2026-10-13', 'clear:user-1:1']);
    expect(marks.rows()).toEqual([]);
  });

  it('reconcile leaves the mark when the totals fail twice, and the recovery repeats the whole recalculation', async () => {
    let failing = true;
    const { reconciler, marks, recovery, reprocessCalls } = build({
      ...threeDays(),
      recompute: (real) => ({
        ...real,
        recalculateTotals: async (userId) => {
          if (failing) throw boom();
          await real.recalculateTotals(userId);
        },
      }),
    });

    expect(await reconciler.run()).toMatchObject({ removed: 1, failed: 1 });
    expect(marks.rows()).toHaveLength(1);

    failing = false;
    reprocessCalls.length = 0;
    // The recovery has its own recompute (the counting one, not the failing wrapper): it finishes the user.
    expect(await recovery.run()).toEqual({ found: 1, recalculated: 1, failed: 0 });
    expect(reprocessCalls).toEqual([{ userId: 'user-1', fromDate: '2026-10-13' }]);
    expect(marks.rows()).toEqual([]);
  });

  it('reconcile leaves the mark when the totals run RETURNS false twice, which calculateUserTotals does instead of throwing', async () => {
    const { t, reconciler, marks, recovery, reprocessCalls } = build({
      ...threeDays(),
      recompute: (real) => ({ ...real, recalculateTotals: async () => false }),
    });

    const night = await reconciler.run();

    expect(night).toMatchObject({ removed: 1, failed: 1 });
    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-10-13', version: 1 }]);
    expect(logLines.join('\n')).toContain('totals_not_written');
    expect(reprocessCalls).toHaveLength(2); // both tries were made

    // The recovery job (a working totals run) finishes the user and clears the mark.
    reprocessCalls.length = 0;
    expect(await recovery.run()).toEqual({ found: 1, recalculated: 1, failed: 0 });
    expect(marks.rows()).toEqual([]);
    expect(t.runs.find((r) => r.external_id === '7345003')).toMatchObject({ streak_day: 1 });
  });

  it('reconcile clears the mark when the second try of the totals run is the one that writes them', async () => {
    let tries = 0;
    const { reconciler, marks } = build({
      ...threeDays(),
      recompute: (real) => ({
        ...real,
        recalculateTotals: async (userId) => {
          tries += 1;
          if (tries === 1) return false;
          return real.recalculateTotals(userId);
        },
      }),
    });

    const night = await reconciler.run();

    expect(night).toMatchObject({ removed: 1, failed: 0 });
    expect(tries).toBe(2);
    expect(marks.rows()).toEqual([]);
  });

  it('reconcile only logs and goes on when the mark cannot be cleared', async () => {
    const marks = createInMemoryMarkStore();
    marks.failClear = Object.assign(new Error('clear failed for user abc@example.com'), { code: '57P01' });
    const { t, reconciler } = build({ ...threeDays(), marks });

    const night = await reconciler.run();

    expect(night).toMatchObject({ removed: 1, failed: 0 }); // the recalculation worked: nothing failed
    expect(ids(t.runs)).toEqual(['7345001', '7345003']);
    expect(marks.rows()).toHaveLength(1); // the recovery job repeats the recalculation once
    const log = logLines.join('\n');
    expect(log).toContain('57P01');
    expect(log).toContain('could not be cleared');
    expect(log).not.toContain('abc@example.com');
  });

  it('reconcile stops checking a user at the first mark that cannot be written, so the Strava budget is not spent every night', async () => {
    const marks = createInMemoryMarkStore();
    marks.failMark = Object.assign(new Error('function mark_recalculation does not exist'), { code: '42883' });
    const first = activityOf(7345001, D12);
    const second = activityOf(7345002, D13);
    const third = activityOf(7345003, D14);
    const { t, reconciler, strava } = build({
      tables: { runs: [storedRun(first), storedRun(second), storedRun(third)] },
      routes: { athleteActivities: [], activities: {} }, // none is listed and every detail call answers 404: all three are in doubt
      marks,
    });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001', '7345002', '7345003']);
    expect(marks.calls).toEqual(['mark:user-1:2026-10-12']); // one attempt, not three
    expect(strava.calls.activity).toBe(1); // the other two were never asked about
    expect(summary).toMatchObject({ removed: 0, failed: 1 });
    const failures = logLines.filter((line) => line.includes('42883'));
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(logLines.filter((line) => line.includes('mark of user') && line.includes('42883'))).toHaveLength(1); // said once
  });

  it('reconcile stops only the user whose mark failed: the next user is still checked', async () => {
    const marks = createInMemoryMarkStore();
    const original = marks.mark.bind(marks);
    marks.mark = async (userId, fromDate) => {
      if (userId === 'user-1') throw Object.assign(new Error('x'), { code: '08006' });
      return original(userId, fromDate);
    };
    const { t, reconciler } = build({
      tables: {
        strava_tokens: [tokenRow('user-1'), tokenRow('user-2')],
        runs: [
          storedRun(activityOf(7345001, D13), 'user-1'),
          storedRun(activityOf(7345002, D14), 'user-1'),
          storedRun(activityOf(7345003, D13), 'user-2'),
        ],
      },
      routes: { athleteActivities: [], activities: {} },
      marks,
    });

    const summary = await reconciler.run();

    expect(t.runs.filter((r) => r.user_id === 'user-1')).toHaveLength(2);
    expect(t.runs.filter((r) => r.user_id === 'user-2')).toHaveLength(0);
    expect(summary).toMatchObject({ removed: 1, failed: 1 });
  });

  it('reconcile does not clear a mark that a newer change wrote during its recalculation', async () => {
    const { reconciler, marks } = build({
      ...threeDays(),
      recompute: (real) => ({
        ...real,
        reprocessFrom: async (userId, from) => {
          await real.reprocessFrom(userId, from);
          await marks.mark(userId, '2026-10-02'); // another writer marks the user while this one is recalculating
        },
      }),
    });

    await reconciler.run();

    expect(marks.rows()).toEqual([{ userId: 'user-1', fromDate: '2026-10-02', version: 2 }]);
  });

  it('reconcile deletes nothing when the mark cannot be written, and says so by code', async () => {
    const marks = createInMemoryMarkStore();
    marks.failMark = Object.assign(new Error('function mark_recalculation does not exist for user abc@example.com'), { code: '42883' });
    const { t, reconciler } = build({ ...threeDays(), marks });

    const summary = await reconciler.run();

    expect(ids(t.runs)).toEqual(['7345001', '7345002', '7345003']);
    expect(summary).toMatchObject({ removed: 0, failed: 1 });
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('42883');
    expect(logLines.join('\n')).not.toContain('abc@example.com');
    expect(logLines.join('\n')).not.toContain('7345002');
  });

  it('reconcile marks the earlier of the old and the new date before it moves a run to an earlier day', async () => {
    const marks = createInMemoryMarkStore();
    let markedWhenUpdating: unknown = 'the update was never seen';
    const stored = activityOf(7345001, D14);
    const movedEarlier = activityOf(7345001, D12);
    const { t, reconciler } = build({
      tables: { runs: [storedRun(stored)] },
      routes: { athleteActivities: [movedEarlier], activities: { 7345001: movedEarlier } },
      marks,
      failWhen: (query) => {
        if (query.table === 'runs' && query.mutation === 'update') markedWhenUpdating = marks.rows();
        return null;
      },
    });

    const summary = await reconciler.run();

    expect(summary).toMatchObject({ updated: 1, failed: 0 });
    expect(t.runs[0]).toMatchObject({ date: '2026-10-12' });
    expect(markedWhenUpdating).toEqual([{ userId: 'user-1', fromDate: '2026-10-12', version: 1 }]);
    expect(marks.rows()).toEqual([]);
  });

  it('reconcile marks the old date, not the new one, before it moves a run to a later day', async () => {
    // The days from the old date on are the ones that change: the run leaves its old day.
    const marks = createInMemoryMarkStore();
    const movedLater = activityOf(7345001, D14);
    const { t, reconciler } = build({
      tables: { runs: [storedRun(activityOf(7345001, D12))] },
      routes: { athleteActivities: [movedLater], activities: { 7345001: movedLater } },
      marks,
    });

    await reconciler.run();

    expect(t.runs[0]).toMatchObject({ date: '2026-10-14' });
    expect(marks.calls).toEqual(['mark:user-1:2026-10-12', 'clear:user-1:1']);
  });

  it('reconcile marks the stored date before it changes only the distance of a run', async () => {
    const marks = createInMemoryMarkStore();
    const { reconciler } = build({
      tables: { runs: [storedRun(activityOf(7345001, D13))] },
      routes: { athleteActivities: [activityOf(7345001, { ...D13, distance: 9000 })], activities: { 7345001: activityOf(7345001, { ...D13, distance: 9000 }) } },
      marks,
    });

    await reconciler.run();

    expect(marks.calls).toEqual(['mark:user-1:2026-10-13', 'clear:user-1:1']);
  });

  it('reconcile writes no mark and reads none when nothing is in doubt: a night with nothing to do costs no mark call', async () => {
    const kept = activityOf(7345001, D12);
    const { reconciler, marks } = build({
      tables: { runs: [storedRun(kept)] },
      routes: { athleteActivities: [kept] },
    });

    const summary = await reconciler.run();

    expect(summary).toMatchObject({ removed: 0, updated: 0, failed: 0 });
    expect(marks.calls).toEqual([]);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('reconcile writes no mark for a check that finds nothing to change', async () => {
    // A run that is not listed but that Strava still has, unchanged: looked at, left alone.
    const run = activityOf(7345001, D12);
    const { reconciler, marks, strava } = build({
      tables: { runs: [storedRun(run)] },
      routes: { athleteActivities: [], activities: { 7345001: run } },
    });

    const summary = await reconciler.run();

    expect(strava.activityCalls(7345001)).toBe(1);
    expect(summary).toMatchObject({ checked: 1, removed: 0, updated: 0 });
    expect(marks.calls).toEqual([]);
  });

  it('reconcile finishes another user even when the mark of one user cannot be written', async () => {
    const marks = createInMemoryMarkStore();
    const original = marks.mark.bind(marks);
    marks.mark = async (userId, fromDate) => {
      if (userId === 'user-1') throw Object.assign(new Error('x'), { code: '08006' });
      return original(userId, fromDate);
    };
    const { t, reconciler } = build({
      tables: {
        strava_tokens: [tokenRow('user-1'), tokenRow('user-2')],
        runs: [storedRun(activityOf(7345001, D13), 'user-1'), storedRun(activityOf(7345002, D13), 'user-2')],
      },
      routes: { athleteActivities: [], activities: {} },
      marks,
    });

    const summary = await reconciler.run();

    expect(t.runs.map((r) => r.user_id)).toEqual(['user-1']);
    expect(summary).toMatchObject({ removed: 1, failed: 1 });
  });
});

describe('nightly reconcile when the token key cannot be used', () => {
  const twoUsers = () => ({
    tables: {
      strava_tokens: [tokenRow('user-1'), tokenRow('user-2')],
      runs: [storedRun(activityOf(7345001), 'user-1'), storedRun(activityOf(7345002), 'user-2')],
    },
    routes: { athleteActivities: [activityOf(7345001), activityOf(7345002)] },
  });

  it('reconcile without a key skips the night as a whole: one error line, none per user, nothing read, nothing asked of Strava, nothing deleted', async () => {
    const { t, db, reconciler, strava } = build(twoUsers());
    const runsBefore = JSON.stringify(t.runs);
    db.queries.length = 0;
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', ''); // after the rows are sealed

    const summary = await reconciler.run();

    expect(summary).toEqual({ users: 0, pausedUsers: 0, skippedUnavailable: 0, checked: 0, removed: 0, updated: 0, failed: 0, requests: 0, stopped: 'token_key' });
    expect(db.queries).toEqual([]);
    expect(strava.requests).toHaveLength(0);
    expect(JSON.stringify(t.runs)).toBe(runsBefore);
    const errors = vi.mocked(logger.error).mock.calls.map((call) => String(call[0]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Strava reconcile skipped.*key_missing/);
    expect(logLines.join('\n')).not.toMatch(/user-1|user-2/);
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('reconcile with a key the environment refuses skips the night the same way', async () => {
    const { db, reconciler, strava } = build(twoUsers());
    db.queries.length = 0;
    vi.stubEnv('NODE_ENV', 'production'); // the open test key (test-1) is not accepted in production

    const summary = await reconciler.run();

    expect(summary).toMatchObject({ users: 0, stopped: 'token_key' });
    expect(db.queries).toEqual([]);
    expect(strava.requests).toHaveLength(0);
    expect(logLines.join('\n')).toMatch(/Strava reconcile skipped.*key_invalid/);
  });

  it('reconcile with a working key is not stopped', async () => {
    const { reconciler } = build(twoUsers());

    expect((await reconciler.run()).stopped).toBeNull();
  });
});
