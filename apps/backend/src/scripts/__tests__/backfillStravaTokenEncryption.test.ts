/**
 * scripts/backfillStravaTokenEncryption.ts (ADR 013 decision 7): moves every strava_tokens row to the active key, optionally renews
 * the tokens at Strava, and has an emergency exit back to plaintext. Dry-run is the default.
 * Database: createFakeDb. Network: installFakeStravaFetch, so a Strava call the test did not configure fails it. Keys: the open test
 * key of vitest.config.ts, and keys generated per run from random bytes; nothing here is a real key or a real token.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { installFakeStravaFetch, stravaError, stravaTokenResponse, type FakeStrava, type FakeStravaCall } from '../../test-utils/fakeStrava.js';
import { legacyToken, plainOfStored, storedToken } from '../../test-utils/stravaTokens.js';
import { resetUnreadableLogThrottle } from '../../services/stravaClient.js';
import { resetLegacyTokenWarnings } from '../../services/stravaTokenStore.js';
import { exitCodeFor, parseArgs, runBackfill, runCli, type BackfillOptions, type BackfillReport, type RefreshReport } from '../backfillStravaTokenEncryption.js';

const HOST = 'abcdef.supabase.co';
const FAR_FUTURE = 9_999_999_999;
const TEST_KEY_B64 = 'cnVucXVlc3Qtb3Blbi10ZXN0LWtleS1uby1zZWNyZXQ='; // the open test key of vitest.config.ts
const newKey = () => randomBytes(32).toString('base64');

let strava: FakeStrava | undefined;
let lines: string[];
const log = (line: string) => void lines.push(line);
const output = () => lines.join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  resetLegacyTokenWarnings();
  resetUnreadableLogThrottle();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const legacyRow = (userId: string, over: Row = {}): Row => ({
  user_id: userId,
  access_token: legacyToken(`access-${userId}`),
  refresh_token: legacyToken(`refresh-${userId}`),
  expires_at: FAR_FUTURE,
  connection_date: '2026-09-01',
  consent_version: null,
  strava_athlete_id: null,
  sync_paused: false,
  ...over,
});

/** A row as the code stores it today: both tokens encrypted with the key that is configured at the time of the call. */
const encryptedRow = (userId: string, over: Row = {}): Row =>
  legacyRow(userId, {
    access_token: storedToken(userId, 'access_token', legacyToken(`access-${userId}`)),
    refresh_token: storedToken(userId, 'refresh_token', legacyToken(`refresh-${userId}`)),
    ...over,
  });

function world(rows: Row[], failWhen?: (q: RecordedQuery) => { message: string; code?: string } | null) {
  const tables: Record<string, Row[]> = { strava_tokens: rows };
  const db = createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] }, failWhen: failWhen as never });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return { tables, db };
}

const writes = (db: ReturnType<typeof world>['db']) => db.queries.filter((q) => q.mutation);
const rowOf = (tables: Record<string, Row[]>, userId: string) => tables.strava_tokens.find((r) => r.user_id === userId)!;
const options = (over: Partial<BackfillOptions> = {}): BackfillOptions => ({ apply: false, refreshTokens: false, decrypt: false, confirmWritePlaintext: false, ...over });
const run = (over: Partial<BackfillOptions> = {}, extra: { signal?: AbortSignal; rateGuard?: { isOverSoftLimit(): boolean } } = {}): Promise<BackfillReport> =>
  runBackfill({ options: options(over), host: HOST, log, ...extra });

/** The plaintext in a stored column, for a column that is encrypted under whatever key is configured now. */
const plainOf = (tables: Record<string, Row[]>, userId: string, column: 'access_token' | 'refresh_token') => plainOfStored(userId, column, rowOf(tables, userId)[column]);

/** Strava's token endpoint: a new pair per call, named after the refresh token that was presented. */
const renewal = (call: FakeStravaCall) => {
  const presented = String((call.body as { refresh_token?: string }).refresh_token);
  return stravaTokenResponse({
    access_token: legacyToken(`new-access-for-${presented.slice(0, 14)}`),
    refresh_token: legacyToken(`new-refresh-for-${presented.slice(0, 14)}`),
    expires_at: FAR_FUTURE,
  });
};

describe('parseArgs', () => {
  it('is a dry-run by default', () => {
    expect(parseArgs([])).toEqual(options());
  });

  it('takes --apply, --refresh-tokens and --decrypt', () => {
    expect(parseArgs(['--apply'])).toEqual(options({ apply: true }));
    expect(parseArgs(['--apply', '--refresh-tokens'])).toEqual(options({ apply: true, refreshTokens: true }));
    expect(parseArgs(['--refresh-tokens'])).toEqual(options({ refreshTokens: true }));
    expect(parseArgs(['--decrypt'])).toEqual(options({ decrypt: true }));
  });

  it('--decrypt --apply needs the extra --confirm-write-plaintext flag', () => {
    expect(() => parseArgs(['--decrypt', '--apply'])).toThrow(/--confirm-write-plaintext/);
    expect(parseArgs(['--decrypt', '--apply', '--confirm-write-plaintext'])).toEqual(options({ decrypt: true, apply: true, confirmWritePlaintext: true }));
  });

  it('refuses combinations that make no sense, and arguments it does not know', () => {
    expect(() => parseArgs(['--confirm-write-plaintext'])).toThrow();
    expect(() => parseArgs(['--apply', '--confirm-write-plaintext'])).toThrow();
    expect(() => parseArgs(['--decrypt', '--confirm-write-plaintext'])).toThrow();
    expect(() => parseArgs(['--decrypt', '--refresh-tokens'])).toThrow();
    expect(() => parseArgs(['--dry-run'])).toThrow(/Unknown argument/);
  });
});

describe('the key', () => {
  it.each([
    ['is missing', '', 'key_missing'],
    ['is malformed', 'prod-1:not-base64', 'key_invalid'],
  ])('a key that %s stops the run before any row is read', async (_name, value, problem) => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', value);
    world([legacyRow('u1')]);
    vi.mocked(getSupabaseClient).mockClear();

    await expect(run({ apply: true })).rejects.toThrow(new RegExp(problem));
    expect(getSupabaseClient).not.toHaveBeenCalled();
    expect(output()).toBe('');
  });

  it('a key id the environment does not accept stops the run and names the ids, not the key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SENTRY_ENVIRONMENT', '');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `stg-1:${newKey()}`);
    world([legacyRow('u1')]);
    vi.mocked(getSupabaseClient).mockClear();

    const failure = await run({ apply: true }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/kid_not_allowed/);
    expect((failure as Error).message).toContain('stg-1');
    expect((failure as Error).message).toContain('prod-');
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
});

describe('dry-run', () => {
  it('writes nothing, prints the target database host, and reports every row by class', async () => {
    const { tables, db } = world([
      legacyRow('u1'),
      legacyRow('u2', { refresh_token: null }),
      encryptedRow('u3'),
      legacyRow('u4', { access_token: 'enc:v1:broken' }),
      legacyRow('u5', { access_token: null, refresh_token: null }),
    ]);
    const before = JSON.parse(JSON.stringify(tables));

    const report = await run();

    expect(writes(db)).toEqual([]);
    expect(tables).toEqual(before);
    expect(output()).toContain(HOST);
    expect(output()).toMatch(/DRY-RUN/);
    expect(output()).toContain('test-1');
    expect(report).toMatchObject({
      host: HOST,
      apply: false,
      direction: 'encrypt',
      activeKid: 'test-1',
      retiredKids: [],
      rows: 5,
      before: { empty: 1, encryptedActive: 1, encryptedOtherKid: 0, plaintext: 2, unrecognised: 1 },
      after: null,
      interrupted: false,
    });
    expect(report.wouldRewrite).toEqual(['u1', 'u2']);
    expect(report.rewritten).toEqual([]);
    expect(report.errors).toEqual([{ userId: 'u4', code: 'unrecognised', column: 'access_token' }]);
    expect(report.errorsByCode).toEqual({ unrecognised: 1 });
    expect(output()).toMatch(/u1: access_token plaintext, refresh_token plaintext -> would encrypt/);
    expect(output()).toMatch(/u3: .*encrypted:test-1.* -> nothing to do/);
    expect(output()).toMatch(/Summary:.*2 would be encrypted/);
    expect(output()).toMatch(/--apply/);
    expect(exitCodeFor(report)).toBe(1); // a row of no known shape is a finding
  });

  it('is exit 0 when it only found rows that --apply would encrypt', async () => {
    world([legacyRow('u1'), encryptedRow('u2')]);

    expect(exitCodeFor(await run())).toBe(0);
  });

  it('with --refresh-tokens it calls no Strava and says how many calls --apply would make', async () => {
    strava = installFakeStravaFetch({}); // any call is unmocked and fails the test
    world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3', { refresh_token: null })]);

    const report = await run({ refreshTokens: true });

    expect(strava.requests).toEqual([]);
    expect(report.refresh).toMatchObject({ wouldAttempt: 2, renewed: [] });
    expect(output()).toMatch(/would ask Strava for new tokens for 2 connection\(s\)/);
  });

  it('with --decrypt it writes nothing and says which rows --apply would decrypt', async () => {
    const { tables, db } = world([encryptedRow('u1'), legacyRow('u2')]);
    const before = JSON.parse(JSON.stringify(tables));

    const report = await run({ decrypt: true });

    expect(writes(db)).toEqual([]);
    expect(tables).toEqual(before);
    expect(report.direction).toBe('decrypt');
    expect(report.wouldRewrite).toEqual(['u1']);
    expect(output()).toMatch(/u1: .* -> would decrypt/);
    expect(output()).toMatch(/Re-run with --apply --confirm-write-plaintext/);
  });
});

describe('--apply', () => {
  it('encrypts legacy plaintext, checks each row by reading it back, and ends with no plaintext left', async () => {
    const { tables } = world([legacyRow('u1'), legacyRow('u2'), encryptedRow('u3'), legacyRow('u4', { refresh_token: null })]);
    const untouched = rowOf(tables, 'u3').access_token;

    const report = await run({ apply: true });

    for (const userId of ['u1', 'u2', 'u4']) {
      expect(rowOf(tables, userId).access_token.startsWith('enc:v1:test-1:')).toBe(true);
      expect(plainOf(tables, userId, 'access_token')).toBe(legacyToken(`access-${userId}`));
      expect(rowOf(tables, userId).expires_at).toBe(FAR_FUTURE);
    }
    expect(plainOf(tables, 'u1', 'refresh_token')).toBe(legacyToken('refresh-u1'));
    expect(rowOf(tables, 'u4').refresh_token).toBeNull();
    expect(rowOf(tables, 'u3').access_token).toBe(untouched);
    expect(report.rewritten).toEqual(['u1', 'u2', 'u4']);
    expect(report.before).toMatchObject({ plaintext: 3, encryptedActive: 1 });
    expect(report.after).toEqual({ empty: 0, encryptedActive: 4, encryptedOtherKid: 0, plaintext: 0, unrecognised: 0 });
    expect(output()).toMatch(/APPLY/);
    expect(output()).toContain(HOST);
    expect(output()).toMatch(/u1: .* -> encrypted and verified/);
    expect(output()).toMatch(/Plaintext rows left: 0/);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('is idempotent: a second run writes nothing', async () => {
    const { db } = world([legacyRow('u1'), legacyRow('u2')]);
    await run({ apply: true });
    const firstRunWrites = writes(db).length;

    const second = await run({ apply: true });

    expect(firstRunWrites).toBe(2);
    expect(writes(db)).toHaveLength(firstRunWrites);
    expect(second.rewritten).toEqual([]);
    expect(second.after).toMatchObject({ plaintext: 0, encryptedActive: 2 });
    expect(exitCodeFor(second)).toBe(0);
  });

  it('can be interrupted and run again: the rows done stay done, the rest is finished', async () => {
    const { tables } = world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3')]);
    const controller = new AbortController();
    const abortAfterFirstRow = (line: string) => {
      lines.push(line);
      if (line.startsWith('  u1:')) controller.abort();
    };

    const first = await runBackfill({ options: options({ apply: true }), host: HOST, log: abortAfterFirstRow, signal: controller.signal });

    expect(first.interrupted).toBe(true);
    expect(first.rewritten).toEqual(['u1']);
    expect(rowOf(tables, 'u1').access_token.startsWith('enc:v1:')).toBe(true);
    expect(rowOf(tables, 'u2').access_token).toBe(legacyToken('access-u2'));
    expect(rowOf(tables, 'u3').access_token).toBe(legacyToken('access-u3'));
    expect(first.after).toMatchObject({ plaintext: 2, encryptedActive: 1 });
    expect(output()).toMatch(/Interrupted/);
    expect(exitCodeFor(first)).toBe(1);

    const second = await run({ apply: true });

    expect(second.interrupted).toBe(false);
    expect(second.rewritten).toEqual(['u2', 'u3']);
    expect(second.after).toMatchObject({ plaintext: 0, encryptedActive: 3 });
    expect(exitCodeFor(second)).toBe(0);
  });

  it('a row that changed between reading and writing is not overwritten, is reported, and is taken by the next run', async () => {
    const refreshed = { access_token: storedToken('u2', 'access_token', legacyToken('refreshed-access')), refresh_token: storedToken('u2', 'refresh_token', legacyToken('refreshed-refresh')) };
    let injected = false;
    const { tables } = world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3')], (q) => {
      // A token refresh saves new (encrypted) tokens on u2 right before our write for u2 runs.
      if (q.mutation === 'update' && q.filters.some((f) => f.column === 'user_id' && f.value === 'u2') && !injected) {
        injected = true;
        Object.assign(rowOf(tables, 'u2'), refreshed);
      }
      return null;
    });

    const report = await run({ apply: true });

    expect(rowOf(tables, 'u2')).toMatchObject(refreshed);
    expect(report.conflicts).toEqual(['u2']);
    expect(report.rewritten).toEqual(['u1', 'u3']);
    expect(output()).toMatch(/u2: .* -> CONFLICT/);
    expect(exitCodeFor(report)).toBe(1);

    // The refresh left u2 encrypted already, so the next run has nothing to change there.
    const next = await run({ apply: true });
    expect(next.conflicts).toEqual([]);
    expect(next.rewritten).toEqual([]);
    expect(exitCodeFor(next)).toBe(0);
  });

  it('a conflict on a plaintext row leaves it plaintext and the next run encrypts it', async () => {
    let injected = false;
    const { tables } = world([legacyRow('u1')], (q) => {
      if (q.mutation === 'update' && !injected) {
        injected = true;
        rowOf(tables, 'u1').refresh_token = legacyToken('rotated-meanwhile'); // the legacy refresh path wrote a new plaintext
      }
      return null;
    });

    const first = await run({ apply: true });
    expect(first.conflicts).toEqual(['u1']);
    expect(first.after).toMatchObject({ plaintext: 1 });
    expect(exitCodeFor(first)).toBe(1);

    const second = await run({ apply: true });
    expect(second.rewritten).toEqual(['u1']);
    expect(plainOf(tables, 'u1', 'refresh_token')).toBe(legacyToken('rotated-meanwhile'));
    expect(exitCodeFor(second)).toBe(0);
  });

  it('a row that fails does not stop the others; it is counted by code and the next run finishes it', async () => {
    let failing = true;
    const { tables } = world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3')], (q) =>
      failing && q.mutation === 'update' && q.filters.some((f) => f.column === 'user_id' && f.value === 'u2') ? { message: 'canceling statement due to statement timeout', code: '57014' } : null,
    );

    const report = await run({ apply: true });

    expect(report.rewritten).toEqual(['u1', 'u3']);
    expect(report.errors).toEqual([{ userId: 'u2', code: 'write_failed' }]);
    expect(report.errorsByCode).toEqual({ write_failed: 1 });
    expect(rowOf(tables, 'u2').access_token).toBe(legacyToken('access-u2'));
    expect(output()).toMatch(/u2: .* -> FAILED: write_failed/);
    expect(output()).toMatch(/Errors by code: write_failed 1/);
    expect(exitCodeFor(report)).toBe(1);

    failing = false;
    const next = await run({ apply: true });
    expect(next.rewritten).toEqual(['u2']);
    expect(exitCodeFor(next)).toBe(0);
  });

  it('moves rows from a retired key to the active key (a rotation) and leaves the plaintext the same', async () => {
    const { tables } = world([encryptedRow('u1'), legacyRow('u2')]); // u1 is sealed with the open test key
    const rotated = `prod-2:${newKey()}`;
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', rotated);
    vi.stubEnv('TOKEN_ENCRYPTION_KEYS_RETIRED', `test-1:${TEST_KEY_B64}`);

    const dry = await run();
    expect(dry.before).toMatchObject({ encryptedOtherKid: 1, plaintext: 1 });
    expect(dry.retiredKids).toEqual(['test-1']);
    expect(output()).toMatch(/u1: .*encrypted:test-1.* -> would encrypt/);

    const report = await run({ apply: true });

    expect(report.activeKid).toBe('prod-2');
    expect(report.rewritten).toEqual(['u1', 'u2']);
    expect(rowOf(tables, 'u1').access_token.startsWith('enc:v1:prod-2:')).toBe(true);
    expect(plainOf(tables, 'u1', 'access_token')).toBe(legacyToken('access-u1'));
    expect(plainOf(tables, 'u1', 'refresh_token')).toBe(legacyToken('refresh-u1'));
    expect(report.after).toMatchObject({ encryptedActive: 2, encryptedOtherKid: 0, plaintext: 0 });
    expect(exitCodeFor(report)).toBe(0);
  });

  it('reports rows it cannot read, by code, and never touches them', async () => {
    const lostKey = `prod-0:${newKey()}`;
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', lostKey);
    const lost = encryptedRow('u3'); // sealed with a key that is not configured below
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `test-1:${TEST_KEY_B64}`);
    const moved = encryptedRow('u2', { access_token: storedToken('u9', 'access_token', legacyToken('access-u9')) });
    const { tables, db } = world([legacyRow('u1', { access_token: 'enc:v2:something' }), moved, lost, legacyRow('u4')]);
    const before = JSON.parse(JSON.stringify(tables));

    const report = await run({ apply: true });

    expect(report.errors).toEqual([
      { userId: 'u1', code: 'unrecognised', column: 'access_token' },
      { userId: 'u2', code: 'auth_failed', column: 'access_token' },
      { userId: 'u3', code: 'unknown_key_id', column: 'access_token' },
    ]);
    expect(report.errorsByCode).toEqual({ unrecognised: 1, auth_failed: 1, unknown_key_id: 1 });
    for (const userId of ['u1', 'u2', 'u3']) expect(rowOf(tables, userId)).toEqual(before.strava_tokens.find((r: Row) => r.user_id === userId));
    expect(writes(db).map((q) => q.filters.find((f) => f.column === 'user_id')?.value)).toEqual(['u4']);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('an empty table is reported as a problem: it is probably the wrong database', async () => {
    world([]);

    const report = await run({ apply: true });

    expect(output()).toMatch(/No token rows found/);
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('--decrypt (the emergency exit)', () => {
  it('writes the plaintext back with the same checks, and a second run does nothing', async () => {
    const { tables, db } = world([encryptedRow('u1'), encryptedRow('u2', { refresh_token: null }), legacyRow('u3')]);

    const report = await run({ decrypt: true, apply: true, confirmWritePlaintext: true });

    expect(rowOf(tables, 'u1')).toMatchObject({ access_token: legacyToken('access-u1'), refresh_token: legacyToken('refresh-u1'), expires_at: FAR_FUTURE });
    expect(rowOf(tables, 'u2')).toMatchObject({ access_token: legacyToken('access-u2'), refresh_token: null });
    expect(rowOf(tables, 'u3').access_token).toBe(legacyToken('access-u3'));
    expect(report.rewritten).toEqual(['u1', 'u2']);
    expect(report.direction).toBe('decrypt');
    expect(report.after).toMatchObject({ plaintext: 3, encryptedActive: 0, encryptedOtherKid: 0 });
    expect(output()).toMatch(/PLAINTEXT/);
    expect(output()).toMatch(/u1: .* -> decrypted and verified/);
    expect(output()).toContain(HOST);
    expect(exitCodeFor(report)).toBe(0);

    const writesBefore = writes(db).length;
    const second = await run({ decrypt: true, apply: true, confirmWritePlaintext: true });
    expect(second.rewritten).toEqual([]);
    expect(writes(db)).toHaveLength(writesBefore);
  });

  it('does not run without the confirmation, whatever else is given', async () => {
    const { tables } = world([encryptedRow('u1')]);
    const before = JSON.parse(JSON.stringify(tables));

    await expect(run({ decrypt: true, apply: true, confirmWritePlaintext: false })).rejects.toThrow(/--confirm-write-plaintext/);
    expect(tables).toEqual(before);
  });

  it('leaves a row alone whose token it cannot open, and a conflict is not overwritten', async () => {
    let injected = false;
    const { tables } = world([encryptedRow('u1', { access_token: 'enc:v1:broken' }), encryptedRow('u2')], (q) => {
      if (q.mutation === 'update' && !injected) {
        injected = true;
        Object.assign(rowOf(tables, 'u2'), { refresh_token: storedToken('u2', 'refresh_token', legacyToken('rotated-meanwhile')) });
      }
      return null;
    });

    const report = await run({ decrypt: true, apply: true, confirmWritePlaintext: true });

    expect(report.errors).toEqual([{ userId: 'u1', code: 'unrecognised', column: 'access_token' }]);
    expect(report.conflicts).toEqual(['u2']);
    expect(rowOf(tables, 'u1').access_token).toBe('enc:v1:broken');
    expect(plainOf(tables, 'u2', 'refresh_token')).toBe(legacyToken('rotated-meanwhile'));
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('--refresh-tokens', () => {
  it('encrypts first, then asks Strava once per connection through the shared path and saves the new tokens encrypted', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    const { tables } = world([legacyRow('u1'), encryptedRow('u2'), legacyRow('u3')]);
    const guard = { isOverSoftLimit: vi.fn(() => false) };

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: guard });

    expect(strava.calls.oauthToken).toBe(3);
    expect(guard.isOverSoftLimit).toHaveBeenCalledTimes(3);
    // Strava was asked with the OLD refresh token of each connection (a plaintext row was decrypted for it, never sent encrypted).
    expect(strava.requests.map((r) => (r.body as { refresh_token: string }).refresh_token)).toEqual([legacyToken('refresh-u1'), legacyToken('refresh-u2'), legacyToken('refresh-u3')]);
    for (const userId of ['u1', 'u2', 'u3']) {
      expect(rowOf(tables, userId).refresh_token.startsWith('enc:v1:test-1:')).toBe(true);
      expect(plainOf(tables, userId, 'refresh_token')).toBe(legacyToken(`new-refresh-for-${legacyToken(`refresh-${userId}`).slice(0, 14)}`));
      expect(plainOf(tables, userId, 'access_token')).toBe(legacyToken(`new-access-for-${legacyToken(`refresh-${userId}`).slice(0, 14)}`));
    }
    expect(report.refresh).toMatchObject({ renewed: ['u1', 'u2', 'u3'], failed: [], skippedForRateLimit: [] });
    expect(report.after).toMatchObject({ plaintext: 0, encryptedActive: 3 });
    expect(output()).toMatch(/u1: new tokens saved/);
    expect(output()).toMatch(/Renewed at Strava: 3/);
    // The shared path logs why it renews; for the backfill that is not "Strava rejected the access token".
    const info = vi.mocked(logger.info).mock.calls.map((call) => String(call[0]));
    expect(info.some((line) => line.includes('rejected the access token'))).toBe(false);
    expect(info.filter((line) => line === '🔄 The token backfill renews the tokens, refreshing...')).toHaveLength(3);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('stops asking Strava when the shared rate guard says the budget is used, and says which connections were left', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3')]);
    let answers = 0;
    const guard = { isOverSoftLimit: () => answers++ >= 1 }; // open for the first call only

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: guard });

    expect(strava.calls.oauthToken).toBe(1);
    expect(report.refresh).toMatchObject({ renewed: ['u1'], skippedForRateLimit: ['u2', 'u3'] });
    expect(output()).toMatch(/Strava's rate budget is used up/);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('a renewal Strava refuses or cannot answer is reported by reason and the others still run', async () => {
    strava = installFakeStravaFetch({
      oauthToken: (call) => {
        const presented = String((call.body as { refresh_token: string }).refresh_token);
        if (presented === legacyToken('refresh-u1')) {
          return stravaError(400, { body: { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } });
        }
        if (presented === legacyToken('refresh-u2')) return stravaError(500);
        return renewal(call);
      },
    });
    const { tables } = world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3'), legacyRow('u4', { refresh_token: null, expires_at: 1 })]);

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(report.refresh?.renewed).toEqual(['u3']);
    expect(report.refresh?.failed).toEqual([
      { userId: 'u1', code: 'refresh_rejected' },
      { userId: 'u2', code: 'refresh_failed' },
    ]);
    expect(report.refresh?.failedByCode).toEqual({ refresh_rejected: 1, refresh_failed: 1 });
    // A connection with no refresh token has nothing to renew: told apart from the failures.
    expect(report.refresh?.noRefreshToken).toEqual(['u4']);
    expect(output()).toMatch(/Nothing to renew \(no refresh token stored; not a failure\): u4/);
    expect(output()).toMatch(/u4: nothing to renew/);
    // The encryption part is done for all of them regardless: a failed renewal is not a failed encryption.
    expect(report.after).toMatchObject({ plaintext: 0, encryptedActive: 4 });
    expect(plainOf(tables, 'u1', 'refresh_token')).toBe(legacyToken('refresh-u1'));
    expect(output()).toMatch(/Renewal failures by reason: refresh_rejected 1, refresh_failed 1/);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('a connection with no refresh token alone does not make the run fail', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    world([legacyRow('u1'), legacyRow('u2', { refresh_token: null })]);

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(report.refresh).toMatchObject({ renewed: ['u1'], failed: [], noRefreshToken: ['u2'] });
    expect(exitCodeFor(report)).toBe(0);
  });

  it('stops at the first user whose token Strava may have replaced without it being saved, says so, and asks nobody else', async () => {
    // Strava answers with 200 and a body nobody can use: the token may be replaced, and we hold nothing new.
    strava = installFakeStravaFetch({ oauthToken: (call) => ((call.body as { refresh_token: string }).refresh_token === legacyToken('refresh-u1') ? ({ unexpected: 'shape' } as never) : renewal(call)) });
    world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3')]);

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(strava.calls.oauthToken).toBe(1);
    expect(report.refresh).toMatchObject({
      renewed: [],
      failed: [{ userId: 'u1', code: 'refresh_failed' }],
      mayHaveLost: ['u1'],
      stoppedBeforeAsking: ['u2', 'u3'],
    });
    expect(output()).toMatch(/u1: STRAVA MAY HAVE REPLACED THIS USER'S REFRESH TOKEN WITHOUT IT BEING SAVED.*reconnect Strava.*KRITISKT/);
    expect(output()).toMatch(/MAY HAVE LOST THEIR STRAVA CONNECTION.*: u1/);
    expect(output()).toMatch(/Not asked because the run stopped early: u2, u3/);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('stops when the new tokens cannot be saved (the KRITISKT line is logged), before the next user loses theirs too', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    // The three updates of the encryption step succeed; every update after them (the saves of the renewal) fails.
    let updates = 0;
    world([legacyRow('u1'), legacyRow('u2'), legacyRow('u3')], (q) => (q.mutation === 'update' && ++updates > 3 ? { message: 'the database is read-only', code: '25006' } : null));

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(strava.calls.oauthToken).toBe(1);
    expect(report.refresh).toMatchObject({ mayHaveLost: ['u1'], stoppedBeforeAsking: ['u2', 'u3'] });
    expect(vi.mocked(logger.error).mock.calls.some((call) => String(call[0]).includes('KRITISKT: kunde inte spara roterad Strava-token'))).toBe(true);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('stops after two failed renewals in a row', async () => {
    strava = installFakeStravaFetch({ oauthToken: (call) => (['refresh-u1', 'refresh-u2'].some((id) => (call.body as { refresh_token: string }).refresh_token === legacyToken(id)) ? stravaError(500) : renewal(call)) });
    world([1, 2, 3, 4].map((n) => legacyRow(`u${n}`)));

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    // u1 and u2 fail in a row (Strava answered 500: nothing was replaced): the run stops there.
    expect(strava.calls.oauthToken).toBe(2);
    expect(report.refresh).toMatchObject({ failed: [{ userId: 'u1', code: 'refresh_failed' }, { userId: 'u2', code: 'refresh_failed' }], mayHaveLost: [] });
    expect(report.refresh?.stoppedBeforeAsking).toEqual(['u3', 'u4']);
    expect(output()).toMatch(/Stopped after 2 failed renewals in a row/);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('does not stop for failures that a success separates: the count starts again after a success', async () => {
    strava = installFakeStravaFetch({ oauthToken: (call) => (['refresh-u1', 'refresh-u3'].some((id) => (call.body as { refresh_token: string }).refresh_token === legacyToken(id)) ? stravaError(500) : renewal(call)) });
    world([1, 2, 3, 4].map((n) => legacyRow(`u${n}`)));

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(strava.calls.oauthToken).toBe(4);
    expect(report.refresh).toMatchObject({ renewed: ['u2', 'u4'], stoppedBeforeAsking: [] });
    expect(report.refresh?.failed.map((f) => f.userId)).toEqual(['u1', 'u3']);
  });

  it('says which rows were not renewed because of an error in the row, and that their old refresh token stays alive', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    world([legacyRow('u1', { access_token: 'enc:v1:broken' }), legacyRow('u2')]);

    await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(output()).toMatch(/Not renewed because of an error in the row: u1\. Their old refresh token stays alive at Strava/);
  });

  it('the dry-run says the same in the conditional', async () => {
    world([legacyRow('u1', { access_token: 'enc:v1:broken' }), legacyRow('u2')]);

    await run({ refreshTokens: true });

    expect(output()).toMatch(/Would not be renewed because of an error in the row: u1/);
  });

  it('does not ask Strava for a row it could not encrypt or read', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    world([legacyRow('u1', { access_token: 'enc:v1:broken' }), legacyRow('u2')]);

    const report = await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } });

    expect(strava.calls.oauthToken).toBe(1);
    expect(report.refresh?.renewed).toEqual(['u2']);
    expect(report.refresh?.notAttempted).toEqual(['u1']);
  });
});

describe('when the table cannot be read', () => {
  it('says that strava_tokens could not be read, with the error code and the HTTP status, and nothing of the database message', async () => {
    world([legacyRow('u1')], () => ({ message: 'permission denied: Key (access_token)=(row-value-in-message)', code: 'PGRST301', status: 401 } as never));

    const failure = await run({ apply: true }).catch((error: Error) => error);

    expect((failure as Error).message).toMatch(/Could not read strava_tokens \(PGRST301, HTTP 401\)/);
    expect((failure as Error).message).not.toContain('row-value-in-message');
    expect(output()).toBe('');
  });

  it('a database error with no code is still named by its status and not as a bare "unknown"', async () => {
    world([legacyRow('u1')], () => ({ message: 'bad gateway', code: '', status: 503 } as never));

    const failure = await run().catch((error: Error) => error);

    expect((failure as Error).message).toMatch(/Could not read strava_tokens \(unknown, HTTP 503\)/);
  });
});

describe('a row that fails in a way nobody foresaw', () => {
  it('is counted as unexpected_error with the kind of error only, never the message, and the other rows go on', async () => {
    const { tables } = world([legacyRow('u1'), legacyRow('u2')], (q) => {
      if (q.mutation === 'update' && q.filters.some((f) => f.column === 'user_id' && f.value === 'u1')) {
        throw new Error('exploded while holding access-u1000 and Key (refresh_token)=(refresh-value-in-message)');
      }
      return null;
    });

    const report = await run({ apply: true });

    expect(report.errors).toEqual([{ userId: 'u1', code: 'unexpected_error:Error' }]);
    expect(report.rewritten).toEqual(['u2']);
    expect(rowOf(tables, 'u1').access_token).toBe(legacyToken('access-u1'));
    const everything = [output(), JSON.stringify(report)].join('\n');
    expect(everything).not.toContain('exploded');
    expect(everything).not.toContain('refresh-value-in-message');
    expect(everything).not.toContain('access-u1000');
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('runCli', () => {
  const deps = (over: Partial<Parameters<typeof runCli>[1]> = {}) => ({
    env: { STRAVA_CLIENT_ID: 'id', STRAVA_CLIENT_SECRET: 'secret' } as NodeJS.ProcessEnv,
    host: HOST,
    log,
    initSentry: vi.fn(() => true),
    flushSentry: vi.fn(async () => true),
    registerRateBudget: vi.fn(),
    ...over,
  });

  it('starts Sentry before the run, so a KRITISKT line reaches it, and flushes it after; returns the exit code', async () => {
    world([legacyRow('u1')]);
    const calls: string[] = [];
    const d = deps({ initSentry: vi.fn(() => (calls.push('init'), true)), flushSentry: vi.fn(async () => (calls.push('flush'), true)) });
    const logWithOrder = (line: string) => {
      if (calls[calls.length - 1] !== 'run') calls.push('run');
      log(line);
    };

    expect(await runCli(['--apply'], { ...d, log: logWithOrder })).toBe(0);
    expect(calls).toEqual(['init', 'run', 'flush']);
  });

  it('flushes Sentry even when the run is stopped by an exception', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    world([legacyRow('u1')]);
    const d = deps();

    await expect(runCli(['--apply'], d)).rejects.toThrow(/key_missing/);
    expect(d.flushSentry).toHaveBeenCalledTimes(1);
  });

  it('registers the shared rate budget and needs the Strava credentials only for --apply --refresh-tokens', async () => {
    strava = installFakeStravaFetch({ oauthToken: renewal });
    world([legacyRow('u1')]);
    const d = deps();

    await runCli(['--apply', '--refresh-tokens'], d);
    expect(d.registerRateBudget).toHaveBeenCalledTimes(1);

    const none = deps({ env: {} });
    await expect(runCli(['--apply', '--refresh-tokens'], none)).rejects.toThrow(/STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set/);
    expect(none.registerRateBudget).not.toHaveBeenCalled();

    const dry = deps({ env: {} });
    await runCli([], dry);
    expect(dry.registerRateBudget).not.toHaveBeenCalled();
  });
});

describe('what a run prints and logs', () => {
  it('holds no token, no enc:v1 string and no key material, in the output, the report or any log line', async () => {
    const activeKey = newKey();
    const retiredKey = newKey();
    // Rows sealed under a key that is retired by the time of the run, plus plaintext, broken and moved values.
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `old-1:${retiredKey}`);
    const sealedOld = encryptedRow('u1');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `test-1:${TEST_KEY_B64}`);
    const brokenValue = 'enc:v1:test-1:AAAA:BBBB:CCCC';
    const { tables } = world([
      sealedOld,
      legacyRow('u2'),
      legacyRow('u3', { access_token: brokenValue }),
      encryptedRow('u4', { access_token: storedToken('u9', 'access_token', legacyToken('moved-access-u9')) }),
      legacyRow('u5'),
    ]);
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', `new-1:${activeKey}`);
    vi.stubEnv('TOKEN_ENCRYPTION_KEYS_RETIRED', `old-1:${retiredKey},test-1:${TEST_KEY_B64}`);
    strava = installFakeStravaFetch({ oauthToken: renewal });
    const seen = [
      ...['u1', 'u2', 'u3', 'u4', 'u5'].flatMap((id) => [legacyToken(`access-${id}`), legacyToken(`refresh-${id}`)]),
      legacyToken('moved-access-u9'),
      brokenValue,
      ...tables.strava_tokens.flatMap((r) => [r.access_token, r.refresh_token]).filter((v) => typeof v === 'string' && v.startsWith('enc:')),
    ];

    const reports = [
      await run(),
      await run({ apply: true, refreshTokens: true }, { rateGuard: { isOverSoftLimit: () => false } }),
      await run({ decrypt: true }),
      await run({ decrypt: true, apply: true, confirmWritePlaintext: true }),
    ];
    // Tokens that exist only after the renewal.
    const renewed = tables.strava_tokens.flatMap((r) => [r.access_token, r.refresh_token]).filter((v): v is string => typeof v === 'string');

    const logged = [logger.info, logger.warn, logger.error].flatMap((spy) => vi.mocked(spy).mock.calls.map((call) => call.map(String).join(' ')));
    const everything = [output(), JSON.stringify(reports), ...logged].join('\n');
    expect(logged.length).toBeGreaterThan(0);
    for (const needle of [...seen, ...renewed, 'new-access-for', 'new-refresh-for', activeKey, retiredKey, TEST_KEY_B64, 'runquest-open-test-key', 'client-secret-value']) {
      expect(everything, needle).not.toContain(needle);
    }
    expect(everything).not.toContain('enc:v1');
    expect(everything).not.toMatch(/enc:/);
  });
});

describe('exitCodeFor', () => {
  const base: BackfillReport = {
    host: HOST,
    apply: true,
    direction: 'encrypt',
    refreshTokens: false,
    activeKid: 'prod-1',
    retiredKids: [],
    rows: 2,
    before: { empty: 0, encryptedActive: 0, encryptedOtherKid: 0, plaintext: 2, unrecognised: 0 },
    after: { empty: 0, encryptedActive: 2, encryptedOtherKid: 0, plaintext: 0, unrecognised: 0 },
    wouldRewrite: [],
    rewritten: ['u1', 'u2'],
    nothingToDo: 0,
    conflicts: [],
    superseded: [],
    errors: [],
    errorsByCode: {},
    refresh: null,
    interrupted: false,
  };

  it('is 0 only for a clean, complete run', () => {
    expect(exitCodeFor(base)).toBe(0);
    expect(exitCodeFor({ ...base, rows: 0 })).toBe(1);
    expect(exitCodeFor({ ...base, interrupted: true })).toBe(1);
    expect(exitCodeFor({ ...base, conflicts: ['u1'] })).toBe(1);
    expect(exitCodeFor({ ...base, errors: [{ userId: 'u1', code: 'write_failed' }] })).toBe(1);
    expect(exitCodeFor({ ...base, after: { ...base.after!, plaintext: 1 } })).toBe(1);
    expect(exitCodeFor({ ...base, after: { ...base.after!, encryptedOtherKid: 1 } })).toBe(1);
    expect(exitCodeFor({ ...base, after: { ...base.after!, unrecognised: 1 } })).toBe(1);
  });

  it('a superseded row is not a failure: a refresh landed after the write and the row is readable', () => {
    expect(exitCodeFor({ ...base, superseded: ['u1'] })).toBe(0);
  });

  it('a renewal run is clean only when nothing was left undone, and "no refresh token" is not something left undone', () => {
    const refresh: RefreshReport = {
      wouldAttempt: 0,
      renewed: ['u1'],
      failed: [],
      failedByCode: {},
      noRefreshToken: ['u2'],
      mayHaveLost: [],
      stoppedBeforeAsking: [],
      skippedForRateLimit: [],
      notAttempted: [],
    };
    expect(exitCodeFor({ ...base, refresh })).toBe(0);
    expect(exitCodeFor({ ...base, refresh: { ...refresh, failed: [{ userId: 'u3', code: 'refresh_failed' }] } })).toBe(1);
    expect(exitCodeFor({ ...base, refresh: { ...refresh, mayHaveLost: ['u3'] } })).toBe(1);
    expect(exitCodeFor({ ...base, refresh: { ...refresh, stoppedBeforeAsking: ['u3'] } })).toBe(1);
    expect(exitCodeFor({ ...base, refresh: { ...refresh, skippedForRateLimit: ['u3'] } })).toBe(1);
  });

  it('the emergency exit is done when no encrypted column is left', () => {
    const decrypted = { ...base, direction: 'decrypt' as const, after: { empty: 0, encryptedActive: 0, encryptedOtherKid: 0, plaintext: 2, unrecognised: 0 } };
    expect(exitCodeFor(decrypted)).toBe(0);
    expect(exitCodeFor({ ...decrypted, after: { ...decrypted.after, encryptedActive: 1 } })).toBe(1);
  });
});
