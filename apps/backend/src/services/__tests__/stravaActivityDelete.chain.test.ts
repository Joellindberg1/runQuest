/**
 * The deletion chain of a webhook delete event with the REAL calculateUserTotals, evaluateBadges, levelService, StreakService and
 * reprocessRunsFromDate (ADR 010 decision 8, ADR 009 decision 9.4), against createFakeDb wrapped in the foreign key actions of the
 * migrations. Mocked at the edge only: the challenge tokens and the title service (their own tests cover them), the event service,
 * the weather service, the XP configuration (defaults) and the clock (Date only). The calls of calculateUserTotals and evaluateBadges
 * are spied on, not replaced. The handler cases (404, forged, paused, retry) are in stravaActivityDelete.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ADMIN_SETTINGS,
  DEFAULT_STREAK_MULTIPLIERS,
  activityKeys,
  calculateCompleteRunXP,
  levelFromXP,
} from '@runquest/shared';

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
// The real functions, spied: the delete chain must reach them, and they run for real.
vi.mock('../../utils/calculateUserTotals.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/calculateUserTotals.js')>();
  return { ...actual, calculateUserTotals: vi.fn(actual.calculateUserTotals) };
});
vi.mock('../badgeService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../badgeService.js')>();
  return { ...actual, evaluateBadges: vi.fn(actual.evaluateBadges) };
});
vi.mock('../challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../enhancedTitleService.js', () => ({
  EnhancedTitleService: class {
    processAllUsersTitles = vi.fn(async () => undefined);
    processUserTitlesAfterRun = vi.fn(async () => undefined);
  },
}));
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
import { evaluateBadges } from '../badgeService.js';
import { createStravaWebhookWorker } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { installFakeStravaFetch, stravaError, type FakeStrava } from '../../test-utils/fakeStrava.js';

// 12:07 UTC on the 14th is the 14th in Stockholm too: "today" for the streak is 2026-10-14.
const START = new Date('2026-10-14T12:07:00.000Z');
const MINUTE = 60_000;
let clock = START;
const now = () => clock;
let strava: FakeStrava | undefined;

beforeEach(() => {
  clock = START;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  strava?.restore();
  strava = undefined;
});

const TOKEN_ROW = {
  user_id: 'user-1', access_token: 'old-at', refresh_token: 'old-rt', expires_at: 9999999999,
  connection_date: '2026-09-01T09:00:00+00:00', sync_paused: false,
};

const stravaRun = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '1001', date: '2026-10-12', distance: 5, xp_gained: 1, streak_day: 1,
  start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, ...over,
});

const userRow = (over: Row = {}): Row => ({
  id: 'user-1', group_id: 'g1', event_xp: 0, current_level: 1, total_km: 0, total_xp: 0, current_streak: 0, longest_streak: 0,
  displayed_badge_series: [], ...over,
});

function build(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const t: Record<string, Row[]> = {
    strava_tokens: [{ ...TOKEN_ROW }],
    runs: [],
    user_boosts: [],
    run_weather: [],
    event_entries: [],
    user_badges: [],
    activity_log: [],
    users: [userRow()],
    ...tables,
  };
  const db = createFakeDb(t, { autoIds: true, numericIds: ['activity_log'], primaryKeys: { strava_tokens: ['user_id'] }, ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, t) as any);
  const store = createInMemoryWebhookStore({ now });
  const worker = createStravaWebhookWorker({
    store,
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: createRecompute(),
    handlers: STRAVA_WEBHOOK_HANDLERS,
    now,
  });
  return { t, db, store, worker };
}

const xpFor = (km: number, streakDay: number): number => calculateCompleteRunXP(km, streakDay, DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS, 0).finalXP;

describe('the chain with the real totals', () => {
  it('delete event removes the run and recomputes totals, streak and level', async () => {
    strava = installFakeStravaFetch({ activities: { 1002: stravaError(404) } });
    // Three days in a row ending today: 15 km in 3 runs. The middle one is deleted, so the streak is cut to 1 and the XP drops.
    const before = 25;
    const xpBefore = xpFor(before, 1) + xpFor(before, 2) + xpFor(before, 3);
    const { t, store, worker } = build({
      runs: [
        stravaRun({ id: 'r1', external_id: '1001', date: '2026-10-12', distance: before, streak_day: 1, xp_gained: xpFor(before, 1) }),
        stravaRun({ id: 'r2', external_id: '1002', date: '2026-10-13', distance: before, streak_day: 2, xp_gained: xpFor(before, 2) }),
        stravaRun({ id: 'r3', external_id: '1003', date: '2026-10-14', distance: before, streak_day: 3, xp_gained: xpFor(before, 3) }),
      ],
      users: [userRow({ event_xp: 30, total_xp: xpBefore + 30, total_km: 75, current_streak: 3, longest_streak: 3, current_level: levelFromXP(xpBefore + 30) })],
    });
    store.seed({ object_id: 1002, aspect_type: 'delete' });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    expect(t.runs.map((run) => run.id)).toEqual(['r1', 'r3']);
    // The streak ladder starts over after the gap, and the XP of the later run follows it (reprocessRunsFromDate).
    expect(t.runs.find((run) => run.id === 'r3')).toMatchObject({ streak_day: 1, xp_gained: xpFor(before, 1) });
    expect(t.runs.find((run) => run.id === 'r1')).toMatchObject({ streak_day: 1, xp_gained: xpFor(before, 1) });
    // calculateUserTotals: totals, streak and level from what is left, plus the event XP that the run never carried.
    const xpAfter = 2 * xpFor(before, 1) + 30;
    expect(levelFromXP(xpAfter)).toBeLessThan(levelFromXP(xpBefore + 30)); // the fixture really drops a level
    expect(t.users[0]).toMatchObject({
      total_xp: xpAfter,
      total_km: 50,
      current_streak: 1,
      longest_streak: 1,
      current_level: levelFromXP(xpAfter),
      event_xp: 30,
    });
  });

  it('delete event goes through calculateUserTotals and evaluateBadges', async () => {
    strava = installFakeStravaFetch({ activities: { 1002: stravaError(404) } });
    const { t, store, worker } = build({
      runs: [stravaRun({ id: 'r1', external_id: '1001' }), stravaRun({ id: 'r2', external_id: '1002', date: '2026-10-13', streak_day: 2, xp_gained: 999 })],
      users: [userRow({ current_streak: 2, longest_streak: 2 })],
    });
    // What evaluateBadges sees when it is called: the delete and the reprocess are done by then.
    let seen: { runs: string[]; streakDays: unknown[] } | null = null;
    const actual = await vi.importActual<typeof import('../badgeService.js')>('../badgeService.js');
    vi.mocked(evaluateBadges).mockImplementationOnce(async (userId, options) => {
      seen = { runs: t.runs.map((run) => run.id), streakDays: t.runs.map((run) => run.streak_day) };
      return actual.evaluateBadges(userId, options);
    });
    store.seed({ object_id: 1002, aspect_type: 'delete' });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
    expect(evaluateBadges).toHaveBeenCalledTimes(1);
    expect(vi.mocked(evaluateBadges).mock.calls[0][0]).toBe('user-1');
    expect(vi.mocked(evaluateBadges).mock.calls[0][1]).toMatchObject({ longestStreak: 1 }); // the freshly recomputed streak, not the stored 2
    expect(seen).toEqual({ runs: ['r1'], streakDays: [1] });
  });
});

describe('badges and Pack News', () => {
  const badgeEarned = (series: string, tier: number, previous: number | null = null): Row => ({
    group_id: 'g1', type: 'badge_earned', actor_user_id: 'user-1', target_user_id: null,
    payload: { series, tier, previous_tier: previous }, payload_version: 1,
    dedupe_key: activityKeys.badgeEarned('user-1', series, tier), is_backfill: false, occurred_at: '2026-10-13T10:00:00.000Z',
  });
  const stored = (series: string, tier: number, sourceRunId: string | null): Row => ({
    user_id: 'user-1', series, tier, seen_tier: tier, earned_at: '2026-10-13T10:00:00.000Z', source_run_id: sourceRunId, updated_at: '2026-10-13T10:00:00.000Z',
  });
  const keys = (rows: Row[]) => rows.map((row) => row.dedupe_key).sort();

  it('delete event revokes a badge tier that the run alone supported and retracts badge_earned', async () => {
    strava = installFakeStravaFetch({ activities: { 1002: stravaError(404) } });
    // Milestoner counts the longest single run: 12 km is tier 2 (10 km). The other two runs are 3 km and give no tier at all.
    const levelUp: Row = { group_id: 'g1', type: 'level_up', actor_user_id: 'user-1', target_user_id: null, payload: { level: 2 }, payload_version: 1, dedupe_key: 'level_up:user-1:2', is_backfill: false, occurred_at: '2026-10-12T10:00:00.000Z' };
    const milestone: Row = { group_id: 'g1', type: 'run_milestone', actor_user_id: 'user-1', target_user_id: null, payload: { km: 10 }, payload_version: 1, dedupe_key: 'run_milestone:user-1:10', is_backfill: false, occurred_at: '2026-10-13T10:00:00.000Z' };
    const someoneElse = { ...badgeEarned('milestoner', 2, 1), actor_user_id: 'user-2', dedupe_key: activityKeys.badgeEarned('user-2', 'milestoner', 2) };
    const { t, store, worker } = build({
      runs: [
        stravaRun({ id: 'r1', external_id: '1001', date: '2026-10-12', distance: 3 }),
        stravaRun({ id: 'r2', external_id: '1002', date: '2026-10-13', distance: 12, streak_day: 2 }),
        stravaRun({ id: 'r3', external_id: '1003', date: '2026-10-14', distance: 3, streak_day: 3 }),
      ],
      user_badges: [stored('milestoner', 2, 'r2'), { ...stored('milestoner', 2, null), user_id: 'user-2' }],
      activity_log: [badgeEarned('milestoner', 1), badgeEarned('milestoner', 2, 1), levelUp, milestone, someoneElse],
      users: [userRow({ displayed_badge_series: ['milestoner'], current_streak: 3, longest_streak: 3 })],
    });
    store.seed({ object_id: 1002, aspect_type: 'delete' });

    await worker.drain();

    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'deleted' });
    // The tier is gone with the run: no row left for the series, and the showcase no longer lists it.
    expect(t.user_badges.filter((badge) => badge.user_id === 'user-1' && badge.series === 'milestoner')).toEqual([]);
    expect(t.users[0].displayed_badge_series).toEqual([]);
    // Both badge_earned rows of the user are retracted. Other users' rows and the first-time facts (level_up, run_milestone) stay.
    const remaining = keys(t.activity_log.filter((row) => row.type === 'badge_earned' && row.actor_user_id === 'user-1' && row.payload?.series === 'milestoner'));
    expect(remaining).toEqual([]);
    expect(t.user_badges.some((badge) => badge.user_id === 'user-2' && badge.series === 'milestoner')).toBe(true);
    expect(t.activity_log.map((row) => row.dedupe_key)).toEqual(expect.arrayContaining(['level_up:user-1:2', 'run_milestone:user-1:10', someoneElse.dedupe_key]));
  });

  it('delete event lowers a badge tier to what the remaining runs support and keeps the news of the tiers still held', async () => {
    strava = installFakeStravaFetch({ activities: { 1002: stravaError(404) } });
    // 12 km (tier 2) deleted, a 6 km run remains (tier 1, 5 km).
    const { t, store, worker } = build({
      runs: [
        stravaRun({ id: 'r1', external_id: '1001', date: '2026-10-12', distance: 6 }),
        stravaRun({ id: 'r2', external_id: '1002', date: '2026-10-13', distance: 12, streak_day: 2 }),
      ],
      user_badges: [stored('milestoner', 2, 'r2')],
      activity_log: [badgeEarned('milestoner', 1), badgeEarned('milestoner', 2, 1)],
      users: [userRow({ displayed_badge_series: ['milestoner'], current_streak: 2, longest_streak: 2 })],
    });
    store.seed({ object_id: 1002, aspect_type: 'delete' });

    await worker.drain();

    const milestoner = t.user_badges.find((badge) => badge.series === 'milestoner')!;
    expect(milestoner).toMatchObject({ tier: 1, source_run_id: 'r1' });
    expect(milestoner.seen_tier).toBeLessThanOrEqual(1);
    expect(keys(t.activity_log.filter((row) => row.type === 'badge_earned'))).toEqual([activityKeys.badgeEarned('user-1', 'milestoner', 1)]);
    expect(t.users[0].displayed_badge_series).toEqual(['milestoner']); // the series is still held
  });
});

describe('the logs', () => {
  it('removal writes no strava id, coordinates or title to logs or activity_log', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
      });
    }
    strava = installFakeStravaFetch({ activities: { 987654321: stravaError(404) } });
    // A database message can carry the values of the row; none of it may reach a log or a stored last_error. (The reprocess's own
    // log lines are covered by the last test, with a leaky message there; here the reprocess error carries a code only.)
    const leaky = 'failed for 987654321 at 59.3293,18.0686 hr 171 "My secret morning run" owner 555111';
    let mode: 'delete_fails' | 'reprocess_fails' | 'works' = 'delete_fails';
    const { t, store, worker } = build(
      {
        runs: [
          stravaRun({ id: 'r1', external_id: '987654321', date: '2026-10-13', start_lat: 59.3293, start_lng: 18.0686, avg_heartrate: 171, max_heartrate: 188, streak_day: 1 }),
          stravaRun({ id: 'r2', external_id: '1003', date: '2026-10-14', streak_day: 2 }),
        ],
        users: [userRow({ current_level: 1 })],
      },
      {
        failWhen: (q) => {
          if (mode === 'delete_fails' && q.table === 'runs' && q.mutation === 'delete') return { message: leaky, code: '57P01' } as never;
          if (mode === 'reprocess_fails' && q.table === 'runs' && q.mutation === 'update') return { message: 'update failed', code: '57P02' } as never;
          return null;
        },
      },
    );
    const seedDelete = () => store.seed({ object_id: 987654321, aspect_type: 'delete', owner_id: 555111 });

    seedDelete(); // 1: the delete itself fails
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'handler_error:57P01' });
    expect(t.runs).toHaveLength(2);

    mode = 'reprocess_fails'; // 2: the run goes, the reprocess fails
    clock = new Date(START.getTime() + 2 * MINUTE);
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'pending', attempts: 2, last_error: 'recompute_failed' });
    expect(t.runs.map((run) => run.id)).toEqual(['r2']);

    mode = 'works'; // 3: the retry finds the run gone and recalculates from the earliest run, with the real totals
    clock = new Date(START.getTime() + 10 * MINUTE);
    await worker.drain();
    expect(store.row(1)).toMatchObject({ status: 'done', outcome: 'not_a_run' });
    expect(calculateUserTotals).toHaveBeenCalledTimes(1);

    seedDelete(); // a fresh delivery after all of it: the no-op path logs nothing about the activity either
    await worker.drain();

    const text = [lines.join('\n'), JSON.stringify(t.activity_log), JSON.stringify(store.rows().map((row) => row.last_error))].join('\n');
    expect(lines.some((line) => line.includes('user-1'))).toBe(true); // the failures ARE logged, with our user id and a code
    expect(text).toContain('57P01');
    expect(text).toContain('57P02');
    for (const secret of ['987654321', '555111', '59.3293', '18.0686', '188', 'secret morning', 'old-at']) expect(text).not.toContain(secret);
    // `171` is also a plausible number elsewhere (a count): look for the heart rate in the quoted form of the leak only.
    expect(text).not.toContain('hr 171');
  });

  // reprocessRunsFromDate (routes/runs.ts, shared with the polling) used to log the whole database error object of a failed run
  // update, and a Postgres error can carry the row's values (a CHECK violation prints "Failing row contains (...)" in `details`).
  // It now logs the user id, the count and the error code only.
  it('a failed reprocess does not log the values of the run row either', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
      });
    }
    strava = installFakeStravaFetch({ activities: { 987654321: stravaError(404) } });
    const { store, worker } = build(
      { runs: [stravaRun({ id: 'r1', external_id: '987654321', date: '2026-10-13' }), stravaRun({ id: 'r2', external_id: '1003', date: '2026-10-14', streak_day: 2 })] },
      { failWhen: (q) => (q.table === 'runs' && q.mutation === 'update' ? ({ message: 'failed for 987654321 at 59.3293,18.0686', code: '23514' } as never) : null) },
    );
    store.seed({ object_id: 987654321, aspect_type: 'delete' });

    await worker.drain();

    const text = lines.join('\n');
    expect(text).toContain('23514');
    expect(text).not.toContain('987654321');
    expect(text).not.toContain('59.3293');
  });
});
