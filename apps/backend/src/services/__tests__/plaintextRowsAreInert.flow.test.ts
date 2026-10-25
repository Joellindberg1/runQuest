/**
 * A token row that holds plaintext (a value without the `enc:v1:` prefix) is inert (ADR 013 decisions 8 and 9, since the plaintext branch of
 * the read path was removed). Whatever form the sync, the webhook worker or the nightly reconcile meets it in, the answer is
 * `token_unreadable`: the value is not sent to Strava as if it were a token, nothing is asked of Strava at all, no row is deleted, no row is
 * rewritten, and nothing is read as "Strava withdrew the authorisation".
 *
 * The three callers run for real, side by side in one file so that one reader branch cannot be brought back for one of them without this
 * going red: the scheduled sync (syncAllStravaUsers), the real webhook worker with the real handlers, and the real reconciler, each on the
 * real Supabase adapters against createFakeDb and the real Strava client against installFakeStravaFetch. The fake Strava answers as if the
 * token were accepted (a 401 on the athlete, a 404 on every activity, an empty activity list), because those are the answers that would
 * delete something if a plaintext token were ever sent. The plaintext values are made up (legacyToken), not a real token format.
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
import { syncAllStravaUsers } from '../../routes/strava.js';
import { legacyToken, tokenCols } from '../../test-utils/stravaTokens.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryMarkStore } from '../../test-utils/inMemoryRecalculationMarks.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import {
  installFakeStravaFetch,
  stravaDeauthorizeEvent,
  stravaError,
  stravaTokenResponse,
  type FakeStrava,
} from '../../test-utils/fakeStrava.js';
import { createReconcilePorts } from '../stravaReconcile/adapters.js';
import { createStravaReconciler } from '../stravaReconcile.js';
import { resetUnreadableLogThrottle } from '../stravaClient.js';
import { resetUnreadableCount, unreadableSinceStart } from '../stravaTokenStore.js';
import { createStravaWebhookWorker } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';

const NIGHT = new Date('2026-10-17T02:15:00.000Z'); // the reconcile's 04:15 Stockholm
const ATHLETE_ID = 424242;

let strava: FakeStrava | undefined;
let lines: string[];

beforeEach(() => {
  vi.clearAllMocks();
  resetUnreadableCount();
  resetUnreadableLogThrottle();
  lines = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
    });
  }
  // The scheduled sync waits a second between users; the wait is not what this is about.
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, ms && ms >= 1000 ? 0 : ms)) as typeof setTimeout);
});
afterEach(() => {
  vi.restoreAllMocks(); // before strava.restore(): a spy on fetch sits on top of the fake
  strava?.restore(); // throws when the code reached a Strava URL the test did not configure
  strava = undefined;
});

// The rows a plaintext value can sit in. Each is either read as the stored access token (not expired) or as the refresh token (expired).
// A value of the right shape is the one a brought-back plaintext branch would accept, so the forms below all have it.
const PLAIN_ACCESS = legacyToken('plain-at');
const PLAIN_REFRESH = legacyToken('plain-rt');
const sealed = tokenCols('user-1', 'sealed-at', 'sealed-rt');
const PLAINTEXT_ROWS: Array<{ label: string; columns: Row }> = [
  { label: 'a plaintext access token on a token that has not expired', columns: { access_token: PLAIN_ACCESS, refresh_token: sealed.refresh_token, expires_at: 9_999_999_999 } },
  { label: 'a plaintext refresh token on an expired token', columns: { access_token: sealed.access_token, refresh_token: PLAIN_REFRESH, expires_at: 1 } },
  { label: 'both columns plaintext on a token that has not expired', columns: { access_token: PLAIN_ACCESS, refresh_token: PLAIN_REFRESH, expires_at: 9_999_999_999 } },
  { label: 'both columns plaintext on an expired token', columns: { access_token: PLAIN_ACCESS, refresh_token: PLAIN_REFRESH, expires_at: 1 } },
];

const tokenRow = (columns: Row): Row => ({
  user_id: 'user-1',
  strava_athlete_id: ATHLETE_ID,
  connection_date: '2026-09-01T09:00:00+00:00',
  consent_version: '2026-10-14',
  sync_paused: false,
  users: { name: 'Test' }, // the embedded user that the sync's query asks for
  ...columns,
});
const stravaRun = (over: Row = {}): Row => ({
  id: 'r1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-01', distance: 5, xp_gained: 55, streak_day: 1, ...over,
});

/** The world: one connected user with two Strava runs and a manual one, the database as createFakeDb, Strava as a fake that would delete if asked. */
function build(columns: Row) {
  const tables: Record<string, Row[]> = {
    strava_tokens: [tokenRow(columns)],
    runs: [stravaRun(), stravaRun({ id: 'r2', external_id: '1002', date: '2026-10-02' }), stravaRun({ id: 'manual', source: 'manual', external_id: null, date: '2026-09-20' })],
    user_boosts: [],
    run_weather: [],
    event_entries: [],
    user_badges: [],
    users: [{ id: 'user-1', event_xp: 0 }],
  };
  const db = createFakeDb(tables, {
    autoIds: true,
    primaryKeys: { strava_tokens: ['user_id'] },
    uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
  });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, tables) as never);
  // Every answer here is one that makes the code act if it got a token through: the athlete is gone (401), every activity is gone (404),
  // the list is empty, and the token endpoint hands out new tokens. None of them may be asked.
  strava = installFakeStravaFetch({
    athlete: stravaError(401),
    activities: {},
    athleteActivities: [],
    oauthToken: stravaTokenResponse(),
    oauthDeauthorize: { access_token: 'unused' },
  });
  const before = structuredClone(tables);
  const writes = () => db.queries.filter((q) => q.mutation !== undefined);
  return { tables, before, writes };
}

/** What "inert" means, the same for the three callers: nothing asked, nothing deleted or rewritten, nothing recalculated, one unreadable token counted. */
function expectInert(c: ReturnType<typeof build>, label: string) {
  expect(strava!.requests, `${label}: Strava was asked`).toHaveLength(0);
  expect(strava!.unmockedRequests, `${label}: a request went out`).toHaveLength(0);
  expect(c.tables.strava_tokens, `${label}: the token row changed`).toEqual(c.before.strava_tokens);
  expect(c.tables.runs, `${label}: a run changed`).toEqual(c.before.runs);
  expect(c.writes(), `${label}: something was written`).toEqual([]);
  expect(reprocessRunsFromDate, label).not.toHaveBeenCalled();
  expect(calculateUserTotals, label).not.toHaveBeenCalled();
  expect(unreadableSinceStart(), `${label}: the unreadable token was not counted once`).toBe(1);
  const logged = lines.join('\n');
  expect(logged, label).not.toContain(PLAIN_ACCESS);
  expect(logged, label).not.toContain(PLAIN_REFRESH);
}

describe('rows with plaintext tokens are inert', () => {
  it('the scheduled sync reports the user as unavailable and asks Strava nothing for a row with a plaintext token', async () => {
    for (const { label, columns } of PLAINTEXT_ROWS) {
      const c = build(columns);

      const summary = await syncAllStravaUsers();

      // The sync's own word for token_unreadable: a temporary fault of ours, not "connect again", not a sync error from Strava.
      expect(summary, label).toMatchObject({ success: true, syncedUsers: 0, totalUsers: 1, totalNewRuns: 0 });
      expect(summary.results, label).toEqual([{ userId: 'user-1', userName: 'Test', error: 'Strava is temporarily unavailable' }]);
      expectInert(c, label);
      strava!.restore();
      resetUnreadableCount();
      resetUnreadableLogThrottle();
      vi.clearAllMocks();
    }
  });

  it('the webhook worker retries every kind of event for a row with a plaintext token as token_unreadable and deletes nothing', async () => {
    const events: Array<{ label: string; seed: Record<string, unknown> }> = [
      { label: 'activity create', seed: { object_type: 'activity', aspect_type: 'create', object_id: 1003 } },
      { label: 'activity update', seed: { object_type: 'activity', aspect_type: 'update', object_id: 1001, updates: { title: 'New title' } } },
      { label: 'activity delete', seed: { object_type: 'activity', aspect_type: 'delete', object_id: 1001 } },
      { label: 'athlete deauthorize', seed: { object_type: 'athlete', aspect_type: 'update', object_id: ATHLETE_ID, owner_id: ATHLETE_ID, updates: stravaDeauthorizeEvent({ owner_id: ATHLETE_ID }).updates } },
    ];
    for (const { label: rowLabel, columns } of PLAINTEXT_ROWS) {
      for (const { label: eventLabel, seed } of events) {
        const label = `${eventLabel}, ${rowLabel}`;
        const c = build(columns);
        const store = createInMemoryWebhookStore({ now: () => NIGHT });
        const worker = createStravaWebhookWorker({
          store,
          strava: createStravaApi(),
          runs: createRunStore(),
          recompute: createRecompute(),
          handlers: STRAVA_WEBHOOK_HANDLERS,
          now: () => NIGHT,
        });
        store.seed({ owner_id: ATHLETE_ID, ...seed });

        await worker.drain();

        expect(store.row(1), label).toMatchObject({ status: 'pending', outcome: null, attempts: 1, last_error: 'token_unreadable' });
        expectInert(c, label);
        strava!.restore();
        resetUnreadableCount();
        resetUnreadableLogThrottle();
        vi.clearAllMocks();
      }
    }
  });

  it('the nightly reconcile leaves a user with a plaintext token alone and deletes none of the runs', async () => {
    for (const { label, columns } of PLAINTEXT_ROWS) {
      const c = build(columns);
      const marks = createInMemoryMarkStore();
      
      const reconciler = createStravaReconciler({
        ports: createReconcilePorts(),
        strava: createStravaApi(),
        runs: createRunStore(),
        recompute: createRecompute(),
        marks,
        now: () => NIGHT,
      });

      const summary = await reconciler.run();

      // No token: the user is left alone tonight, which is not a check that found the runs missing at Strava.
      expect(summary, label).toMatchObject({ users: 1, skippedUnavailable: 1, checked: 0, removed: 0, updated: 0, failed: 0, requests: 0, stopped: null });
      expect(lines.join('\n'), label).toContain('no token for user user-1 (token_unreadable)');
      expect(marks.rows(), `${label}: a recalculation was marked`).toEqual([]);
      expectInert(c, label);
      strava!.restore();
      resetUnreadableCount();
      resetUnreadableLogThrottle();
      vi.clearAllMocks();
    }
  });
});
