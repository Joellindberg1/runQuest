/**
 * The webhook handler for `athlete` events (ADR 010 decisions 3.6, 7.4.3 and 8), as behaviour through the real worker: in-memory
 * event store, the real Supabase adapters against createFakeDb (with the foreign keys of runs(id)), the real Strava client against
 * installFakeStravaFetch (a URL the test did not configure fails it), the real removeStravaConnection and deletion chain.
 * Mocked at the edge: reprocessRunsFromDate and calculateUserTotals, which are asserted as calls (one reprocess and one totals run
 * in a removal that goes through at the first try is the "no double recompute" rule). The classification of each answer, with
 * stubbed ports, is in stravaAthleteDeauthorize.decision.test.ts; the status route is in routes/__tests__/strava-deauthorize-status.test.ts.
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
vi.mock('../../routes/runs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../routes/runs.js')>()),
  reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined),
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
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { createStravaWebhookWorker } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import {
  installFakeStravaFetch,
  stravaAthlete,
  stravaDeauthorizeEvent,
  stravaError,
  stravaTokenResponse,
  type FakeStrava,
  type FakeStravaRoutes,
} from '../../test-utils/fakeStrava.js';

const START = new Date('2026-10-14T12:07:00.000Z');
const MINUTE = 60_000;
let clock = START;
const now = () => clock;

let strava: FakeStrava | undefined;
let lines: string[];

beforeEach(() => {
  clock = START;
  vi.clearAllMocks();
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks(); // before strava.restore(): a spy on fetch sits on top of the fake
  strava?.restore(); // throws when the code reached a Strava URL the test did not configure
  strava = undefined;
});

const ATHLETE_ID = 424242;
const tokenRow = (over: Row = {}): Row => ({
  user_id: 'user-1',
  strava_athlete_id: ATHLETE_ID,
  access_token: 'SECRET-ACCESS',
  refresh_token: 'SECRET-REFRESH',
  expires_at: 9_999_999_999,
  connection_date: '2026-09-01T09:00:00+00:00',
  consent_version: '2026-10-14',
  consented_at: '2026-10-14T09:30:00.000Z',
  sync_paused: false,
  paused_at: null,
  ...over,
});
const stravaRun = (over: Row = {}): Row => ({
  id: 'r1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 55, streak_day: 1, ...over,
});
const manualRun = (over: Row = {}): Row => ({
  id: 'manual', user_id: 'user-1', source: 'manual', external_id: null, date: '2026-09-20', distance: 3, xp_gained: 30, streak_day: 1, ...over,
});

interface Setup {
  runs?: Row[];
  tokens?: Row[];
  failWhen?: FakeDbOptions['failWhen'];
  strava?: FakeStravaRoutes;
}

function build(setup: Setup = {}) {
  const tables: Record<string, Row[]> = {
    runs: setup.runs ?? [stravaRun(), stravaRun({ id: 'r2', external_id: '1002', date: '2026-10-02' }), manualRun()],
    strava_tokens: setup.tokens ?? [tokenRow()],
    user_boosts: [],
  };
  const db = createFakeDb(tables, { autoIds: true, failWhen: setup.failWhen, primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, tables) as any);
  strava = installFakeStravaFetch({ oauthDeauthorize: { access_token: 'SECRET-ACCESS' }, ...setup.strava });
  const store = createInMemoryWebhookStore({ now });
  const worker = createStravaWebhookWorker({
    store,
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: createRecompute(),
    handlers: STRAVA_WEBHOOK_HANDLERS,
    now,
  });
  const event = stravaDeauthorizeEvent({ owner_id: ATHLETE_ID });
  const seedDeauthorize = (over: Parameters<typeof store.seed>[0] = {}) =>
    store.seed({ object_type: 'athlete', aspect_type: 'update', object_id: event.object_id, owner_id: event.owner_id, updates: event.updates, ...over });
  const writes = () => db.queries.filter((q) => q.mutation !== undefined).length;
  return { tables, db, store, worker, seedDeauthorize, writes };
}

const NEVER_LOGGED = ['SECRET-ACCESS', 'SECRET-REFRESH', String(ATHLETE_ID), '1001', '1002'];

describe('athlete deauthorize', () => {
  it('deauthorize event confirmed by a 401 removes the strava runs and the token row', async () => {
    const { tables, store, worker, seedDeauthorize } = build({ strava: { athlete: stravaError(401) } });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted', attempts: 0 });
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']); // a manual run is never touched
    expect(tables.strava_tokens).toEqual([]);
    expect(strava!.calls.athlete).toBe(1); // exactly one verification per event
    expect(strava!.requests[0]).toMatchObject({ route: 'athlete', method: 'GET', headers: { authorization: 'Bearer SECRET-ACCESS' } });
  });

  it('removal at the first try recomputes once: the removal does it and the worker does not do it a second time', async () => {
    const { store, worker, seedDeauthorize } = build({ strava: { athlete: stravaError(401) } });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted' });
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-10-01'); // from the oldest deleted Strava run
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('deauthorize event confirmed by a rejected refresh token removes the connection', async () => {
    // The access token has expired and Strava's token endpoint rejects the refresh token: that is Strava saying the authorisation is
    // gone, so it confirms like a 401 from GET /athlete would. No GET /athlete is needed (there is no token to ask with) and no revoke.
    const rejection = { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] };
    const { tables, store, worker, seedDeauthorize } = build({ tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: stravaError(400, { body: rejection }) } });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted', attempts: 0 });
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']); // a manual run is never touched
    expect(tables.strava_tokens).toEqual([]);
    expect(strava!.calls.oauthToken).toBe(1);
    expect(strava!.calls.oauthDeauthorize).toBe(0);
    expect(strava!.calls.athlete).toBe(0);
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
  });

  it('deauthorize event with a token refresh that failed for another reason, or a token row that could not be read, is retried and deletes nothing', async () => {
    // A wrong client secret on our side. The body also names the refresh token, and the application entry has an empty field: only
    // the resource tells it apart, and a forged event must never be able to turn this into deleted runs.
    const clientCredentials = {
      message: 'Authorization Error',
      errors: [{ resource: 'Application', field: '' }, { resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }],
    };
    // Strava uses "Authorization Error" for every 401; with nothing naming the refresh token it proves nothing.
    const messageOnly = { message: 'Authorization Error' };
    const cases: Array<{ label: string; setup: Setup; lastError: string }> = [
      { label: '5xx', setup: { tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: stravaError(503) } }, lastError: 'token_refresh_failed' },
      {
        label: 'network error',
        setup: { tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: () => { throw new TypeError('fetch failed: ECONNRESET'); } } },
        lastError: 'token_refresh_failed',
      },
      { label: '429', setup: { tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: stravaError(429) } }, lastError: 'token_refresh_failed' },
      {
        // A wrong client secret on our side is a 400 too, and a forged event must not be able to turn it into deleted runs.
        label: '401 about the client credentials',
        setup: { tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: stravaError(401, { body: clientCredentials }) } },
        lastError: 'token_refresh_failed',
      },
      {
        label: '401 Authorization Error with nothing naming the refresh token',
        setup: { tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: stravaError(401, { body: messageOnly }) } },
        lastError: 'token_refresh_failed',
      },
      {
        label: 'token row that cannot be read',
        setup: { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.startsWith('access_token') ? ({ message: 'connection reset', code: '57P01' } as never) : null), strava: { athlete: stravaError(401) } },
        lastError: 'token_read_failed',
      },
    ];

    for (const { label, setup, lastError } of cases) {
      const c = build(setup);
      c.seedDeauthorize();

      await c.worker.drain();

      expect(c.store.row(1), label).toMatchObject({ status: 'pending', attempts: 1, last_error: lastError });
      expect(c.tables.runs, label).toHaveLength(3);
      expect(c.tables.strava_tokens, label).toHaveLength(1);
      expect(c.writes(), label).toBe(0);
      expect(strava!.calls.athlete, label).toBe(0);
      expect(strava!.calls.oauthDeauthorize, label).toBe(0);
      expect(reprocessRunsFromDate, label).not.toHaveBeenCalled();
      strava!.restore();
      vi.clearAllMocks();
    }
  });

  // A refresh that failed in a way that does not prove Strava withdrew the authorisation. Only `refresh_rejected` confirms.
  it('deauthorize event with a failed token refresh is retried and deletes nothing', async () => {
    const rejected = build({ tokens: [tokenRow({ expires_at: 1 })], strava: { oauthToken: stravaError(400, { body: { message: 'Bad Request', errors: [{ code: 'invalid' }] } }) } });
    rejected.seedDeauthorize();

    await rejected.worker.drain();

    expect(rejected.store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'token_refresh_failed' });
    expect(rejected.tables.runs).toHaveLength(3);
    expect(rejected.tables.strava_tokens).toHaveLength(1);
    expect(strava!.calls.oauthToken).toBe(1);
    expect(strava!.calls.athlete).toBe(0);
    expect(rejected.writes()).toBe(0);
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
  });

  it('deauthorize event for a connection with no refresh token is retried and deletes nothing', async () => {
    // Nothing to renew with means nothing to verify against Strava, and an unverified event must never delete.
    const { tables, store, worker, seedDeauthorize, writes } = build({ tokens: [tokenRow({ expires_at: 1, refresh_token: null })] });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'no_refresh_token' });
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(writes()).toBe(0);
    expect(strava!.requests).toEqual([]);
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
  });

  it('deauthorize event that Strava does not confirm deletes nothing', async () => {
    const { tables, store, worker, seedDeauthorize, writes } = build({ strava: { athlete: stravaAthlete() } });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'ignored_not_confirmed', attempts: 0 });
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(writes()).toBe(0);
    expect(strava!.calls.athlete).toBe(1);
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
  });

  it('forged deauthorize event against a connected athlete deletes nothing', async () => {
    // A POST nobody signed, delivered several times and in two shapes, for an athlete Strava still serves.
    const { tables, store, worker, seedDeauthorize, writes } = build({ strava: { athlete: stravaAthlete() } });
    seedDeauthorize();
    seedDeauthorize({ event_time: new Date(START.getTime() - 30_000).toISOString() });
    seedDeauthorize({ event_time: new Date(START.getTime() - 20_000).toISOString(), updates: { authorized: false } });

    await worker.drain();

    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([
      ['done', 'ignored_not_confirmed'],
      ['done', 'ignored_not_confirmed'],
      ['done', 'ignored_not_confirmed'],
    ]);
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(writes()).toBe(0);
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
  });

  it('forged deauthorize event during a network fault on the token refresh deletes nothing and is retried', async () => {
    const { tables, store, worker, seedDeauthorize, writes } = build({
      tokens: [tokenRow({ expires_at: 1 })],
      strava: {
        oauthToken: () => {
          throw new TypeError('fetch failed: ECONNRESET');
        },
      },
    });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'token_refresh_failed' });
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(writes()).toBe(0);
    expect(strava!.calls.athlete).toBe(0);
  });

  it('deauthorize event does not call the Strava revoke endpoint again', async () => {
    const { store, worker, seedDeauthorize } = build({ strava: { athlete: stravaError(401), oauthDeauthorize: { access_token: 'SECRET-ACCESS' } } });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted' });
    expect(strava!.calls.oauthDeauthorize).toBe(0);
    expect(strava!.requests.map((call) => call.route)).toEqual(['athlete']);
  });

  it('deauthorize event with a 5xx from Strava is retried', async () => {
    const answers = [stravaError(503), stravaError(500)];
    let call = 0;
    const { tables, store, worker, seedDeauthorize, writes } = build({
      strava: { athlete: () => answers[call++] ?? stravaError(401) },
    });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'server_error' });
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(writes()).toBe(0);

    clock = new Date(START.getTime() + 2 * MINUTE); // the second try also meets a 5xx
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 2, last_error: 'server_error' });
    expect(tables.runs).toHaveLength(3);

    clock = new Date(START.getTime() + 10 * MINUTE); // the third finds Strava answering 401: now it is confirmed
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted', attempts: 2 });
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']);
    expect(tables.strava_tokens).toEqual([]);
    expect(strava!.calls.athlete).toBe(3);
  });

  it('deauthorize event with a network error from Strava is retried', async () => {
    const { tables, store, worker, seedDeauthorize } = build({
      strava: {
        athlete: () => {
          throw new TypeError('fetch failed: ECONNRESET');
        },
      },
    });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'network_error' });
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
  });

  it('deauthorize event delivered twice is a no-op the second time', async () => {
    const { tables, store, worker, seedDeauthorize, writes } = build({ strava: { athlete: stravaError(401) } });
    seedDeauthorize();
    await worker.drain();
    expect(tables.strava_tokens).toEqual([]);
    const writesAfterFirst = writes();
    const athleteCalls = strava!.calls.athlete;
    vi.mocked(reprocessRunsFromDate).mockClear();
    vi.mocked(calculateUserTotals).mockClear();

    // The second delivery: queued for the user before the row went (user_id still set), and one received after it (no user).
    seedDeauthorize({ event_time: new Date(START.getTime() + 1000).toISOString() });
    seedDeauthorize({ event_time: new Date(START.getTime() + 2000).toISOString(), user_id: null });
    clock = new Date(START.getTime() + 5 * MINUTE);
    await worker.drain();

    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual([
      ['done', 'deauthorized_runs_deleted'],
      ['done', 'ignored_unknown_owner'],
      ['done', 'ignored_unknown_owner'],
    ]);
    expect(writes()).toBe(writesAfterFirst); // nothing written
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
    expect(calculateUserTotals).not.toHaveBeenCalled();
    expect(strava!.calls.athlete).toBe(athleteCalls); // and Strava is not asked
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']);
  });

  it('deauthorize event for a paused user is processed as usual', async () => {
    const { tables, store, worker, seedDeauthorize } = build({
      tokens: [tokenRow({ sync_paused: true, paused_at: '2026-10-10T09:00:00.000Z' })],
      strava: { athlete: stravaError(401) },
    });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted' });
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('athlete event without authorized false finishes as noop', async () => {
    const { tables, store, worker, seedDeauthorize, writes } = build();
    const shapes: Array<Record<string, unknown>> = [
      { authorized: 'true' },
      {},
      { private: 'true' },
      { authorized: '' },
      { authorized: 'maybe' },
      { authorized: 'False' },
      { authorized: 0 },
      { authorized: true },
      { authorized: ['false'] },
    ];
    shapes.forEach((updates, index) => seedDeauthorize({ updates, event_time: new Date(START.getTime() - 60_000 + index).toISOString() }));

    await worker.drain();

    expect(store.rows().map((row) => [row.status, row.outcome])).toEqual(shapes.map(() => ['done', 'noop']));
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1);
    expect(writes()).toBe(0);
    expect(strava!.requests).toEqual([]); // not even a verification: there is nothing to verify
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();
  });
});

describe('athlete deauthorize: a removal that does not finish', () => {
  it('a removal that fails on the delete is retried with its code, keeps the token row and finishes at the next try', async () => {
    let failing = true;
    const { tables, store, worker, seedDeauthorize } = build({
      strava: { athlete: stravaError(401) },
      failWhen: (q) => (failing && q.table === 'runs' && q.mutation === 'delete' ? ({ message: 'failed for 1001 "Morning Run"', code: '57P01' } as never) : null),
    });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'removal_failed:57P01' });
    expect(tables.runs).toHaveLength(3);
    expect(tables.strava_tokens).toHaveLength(1); // the row stays, so the retry finds the user
    expect(reprocessRunsFromDate).not.toHaveBeenCalled();

    failing = false;
    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted', attempts: 1 });
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']);
    expect(tables.strava_tokens).toEqual([]);
  });

  it('a retry that finishes the removal is recalculated a second time by the worker, which is harmless', async () => {
    // The worker recalculates every retry (attempts >= 1) from the user's earliest run, whatever the handler reports: an earlier
    // try may have deleted runs and died before it. After a first try whose reprocess failed, that second recalculation is
    // in addition to the one the removal does itself. Both are idempotent.
    vi.mocked(reprocessRunsFromDate).mockRejectedValueOnce(Object.assign(new Error('reprocess failed for 1001'), { code: '57P02' }));
    const { tables, store, worker, seedDeauthorize } = build({ strava: { athlete: stravaError(401) } });
    seedDeauthorize();

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'removal_failed:57P02' });
    expect(tables.runs.map((run) => run.id)).toEqual(['manual']); // the delete went through
    expect(tables.strava_tokens).toHaveLength(1); // but the row is kept, so a rerun finishes
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledTimes(1); // the removal still tries the totals

    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deauthorized_runs_deleted', attempts: 1 });
    expect(tables.strava_tokens).toEqual([]);
    // The removal's rerun (earliest run of any source) plus the worker's forced recalculation of the retry: 1 + 1 + 1.
    expect(reprocessRunsFromDate).toHaveBeenCalledTimes(3);
    expect(vi.mocked(reprocessRunsFromDate).mock.calls.map((call) => call[1])).toEqual(['2026-10-01', '2026-09-20', '2026-09-20']);
    expect(calculateUserTotals).toHaveBeenCalledTimes(3);
  });
});

describe('athlete deauthorize: the logs', () => {
  it('a deauthorize that is confirmed, refused, retried and repeated logs no token, athlete id or Strava id', async () => {
    const answers = [stravaAthlete(), stravaError(503), stravaError(401)];
    let call = 0;
    const { store, worker, seedDeauthorize } = build({ strava: { athlete: () => answers[call++] ?? stravaError(401) } });

    seedDeauthorize(); // 200: not confirmed
    await worker.drain();
    seedDeauthorize({ event_time: new Date(START.getTime() + 1000).toISOString() }); // 503: retried
    clock = new Date(START.getTime() + MINUTE);
    await worker.drain();
    clock = new Date(START.getTime() + 10 * MINUTE); // 401: removed
    await worker.drain();
    seedDeauthorize({ event_time: new Date(START.getTime() + 20 * MINUTE).toISOString() }); // delivered again
    clock = new Date(START.getTime() + 30 * MINUTE);
    await worker.drain();

    expect(store.rows().map((row) => row.outcome)).toEqual(['ignored_not_confirmed', 'deauthorized_runs_deleted', 'ignored_unknown_owner']);
    const text = lines.join('\n');
    expect(text).toContain('user-1'); // our own user id is logged
    for (const secret of NEVER_LOGGED) expect(text).not.toContain(secret);
  });

  it('every path of a deauthorize logs no token, athlete id, Strava id or response body', async () => {
    // The athlete id is also the event's object_id. Strava's answers carry values (a token, the id) in their bodies and messages.
    const LEAK = 'SECRET-NEW NEWREFRESH 424242 1001';
    const rejected = { message: LEAK, errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: LEAK }] };
    const expired = [tokenRow({ expires_at: 1 })];
    const networkError = () => { throw new TypeError(`fetch failed: ECONNRESET ${LEAK}`); };
    const paths: Array<{ label: string; setup: Setup; seed?: Parameters<ReturnType<typeof build>['seedDeauthorize']>[0]; outcome: string }> = [
      { label: 'network error on GET /athlete', setup: { strava: { athlete: networkError } }, outcome: 'network_error' },
      { label: '429 on GET /athlete', setup: { strava: { athlete: stravaError(429, { body: { message: LEAK } }) } }, outcome: 'rate_limit_wait' },
      { label: 'refresh_failed (5xx)', setup: { tokens: expired, strava: { oauthToken: stravaError(500, { body: { message: LEAK } }) } }, outcome: 'token_refresh_failed' },
      { label: 'refresh_failed (network)', setup: { tokens: expired, strava: { oauthToken: networkError } }, outcome: 'token_refresh_failed' },
      { label: 'refresh_rejected', setup: { tokens: expired, strava: { oauthToken: stravaError(401, { body: rejected }) } }, outcome: 'deauthorized_runs_deleted' },
      { label: 'no_refresh_token', setup: { tokens: [tokenRow({ expires_at: 1, refresh_token: null })] }, outcome: 'no_refresh_token' },
      {
        label: 'token_read_failed',
        setup: { failWhen: (q) => (q.table === 'strava_tokens' && q.select?.startsWith('access_token') ? ({ message: LEAK, code: '57P01', details: LEAK } as never) : null) },
        outcome: 'token_read_failed',
      },
      {
        // The row is there for the connection read and gone for the token read: the second read finds it gone.
        label: 'not_connected, re-read',
        setup: {
          failWhen: (q) => {
            if (q.table === 'strava_tokens' && q.select?.startsWith('access_token')) tablesOf.current.strava_tokens.length = 0;
            return null;
          },
        },
        outcome: 'ignored_unknown_owner',
      },
      { label: 'noop', setup: {}, seed: { updates: { authorized: 'true' } }, outcome: 'noop' },
    ];
    const tablesOf: { current: Record<string, Row[]> } = { current: {} };

    const seen: string[] = [];
    for (const { label, setup, seed, outcome } of paths) {
      const c = build(setup);
      tablesOf.current = c.tables;
      c.seedDeauthorize(seed);

      await c.worker.drain();

      const row = c.store.row(1)!;
      seen.push(`${label}: ${row.outcome ?? row.last_error}`);
      expect(row.outcome ?? row.last_error, label).toBe(outcome);
      strava!.restore();
      vi.clearAllMocks();
    }

    expect(seen).toHaveLength(paths.length);
    const text = lines.join('\n');
    expect(text).toContain('user-1');
    for (const secret of [...NEVER_LOGGED, 'SECRET-NEW', 'NEWREFRESH', 'ECONNRESET']) expect(text, secret).not.toContain(secret);
  });
});
