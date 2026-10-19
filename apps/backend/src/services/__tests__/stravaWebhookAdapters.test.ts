/**
 * The real versions of the worker's ports (stravaWebhook/supabaseAdapters.ts): coupling tests against createFakeDb and
 * installFakeStravaFetch. The rules (backoff, lease, 48 h, retention cut-offs) are tested once, in stravaWebhookWorker.test.ts,
 * against the in-memory ports; here only that the real ports ask the database and Strava for the right thing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../routes/runs.js', () => ({ reprocessRunsFromDate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../weatherService.js', () => ({ WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../eventService.js', () => ({ checkEventQualification: vi.fn().mockResolvedValue(undefined) }));

import { getSupabaseClient } from '../../config/database.js';
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { reprocessRunsFromDate } from '../../routes/runs.js';
import { calculateUserTotals } from '../../utils/calculateUserTotals.js';
import { WeatherService } from '../weatherService.js';
import { checkEventQualification } from '../eventService.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { installFakeStravaFetch, stravaActivity, stravaAthlete, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';
import { extractExtendedFields } from '../stravaImport.js';
import type { WebhookEventRow, WebhookImportedRun } from '../stravaWebhook/ports.js';
import { logger } from '../../utils/logger.js';
import { createDefaultWebhookWorker } from '../stravaWebhook/defaultWorker.js';
import {
  createRecompute,
  createRunStore,
  createStravaApi,
  createWebhookEventStore,
} from '../stravaWebhook/supabaseAdapters.js';

const EVENTS = 'strava_webhook_events';
const AT = new Date('2026-10-14T12:07:00.000Z');

function useDb(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

let strava: FakeStrava | undefined;
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.unstubAllEnvs();
});

/** The row as claim returned it: the id and the lease token (claimed_at) the writes are matched on. */
const claimed = (id: number, claimedAt: string | null = 'x') => ({ id, claimed_at: claimedAt }) as unknown as WebhookEventRow;

describe('Supabase event store', () => {
  it('claims through the claim RPC with the lease and the batch size and returns the rows', async () => {
    const rpc = vi.fn(() => ({ data: [{ id: 1, owner_id: 5001 }] }));
    useDb({}, { rpc: { claim_strava_webhook_events: rpc } });

    const rows = await createWebhookEventStore().claim(300, 25);

    expect(rpc).toHaveBeenCalledWith({ p_lease_seconds: 300, p_max: 25 });
    expect(rows).toEqual([{ id: 1, owner_id: 5001 }]);
  });

  it('a claim that fails because the connection broke throws the network cause, not "unknown" (supabase-js gives code "")', async () => {
    // The error postgrest-js returns instead of throwing when fetch fails: code '', no name, the cause only in the text.
    const networkError = {
      message: 'TypeError: fetch failed',
      details: 'TypeError: fetch failed\n\nCaused by: Error: read ECONNRESET (ECONNRESET)\n    at jane@example.com',
      hint: '',
      code: '',
    };
    useDb({}, { rpc: { claim_strava_webhook_events: () => ({ error: networkError as any }) } });

    const failure = await createWebhookEventStore().claim(300, 25).catch((error: Error & { code?: string }) => error);

    expect((failure as Error & { code?: string }).code).toBe('ECONNRESET');
    expect((failure as Error).message).toBe('claim failed (ECONNRESET)');

    // A write on a claimed row goes through the same helper.
    useDb({ [EVENTS]: [{ id: 1, status: 'processing' }] }, { errors: { [EVENTS]: networkError as never } });
    const writeFailure = await createWebhookEventStore().markDone(claimed(1), 'imported', AT).catch((error: Error & { code?: string }) => error);
    expect((writeFailure as Error & { code?: string }).code).toBe('ECONNRESET');
  });

  it('an empty claim is an empty list and a failed claim throws with the code only', async () => {
    useDb({}, { rpc: { claim_strava_webhook_events: () => ({ data: null }) } });
    await expect(createWebhookEventStore().claim(300, 25)).resolves.toEqual([]);

    useDb({}, { rpc: { claim_strava_webhook_events: () => ({ error: { message: 'secret detail from the database', code: '57P01' } as any }) } });
    const failure = await createWebhookEventStore().claim(300, 25).catch((error: Error & { code?: string }) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error & { code?: string }).code).toBe('57P01');
    expect((failure as Error).message).not.toContain('secret detail');
  });

  it('writes a status only to a row that is still processing, and says whether it wrote', async () => {
    const tables: Record<string, Row[]> = {
      [EVENTS]: [
        { id: 1, status: 'processing', attempts: 1, claimed_at: 'x', lease_expires_at: 'y' },
        { id: 2, status: 'pending', attempts: 1 },
        { id: 3, status: 'processing', attempts: 0, claimed_at: 'x', lease_expires_at: 'y' },
        { id: 4, status: 'processing', attempts: 0, claimed_at: 'x', lease_expires_at: 'y' },
      ],
    };
    useDb(tables);
    const store = createWebhookEventStore();

    expect(await store.markDone(claimed(1), 'imported', AT)).toBe(true);
    expect(await store.markDone(claimed(2), 'imported', AT)).toBe(false);
    expect(await store.markDead(claimed(3), 'dead_after_48h', AT)).toBe(true);
    expect(await store.release(claimed(4), { attempts: 1, nextAttemptAt: new Date('2026-10-14T12:08:00.000Z'), lastError: 'server_error' })).toBe(true);

    expect(tables[EVENTS][0]).toMatchObject({ status: 'done', outcome: 'imported', processed_at: AT.toISOString(), claimed_at: null, lease_expires_at: null });
    expect(tables[EVENTS][1]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(tables[EVENTS][1].outcome).toBeUndefined();
    expect(tables[EVENTS][2]).toMatchObject({ status: 'dead', last_error: 'dead_after_48h', processed_at: AT.toISOString(), claimed_at: null, lease_expires_at: null });
    expect(tables[EVENTS][3]).toMatchObject({
      status: 'pending',
      attempts: 1,
      next_attempt_at: '2026-10-14T12:08:00.000Z',
      last_error: 'server_error',
      claimed_at: null,
      lease_expires_at: null,
    });
  });

  it('a late write from an old claim does not overwrite a row that was claimed again', async () => {
    const tables: Record<string, Row[]> = {
      [EVENTS]: [{ id: 1, status: 'processing', attempts: 1, claimed_at: '2026-10-14T12:20:00+00:00', lease_expires_at: 'y' }],
    };
    useDb(tables);
    const store = createWebhookEventStore();

    const stale = await store.markDone(claimed(1, '2026-10-14T12:07:00+00:00'), 'imported', AT);
    const staleRelease = await store.release(claimed(1, '2026-10-14T12:07:00+00:00'), { attempts: 5, nextAttemptAt: AT, lastError: 'x' });
    const current = await store.markDone(claimed(1, '2026-10-14T12:20:00+00:00'), 'imported', AT);

    expect([stale, staleRelease, current]).toEqual([false, false, true]);
    expect(tables[EVENTS][0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('a failed write throws, so the worker can log it and leave the row to its lease', async () => {
    useDb({ [EVENTS]: [{ id: 1, status: 'processing' }] }, { errors: { [EVENTS]: { message: 'db down' } } });
    await expect(createWebhookEventStore().markDone(claimed(1), 'noop', AT)).rejects.toThrow();
  });

  it('purges done rows processed before the first cut-off and dead rows before the second, and counts them', async () => {
    const tables: Record<string, Row[]> = {
      [EVENTS]: [
        { id: 1, status: 'done', processed_at: '2026-09-01T00:00:00.000Z' },
        { id: 2, status: 'done', processed_at: '2026-10-10T00:00:00.000Z' },
        { id: 3, status: 'dead', processed_at: '2026-06-01T00:00:00.000Z' },
        { id: 4, status: 'dead', processed_at: '2026-09-01T00:00:00.000Z' },
        { id: 5, status: 'pending', processed_at: null },
      ],
    };
    useDb(tables);

    const purged = await createWebhookEventStore().purge({
      doneBefore: new Date('2026-09-14T00:00:00.000Z'),
      deadBefore: new Date('2026-07-16T00:00:00.000Z'),
    });

    expect(purged).toEqual({ done: 1, dead: 1 });
    expect(tables[EVENTS].map((row) => row.id)).toEqual([2, 4, 5]);
  });
});

describe('Supabase run store', () => {
  const RUN = { user_id: 'user-1', external_id: '9001', date: '2026-10-10', distance: 5.2, source: 'strava', start_time: '2026-10-10T07:00:00+00:00', moving_time: 1800 };

  it('finds the run of (user, external id) whatever its source, selecting every column the decision compares', async () => {
    const db = useDb({ runs: [RUN, { ...RUN, user_id: 'user-2' }, { ...RUN, external_id: '9002' }] });

    const run = await createRunStore().findRun('user-1', '9001');

    expect(run).toMatchObject({ date: '2026-10-10', source: 'strava' });
    const [query] = db.queries;
    expect(query.filters).toEqual([
      { op: 'eq', column: 'user_id', value: 'user-1' },
      { op: 'eq', column: 'external_id', value: '9001' },
    ]);
    const selected = query.select!.split(',').map((column) => column.trim());
    expect(selected).toEqual(expect.arrayContaining(['source', 'date', 'distance', ...Object.keys(extractExtendedFields({}))]));
  });

  it('finds no run as null and throws on a database error', async () => {
    useDb({ runs: [] });
    await expect(createRunStore().findRun('user-1', '1')).resolves.toBeNull();

    useDb({ runs: [] }, { errors: { runs: { message: 'db down' } } });
    await expect(createRunStore().findRun('user-1', '1')).rejects.toThrow();
  });

  it("gives the date of the user's earliest run, or null", async () => {
    useDb({
      runs: [
        { user_id: 'user-1', date: '2026-10-01' },
        { user_id: 'user-1', date: '2026-08-15' },
        { user_id: 'user-2', date: '2026-01-01' },
      ],
    });
    const store = createRunStore();

    expect(await store.earliestRunDate('user-1')).toBe('2026-08-15');
    expect(await store.earliestRunDate('nobody')).toBeNull();
  });
});

describe('Supabase connection read', () => {
  it('reads sync_paused and connection_date from the strava_tokens row of the user only', async () => {
    const db = useDb({
      strava_tokens: [
        { user_id: 'user-1', sync_paused: true, connection_date: '2026-10-01T09:00:00+00:00' },
        { user_id: 'user-2', sync_paused: false, connection_date: null },
      ],
    });

    const connection = await createRunStore().getConnection('user-1');

    expect(connection).toEqual({ syncPaused: true, connectionDate: '2026-10-01T09:00:00+00:00' });
    expect(db.queries[0]).toMatchObject({ table: 'strava_tokens', filters: [{ op: 'eq', column: 'user_id', value: 'user-1' }] });
    expect(db.queries[0].select).not.toMatch(/token/);
  });

  it('reads a connection without a date and without a pause flag as connected and not paused', async () => {
    useDb({ strava_tokens: [{ user_id: 'user-1', connection_date: null }] });
    expect(await createRunStore().getConnection('user-1')).toEqual({ syncPaused: false, connectionDate: null });
  });

  it('gives null for a user with no row and throws, with the code only, on a database error', async () => {
    useDb({ strava_tokens: [] });
    expect(await createRunStore().getConnection('user-1')).toBeNull();

    useDb({ strava_tokens: [] }, { errors: { strava_tokens: { message: 'secret detail', code: '57P01' } as never } });
    const failure = await createRunStore().getConnection('user-1').catch((error: Error & { code?: string }) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error & { code?: string }).code).toBe('57P01');
    expect((failure as Error).message).not.toContain('secret detail');
  });
});

describe('recalculation', () => {
  it('runs the reprocess from the date and the user totals', async () => {
    const recompute = createRecompute();

    await recompute.reprocessFrom('user-1', '2026-10-01');
    await recompute.recalculateTotals('user-1');

    expect(reprocessRunsFromDate).toHaveBeenCalledWith('user-1', '2026-10-01');
    expect(calculateUserTotals).toHaveBeenCalledWith('user-1');
  });

  it('recalculateTotals passes calculateUserTotals\' answer on unchanged, true and false', async () => {
    // calculateUserTotals never throws: the answer is the only way a caller learns that the totals were not written.
    const recompute = createRecompute();

    vi.mocked(calculateUserTotals).mockResolvedValueOnce(false);
    await expect(recompute.recalculateTotals('user-1')).resolves.toBe(false);

    vi.mocked(calculateUserTotals).mockResolvedValueOnce(true);
    await expect(recompute.recalculateTotals('user-1')).resolves.toBe(true);
  });

  const newRun = (over: Partial<WebhookImportedRun> = {}): WebhookImportedRun => ({
    id: 'run-1', external_id: '9001', date: '2026-10-12', distance_km: 5.2, start_lat: 59.3, start_lng: 18.1,
    start_time: '2026-10-12T07:30:00Z', moving_time: 1500, is_treadmill: false, ...over,
  });

  it('fetches weather for the runs through the weather service', async () => {
    const runs = [newRun(), newRun({ id: 'run-2' })];

    await createRecompute().fetchWeather(runs);

    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledTimes(1);
    expect(WeatherService.fetchAndSaveWeatherForRuns).toHaveBeenCalledWith(runs);
  });

  it('qualifies each new run for events with the polling arguments: id, date, distance in km and treadmill', async () => {
    await createRecompute().qualifyEvents('user-1', [newRun(), newRun({ id: 'run-2', date: '2026-10-13', distance_km: 10, is_treadmill: true })]);

    expect(checkEventQualification).toHaveBeenCalledTimes(2);
    expect(checkEventQualification).toHaveBeenNthCalledWith(1, { userId: 'user-1', runId: 'run-1', runDate: '2026-10-12', distanceKm: 5.2, isTreadmill: false });
    expect(checkEventQualification).toHaveBeenNthCalledWith(2, { userId: 'user-1', runId: 'run-2', runDate: '2026-10-13', distanceKm: 10, isTreadmill: true });
  });

  it('one run failing event qualification does not stop the others, and the failure is logged', async () => {
    vi.mocked(checkEventQualification).mockRejectedValueOnce(Object.assign(new Error('db down SECRET'), { code: '57P01' }));
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await createRecompute().qualifyEvents('user-1', [newRun(), newRun({ id: 'run-2' })]);

    expect(checkEventQualification).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET');
    error.mockRestore();
  });
});

describe('Strava API', () => {
  it('renews the token on request through the central client', async () => {
    vi.stubEnv('STRAVA_CLIENT_ID', 'client-id');
    vi.stubEnv('STRAVA_CLIENT_SECRET', 'client-secret');
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse({ access_token: 'renewed' }) });
    useDb({ strava_tokens: [{ user_id: 'user-1', ...tokenCols('user-1', 'old', 'rt'), expires_at: 9999999999, connection_date: null }] }, {
      primaryKeys: { strava_tokens: ['user_id'] },
    });

    expect(await createStravaApi().refreshAccessToken('user-1')).toMatchObject({ ok: true, accessToken: 'renewed', refreshed: true });
  });

  it('fetches an activity with the bearer token and gives the status and the body', async () => {
    strava = installFakeStravaFetch({ activities: { 9001: stravaActivity({ id: 9001, distance: 5200 }) } });

    const response = await createStravaApi().fetchActivity('access-1', 9001);

    expect(response).toMatchObject({ kind: 'http', status: 200, activity: { id: 9001, distance: 5200 } });
    expect(strava.requests[0].headers.authorization).toBe('Bearer access-1');
  });

  it('keeps the status of a refusal and drops its body', async () => {
    strava = installFakeStravaFetch({ activities: { 1: stravaError(404), 2: stravaError(429), 3: stravaError(500) } });
    const api = createStravaApi();

    expect(await api.fetchActivity('t', 1)).toEqual({ kind: 'http', status: 404 });
    expect(await api.fetchActivity('t', 2)).toEqual({ kind: 'http', status: 429 });
    expect(await api.fetchActivity('t', 3)).toEqual({ kind: 'http', status: 500 });
  });

  it('reports a network failure as no answer at all', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('socket hang up with Bearer abc'));
    try {
      expect(await createStravaApi().fetchActivity('t', 1)).toEqual({ kind: 'network_error' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reports a 200 that is not JSON as an answer without an activity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }));
    try {
      expect(await createStravaApi().fetchActivity('t', 1)).toEqual({ kind: 'http', status: 200, activity: null });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('fetches the athlete for the deauthorize check and gives only the status', async () => {
    strava = installFakeStravaFetch({ athlete: stravaAthlete() });
    expect(await createStravaApi().fetchAthlete('t')).toEqual({ kind: 'http', status: 200 });

    strava.restore();
    strava = installFakeStravaFetch({ athlete: stravaError(401) });
    expect(await createStravaApi().fetchAthlete('t')).toEqual({ kind: 'http', status: 401 });
  });
});

describe('default worker', () => {
  it('claims through the RPC and finishes an event whose handler is not registered as done / noop', async () => {
    const event = {
      id: 1, dedupe_key: 'k', object_type: 'athlete', object_id: 9001, aspect_type: 'create', owner_id: 777, subscription_id: 1,
      event_time: new Date().toISOString(), updates: {}, user_id: 'user-777', status: 'processing', outcome: null, attempts: 0,
      next_attempt_at: new Date().toISOString(), claimed_at: new Date().toISOString(), lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
      last_error: null, received_at: new Date().toISOString(), processed_at: null,
    };
    const tables: Record<string, Row[]> = { [EVENTS]: [event] };
    let claims = 0;
    useDb(tables, { rpc: { claim_strava_webhook_events: () => ({ data: claims++ === 0 ? [event] : [] }) } });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});

    await createDefaultWebhookWorker().drain();

    expect(tables[EVENTS][0]).toMatchObject({ status: 'done', outcome: 'noop' });
    expect(warn).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
