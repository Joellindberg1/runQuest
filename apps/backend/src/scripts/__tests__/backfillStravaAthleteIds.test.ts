/**
 * scripts/backfillStravaAthleteIds.ts (ADR 010 decision 4): fills strava_tokens.strava_athlete_id for connections made before
 * the webhook work. Dry-run is the default. Database: createFakeDb (with the unique index from migration 045).
 * Network: installFakeStravaFetch, so a call the test did not configure fails it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret-value';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import {
  installFakeStravaFetch,
  stravaAthlete,
  stravaError,
  stravaTokenResponse,
  type FakeStrava,
  type FakeStravaCall,
} from '../../test-utils/fakeStrava.js';
import { parseArgs, runBackfill } from '../backfillStravaAthleteIds.js';

const HOST = 'abcdef.supabase.co';
const FAR_FUTURE = 9_999_999_999;

let strava: FakeStrava | undefined;
let lines: string[];
const log = (line: string) => void lines.push(line);
const output = () => lines.join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

const token = (userId: string, over: Row = {}): Row => ({
  user_id: userId,
  access_token: `access-${userId}`,
  refresh_token: `refresh-${userId}`,
  expires_at: FAR_FUTURE,
  connection_date: '2026-09-01',
  consent_version: null,
  strava_athlete_id: null,
  sync_paused: false,
  paused_at: null,
  consented_at: null,
  ...over,
});

const USERS: Row[] = [
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
  { id: 'u3', name: 'Cara' },
];

function world(tokens: Row[], failWhen?: (q: RecordedQuery) => { message: string; code?: string } | null) {
  const tables: Record<string, Row[]> = { strava_tokens: tokens, users: USERS.map((u) => ({ ...u })) };
  const db = createFakeDb(tables, {
    failWhen: failWhen as any,
    primaryKeys: { strava_tokens: ['user_id'] },
    uniqueIndexes: [{ table: 'strava_tokens', name: 'strava_tokens_athlete_id_key', columns: ['strava_athlete_id'] }],
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { tables, db };
}

/** GET /athlete answers per access token, so the test can tell users apart. */
function athleteByToken(byToken: Record<string, number | ReturnType<typeof stravaError>>) {
  return (call: FakeStravaCall) => {
    const answer = byToken[call.headers.authorization?.replace('Bearer ', '') ?? ''];
    if (answer === undefined) return stravaError(401);
    return typeof answer === 'number' ? stravaAthlete({ id: answer }) : answer;
  };
}

const writes = (db: ReturnType<typeof world>['db']) => db.queries.filter((q) => q.mutation);
const idOf = (tables: Record<string, Row[]>, userId: string) => tables.strava_tokens.find((r) => r.user_id === userId)?.strava_athlete_id;

describe('backfill dry-run', () => {
  it('backfill dry-run writes nothing and prints the database host', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': 5001, 'access-u2': 5002 }) });
    const { tables, db } = world([token('u1'), token('u2')]);
    const before = JSON.parse(JSON.stringify(tables));

    const report = await runBackfill({ db: db.client as any, apply: false, host: HOST, log });

    expect(writes(db)).toEqual([]);
    expect(tables).toEqual(before);
    expect(output()).toContain(HOST);
    expect(output()).toMatch(/dry-run/i);
    expect(output()).toContain('Alice');
    expect(output()).toContain('5001');
    expect(strava.calls.athlete).toBe(2);
    expect(report.wouldWrite).toEqual([
      { userId: 'u1', athleteId: 5001 },
      { userId: 'u2', athleteId: 5002 },
    ]);
  });

  it('backfill dry-run reports two users that resolve to the same athlete id', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': 5001, 'access-u2': 5001, 'access-u3': 5003 }) });
    const { db } = world([token('u1'), token('u2'), token('u3')]);

    const report = await runBackfill({ db: db.client as any, apply: false, host: HOST, log });

    expect(report.duplicates).toEqual([{ athleteId: 5001, userIds: ['u1', 'u2'] }]);
    expect(report.wouldWrite).toEqual([{ userId: 'u3', athleteId: 5003 }]);
    expect(output()).toMatch(/duplicate/i);
    expect(output()).toContain('Alice');
    expect(output()).toContain('Bob');
    expect(writes(db)).toEqual([]);
  });
});

describe('backfill --apply', () => {
  it('backfill --apply sets strava_athlete_id for connected users', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': 5001, 'access-u2': 5002 }) });
    const { tables, db } = world([
      token('u1', { sync_paused: true, paused_at: '2026-10-01T00:00:00Z' }),
      token('u2', { consent_version: '1', consented_at: '2026-10-02T00:00:00Z' }),
    ]);

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(idOf(tables, 'u1')).toBe(5001);
    expect(idOf(tables, 'u2')).toBe(5002);
    expect(report.written).toEqual([
      { userId: 'u1', athleteId: 5001 },
      { userId: 'u2', athleteId: 5002 },
    ]);
    expect(report.complete).toBe(true);
    // Only the id column is written: pause and consent are left exactly as they were.
    for (const q of writes(db)) expect(q.table).toBe('strava_tokens');
    expect(tables.strava_tokens[0]).toMatchObject({ sync_paused: true, paused_at: '2026-10-01T00:00:00Z', consent_version: null });
    expect(tables.strava_tokens[1]).toMatchObject({ sync_paused: false, consent_version: '1', consented_at: '2026-10-02T00:00:00Z' });
  });

  it('backfill --apply refuses to write an id that already belongs to another user', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u2': 5001, 'access-u3': 5003 }) });
    const { tables, db } = world([token('u1', { strava_athlete_id: 5001 }), token('u2'), token('u3')]);

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(idOf(tables, 'u2')).toBeNull();
    expect(idOf(tables, 'u1')).toBe(5001);
    expect(idOf(tables, 'u3')).toBe(5003);
    expect(report.duplicates).toEqual([{ athleteId: 5001, userIds: ['u1', 'u2'] }]);
    expect(report.complete).toBe(false);
    expect(output()).toMatch(/not written/i);
  });

  it('backfill --apply writes neither of two users that resolve to the same id in one run', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': 5001, 'access-u2': 5001 }) });
    const { tables, db } = world([token('u1'), token('u2')]);

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(writes(db)).toEqual([]);
    expect(idOf(tables, 'u1')).toBeNull();
    expect(idOf(tables, 'u2')).toBeNull();
    expect(report.duplicates).toEqual([{ athleteId: 5001, userIds: ['u1', 'u2'] }]);
  });

  it('backfill --apply treats a unique violation from the database as a duplicate and carries on', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': 5001, 'access-u2': 5002 }) });
    const { tables, db } = world([token('u1'), token('u2')], (q) =>
      q.mutation === 'update' && q.filters.some((f) => f.value === 'u1')
        ? { code: '23505', message: 'duplicate key value violates unique constraint "strava_tokens_athlete_id_key"' }
        : null,
    );

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(idOf(tables, 'u2')).toBe(5002);
    expect(idOf(tables, 'u1')).toBeNull();
    expect(report.duplicates).toEqual([{ athleteId: 5001, userIds: ['u1'] }]);
    expect(report.written).toEqual([{ userId: 'u2', athleteId: 5002 }]);
    expect(report.complete).toBe(false);
  });

  it('backfill --apply reports a failed write and carries on with the next user', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': 5001, 'access-u2': 5002 }) });
    const { tables, db } = world([token('u1'), token('u2')], (q) =>
      q.mutation === 'update' && q.filters.some((f) => f.value === 'u1') ? { message: 'connection lost' } : null,
    );

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(report.failed).toEqual([{ userId: 'u1', reason: 'connection lost' }]);
    expect(idOf(tables, 'u2')).toBe(5002);
    expect(report.complete).toBe(false);
  });
});

describe('backfill idempotence and failures', () => {
  it('backfill skips users that already have strava_athlete_id', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u2': 5002 }) });
    const { tables, db } = world([token('u1', { strava_athlete_id: 5001 }), token('u2')]);

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(strava.calls.athlete).toBe(1);
    expect(strava.requests[0].headers.authorization).toBe('Bearer access-u2');
    expect(report.alreadySet).toEqual(['u1']);
    expect(idOf(tables, 'u1')).toBe(5001);
    expect(idOf(tables, 'u2')).toBe(5002);

    // A second run has nothing left to do and makes no Strava call.
    const again = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });
    expect(strava.calls.athlete).toBe(1);
    expect(again.written).toEqual([]);
    expect(again.complete).toBe(true);
  });

  it('backfill reports users whose token cannot be refreshed', async () => {
    strava = installFakeStravaFetch({
      athlete: athleteByToken({ 'access-u3': 5003 }),
      oauthToken: stravaError(400, { body: { message: 'Bad Request' } }),
    });
    const { tables, db } = world([
      token('u1', { expires_at: 100 }), // expired, Strava refuses the refresh
      token('u2', { expires_at: 100, refresh_token: null }), // expired, nothing to refresh with
      token('u3'),
    ]);

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(report.mustReconnect.map((r) => r.userId)).toEqual(['u1', 'u2']);
    expect(output()).toMatch(/must reconnect/i);
    expect(output()).toContain('Alice');
    expect(output()).toContain('Bob');
    expect(idOf(tables, 'u1')).toBeNull();
    expect(idOf(tables, 'u3')).toBe(5003);
    expect(strava.calls.athlete).toBe(1);
    expect(report.complete).toBe(false);
  });

  it('backfill lists a user as must reconnect when Strava rejects the stored token', async () => {
    strava = installFakeStravaFetch({ athlete: athleteByToken({ 'access-u1': stravaError(401) }) });
    const { db } = world([token('u1')]);

    const report = await runBackfill({ db: db.client as any, apply: false, host: HOST, log });

    expect(report.mustReconnect).toEqual([{ userId: 'u1', reason: 'Strava rejected the token (HTTP 401)' }]);
  });

  it('backfill reports a user whose id could not be fetched without stopping', async () => {
    strava = installFakeStravaFetch({
      athlete: athleteByToken({ 'access-u1': stravaError(500), 'access-u2': 5002 }),
    });
    const { db } = world([token('u1'), token('u2')]);

    const report = await runBackfill({ db: db.client as any, apply: false, host: HOST, log });

    expect(report.failed).toEqual([{ userId: 'u1', reason: 'GET /athlete answered HTTP 500' }]);
    expect(report.wouldWrite).toEqual([{ userId: 'u2', athleteId: 5002 }]);
  });

  it('backfill rejects an athlete response without a valid id', async () => {
    strava = installFakeStravaFetch({ athlete: () => ({ ...stravaAthlete(), id: 'abc' as unknown as number }) });
    const { db } = world([token('u1')]);

    const report = await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    expect(report.failed).toEqual([{ userId: 'u1', reason: 'GET /athlete returned no valid athlete id' }]);
    expect(writes(db)).toEqual([]);
  });
});

describe('backfill logging', () => {
  it('backfill never logs tokens', async () => {
    strava = installFakeStravaFetch({
      athlete: athleteByToken({ 'access-u1': 5001, 'fresh-access': 5002, 'access-u3': stravaError(401) }),
      oauthToken: stravaTokenResponse({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: FAR_FUTURE }),
    });
    const { db } = world([token('u1'), token('u2', { expires_at: 100 }), token('u3')]);
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

    await runBackfill({ db: db.client as any, apply: true, host: HOST, log });

    const everything = [
      output(),
      ...consoleSpies.flatMap((s) => s.mock.calls),
      ...[logger.info, logger.warn, logger.error].flatMap((s) => vi.mocked(s).mock.calls),
    ]
      .map((c) => JSON.stringify(c))
      .join('\n');
    for (const secret of ['access-u1', 'refresh-u1', 'access-u2', 'refresh-u2', 'access-u3', 'fresh-access', 'fresh-refresh', 'client-secret-value']) {
      expect(everything).not.toContain(secret);
    }
    expect(output()).toContain('Alice'); // the run did produce a report
  });
});

describe('parseArgs', () => {
  it('is a dry-run unless --apply is given, and refuses unknown arguments', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseArgs(['--force'])).toThrow(/Unknown argument/);
  });
});
