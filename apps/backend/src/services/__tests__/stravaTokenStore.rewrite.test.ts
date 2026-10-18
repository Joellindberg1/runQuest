/**
 * The token store's rewrite of whole rows (ADR 013 decision 7, for the backfill script): listing the rows without handing out a raw
 * value, re-encrypting or decrypting one row with a compare-and-swap on both stored strings, and checking it by reading it back.
 * Database: createFakeDb. No network.
 */
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { ACTIVE_KEY_ENV, RETIRED_KEYS_ENV, parseKeyRing } from '../../utils/secretBox.js';
import { createFakeDb, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { legacyToken, storedToken } from '../../test-utils/stravaTokens.js';
import { listTokenRows, openStravaToken, rewriteTokenRow, sealStravaToken } from '../stravaTokenStore.js';

// Keys are generated per run from random bytes: nothing here is a real key.
const newKey = () => randomBytes(32).toString('base64');
const ring = (active: string, retired?: string) => parseKeyRing({ [ACTIVE_KEY_ENV]: active, ...(retired === undefined ? {} : { [RETIRED_KEYS_ENV]: retired }) });

const ACTIVE = ring(`prod-1:${newKey()}`);
const ACCESS = legacyToken('plain-access');
const REFRESH = legacyToken('plain-refresh');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const legacyRow = (userId: string, over: Row = {}): Row => ({
  user_id: userId,
  access_token: legacyToken(`access-${userId}`),
  refresh_token: legacyToken(`refresh-${userId}`),
  expires_at: 1_900_000_000,
  connection_date: '2026-09-01',
  ...over,
});

function use(rows: Row[], failWhen?: (q: RecordedQuery) => { message: string; code?: string } | null) {
  const tables: Record<string, Row[]> = { strava_tokens: rows };
  const db = createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] }, failWhen: failWhen as never });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return { tables, db };
}

const writes = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.mutation);
const rowOf = (tables: Record<string, Row[]>, userId: string) => tables.strava_tokens.find((r) => r.user_id === userId)!;

describe('listing the token rows', () => {
  it('lists every row in pages with the form of each column, and hands out no raw value', async () => {
    const encrypted = sealStravaToken('u3', 'access_token', ACCESS, ACTIVE);
    const { db } = use([
      legacyRow('u1'),
      legacyRow('u2', { refresh_token: null }),
      legacyRow('u3', { access_token: encrypted, refresh_token: sealStravaToken('u3', 'refresh_token', REFRESH, ACTIVE) }),
      legacyRow('u4', { access_token: 'enc:v1:broken' }),
      legacyRow('u5', { access_token: null, refresh_token: null }),
    ]);

    const rows = await listTokenRows(2);

    expect(rows.map((r) => r.userId)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(rows.map((r) => [r.access.form, r.refresh.form])).toEqual([
      ['plaintext', 'plaintext'],
      ['plaintext', 'empty'],
      ['encrypted', 'encrypted'],
      ['unrecognised', 'plaintext'],
      ['empty', 'empty'],
    ]);
    expect(rows[2].access).toEqual({ form: 'encrypted', kid: 'prod-1' });
    expect(db.queries.filter((q) => q.range).map((q) => q.range)).toEqual([[0, 1], [2, 3], [4, 5]]);

    // Printing or serialising a row shows who and which form, never a stored string.
    const printed = `${JSON.stringify(rows)}\n${inspect(rows, { depth: 5 })}\n${String(rows[0])}`;
    expect(printed).not.toContain('access-u1');
    expect(printed).not.toContain('enc:v1');
    expect(printed).toContain('u1');
  });

  it('throws on a database error, so a failed listing is never read as an empty table', async () => {
    use([legacyRow('u1')], () => ({ message: 'connection reset', code: '08006' }));

    await expect(listTokenRows()).rejects.toBeDefined();
  });
});

describe('encrypting a row', () => {
  it('writes both columns encrypted under the active key, checks them by reading them back, and touches nothing else', async () => {
    const { tables } = use([legacyRow('u1')]);
    const [row] = await listTokenRows();

    const outcome = await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false });

    expect(outcome).toEqual({ status: 'written' });
    const stored = rowOf(tables, 'u1');
    expect(stored.access_token.startsWith('enc:v1:prod-1:')).toBe(true);
    expect(stored.refresh_token.startsWith('enc:v1:prod-1:')).toBe(true);
    expect(stored.expires_at).toBe(1_900_000_000);
    expect(stored.connection_date).toBe('2026-09-01');
    // The test ring is not the vitest key: open with the ring the row was sealed with.
    expect(openStravaToken('u1', 'access_token', stored.access_token, ACTIVE)).toEqual({ ok: true, token: legacyToken('access-u1'), legacy: false });
    expect(openStravaToken('u1', 'refresh_token', stored.refresh_token, ACTIVE)).toEqual({ ok: true, token: legacyToken('refresh-u1'), legacy: false });
  });

  it('is conditional on BOTH stored strings, so a refresh that landed after the listing is never overwritten', async () => {
    const { tables, db } = use([legacyRow('u1')]);
    const [row] = await listTokenRows();
    // The refresh path saved new tokens (encrypted) between the listing and the write.
    const refreshed = { access_token: storedToken('u1', 'access_token', 'new-access'), refresh_token: storedToken('u1', 'refresh_token', 'new-refresh') };
    Object.assign(rowOf(tables, 'u1'), refreshed);

    const outcome = await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false });

    expect(outcome).toEqual({ status: 'conflict' });
    expect(rowOf(tables, 'u1')).toMatchObject(refreshed);
    const update = writes(db)[0];
    expect(update.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'user_id', value: 'u1' },
        { op: 'eq', column: 'access_token', value: legacyToken('access-u1') },
        { op: 'eq', column: 'refresh_token', value: legacyToken('refresh-u1') },
      ]),
    );
  });

  it('a row removed after the listing is a conflict, not an error', async () => {
    const { tables } = use([legacyRow('u1')]);
    const [row] = await listTokenRows();
    tables.strava_tokens.length = 0;

    expect(await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'conflict' });
  });

  it('a dry run proves the round trip in memory and writes nothing', async () => {
    const { tables, db } = use([legacyRow('u1')]);
    const before = JSON.parse(JSON.stringify(tables));
    const [row] = await listTokenRows();

    const outcome = await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: true });

    expect(outcome).toEqual({ status: 'ready' });
    expect(tables).toEqual(before);
    expect(writes(db)).toEqual([]);
  });

  it('leaves a row alone that is already on the active key, and a row with no tokens', async () => {
    const { db } = use([
      legacyRow('u1', { access_token: sealStravaToken('u1', 'access_token', ACCESS, ACTIVE), refresh_token: sealStravaToken('u1', 'refresh_token', REFRESH, ACTIVE) }),
      legacyRow('u2', { access_token: null, refresh_token: null }),
    ]);
    const rows = await listTokenRows();

    for (const row of rows) expect(await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'nothing_to_do' });
    expect(writes(db)).toEqual([]);
  });

  it('re-seals only the column that needs it: an empty column stays empty, a column already on the active key stays as it is', async () => {
    const keptAccess = sealStravaToken('u1', 'access_token', ACCESS, ACTIVE);
    const { tables } = use([legacyRow('u1', { access_token: keptAccess }), legacyRow('u2', { refresh_token: null })]);
    const rows = await listTokenRows();

    expect(await rewriteTokenRow(rows[0], 'encrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'written' });
    expect(await rewriteTokenRow(rows[1], 'encrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'written' });

    expect(rowOf(tables, 'u1').access_token).toBe(keptAccess);
    expect(rowOf(tables, 'u1').refresh_token.startsWith('enc:v1:prod-1:')).toBe(true);
    expect(rowOf(tables, 'u2').refresh_token).toBeNull();
    expect(rowOf(tables, 'u2').access_token.startsWith('enc:v1:prod-1:')).toBe(true);
  });

  it('moves a row on a retired key to the active key, and the value is the same plaintext', async () => {
    const oldKey = `prod-1:${newKey()}`;
    const oldRing = ring(oldKey);
    const rotated = ring(`prod-2:${newKey()}`, oldKey);
    const { tables } = use([
      legacyRow('u1', { access_token: sealStravaToken('u1', 'access_token', ACCESS, oldRing), refresh_token: sealStravaToken('u1', 'refresh_token', REFRESH, oldRing) }),
    ]);
    const [row] = await listTokenRows();
    expect(row.access).toEqual({ form: 'encrypted', kid: 'prod-1' });

    expect(await rewriteTokenRow(row, 'encrypt', rotated, { dryRun: false })).toEqual({ status: 'written' });

    const [after] = await listTokenRows();
    expect(after.access).toEqual({ form: 'encrypted', kid: 'prod-2' });
    expect(after.refresh).toEqual({ form: 'encrypted', kid: 'prod-2' });
    expect(rowOf(tables, 'u1').access_token).not.toContain(ACCESS);
  });

  it('refuses a row it cannot read, with the cause as a code, and writes nothing', async () => {
    const lost = ring(`prod-0:${newKey()}`);
    const { tables, db } = use([
      legacyRow('u1', { access_token: 'enc:v1:broken' }),
      legacyRow('u2', { access_token: sealStravaToken('u2', 'access_token', ACCESS, lost) }),
      // Sealed for another row: the authentication tag fails.
      legacyRow('u3', { access_token: sealStravaToken('u1', 'access_token', ACCESS, ACTIVE), refresh_token: sealStravaToken('u3', 'refresh_token', REFRESH, ACTIVE) }),
      legacyRow('u4', { access_token: 'has a space and is not a token' }),
    ]);
    const before = JSON.parse(JSON.stringify(tables));
    const rows = await listTokenRows();

    const outcomes = await Promise.all(rows.map((row) => rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false })));

    expect(outcomes).toEqual([
      { status: 'failed', code: 'unrecognised', column: 'access_token' },
      { status: 'failed', code: 'unknown_key_id', column: 'access_token' },
      { status: 'failed', code: 'auth_failed', column: 'access_token' },
      { status: 'failed', code: 'unrecognised', column: 'access_token' },
    ]);
    expect(tables).toEqual(before);
    expect(writes(db)).toEqual([]);
  });

  it('reports a failed write as write_failed, with nothing of the database error in the answer', async () => {
    use([legacyRow('u1')], (q) => (q.mutation ? { message: 'permission denied for table strava_tokens: Key (access_token)=(secret-looking)', code: '42501' } : null));
    const [row] = await listTokenRows();

    const outcome = await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false });

    expect(outcome).toEqual({ status: 'failed', code: 'write_failed' });
    expect(JSON.stringify(outcome)).not.toContain('secret-looking');
  });

  it('a row that changed to something readable after the write is superseded, not an error', async () => {
    let written = false;
    const { tables } = use([legacyRow('u1')], (q) => {
      if (q.mutation) {
        written = true;
        return null;
      }
      if (written) {
        // The refresh path replaced the tokens right after our write.
        Object.assign(tables.strava_tokens[0], {
          access_token: sealStravaToken('u1', 'access_token', legacyToken('new-access'), ACTIVE),
          refresh_token: sealStravaToken('u1', 'refresh_token', legacyToken('new-refresh'), ACTIVE),
        });
        written = false;
      }
      return null;
    });
    const [row] = await listTokenRows();

    expect(await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'superseded' });
  });

  it('a stored value that does not open after the write is verify_failed, never "written"', async () => {
    const tables: Record<string, Row[]> = { strava_tokens: [legacyRow('u1')] };
    const db = createFakeDb(tables, { primaryKeys: { strava_tokens: ['user_id'] } });
    // A database that damages what it is given: the last character of the refresh token is changed.
    const client = {
      ...db.client,
      from(table: string) {
        const builder = (db.client as any).from(table);
        const update = builder.update.bind(builder);
        builder.update = (values: Row) => update({ ...values, refresh_token: String(values.refresh_token).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) });
        return builder;
      },
    };
    vi.mocked(getSupabaseClient).mockReturnValue(client as never);
    const [row] = await listTokenRows();

    const outcome = await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false });

    expect(outcome).toEqual({ status: 'failed', code: 'verify_failed', column: 'refresh_token' });
  });

  it('a read-back that fails is verify_read_failed', async () => {
    let written = false;
    use([legacyRow('u1')], (q) => {
      if (q.mutation) {
        written = true;
        return null;
      }
      return written ? { message: 'timeout', code: '57014' } : null;
    });
    const [row] = await listTokenRows();

    expect(await rewriteTokenRow(row, 'encrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'failed', code: 'verify_read_failed' });
  });
});

describe('decrypting a row (the emergency exit)', () => {
  const sealedRow = (userId: string, tokenRing = ACTIVE): Row =>
    legacyRow(userId, {
      access_token: sealStravaToken(userId, 'access_token', legacyToken(`access-${userId}`), tokenRing),
      refresh_token: sealStravaToken(userId, 'refresh_token', legacyToken(`refresh-${userId}`), tokenRing),
    });

  it('writes the plaintext back with the same compare-and-swap, and checks it by reading it back', async () => {
    const { tables, db } = use([sealedRow('u1')]);
    const [row] = await listTokenRows();

    expect(await rewriteTokenRow(row, 'decrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'written' });

    expect(rowOf(tables, 'u1')).toMatchObject({ access_token: legacyToken('access-u1'), refresh_token: legacyToken('refresh-u1'), expires_at: 1_900_000_000 });
    expect(writes(db)[0].filters.filter((f) => f.op === 'eq').map((f) => f.column).sort()).toEqual(['access_token', 'refresh_token', 'user_id']);
    const [after] = await listTokenRows();
    expect([after.access.form, after.refresh.form]).toEqual(['plaintext', 'plaintext']);
  });

  it('a dry run writes nothing; a plaintext row has nothing to do; a changed row is a conflict', async () => {
    const { tables, db } = use([sealedRow('u1'), legacyRow('u2'), sealedRow('u3')]);
    const rows = await listTokenRows();
    Object.assign(rowOf(tables, 'u3'), { access_token: storedToken('u3', 'access_token', 'someone-else') });
    const before = JSON.parse(JSON.stringify(tables));

    expect(await rewriteTokenRow(rows[0], 'decrypt', ACTIVE, { dryRun: true })).toEqual({ status: 'ready' });
    expect(await rewriteTokenRow(rows[1], 'decrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'nothing_to_do' });
    expect(await rewriteTokenRow(rows[2], 'decrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'conflict' });
    expect(tables).toEqual(before);
    expect(writes(db).filter((q) => q.mutation === 'update')).toHaveLength(1); // only the conflicting attempt, which matched nothing
  });

  it('refuses to write a token that the reader would not take for plaintext afterwards', async () => {
    const { tables } = use([
      legacyRow('u1', { access_token: sealStravaToken('u1', 'access_token', 'has:colon-and-is-long-enough-123', ACTIVE), refresh_token: sealStravaToken('u1', 'refresh_token', REFRESH, ACTIVE) }),
    ]);
    const before = JSON.parse(JSON.stringify(tables));
    const [row] = await listTokenRows();

    expect(await rewriteTokenRow(row, 'decrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'failed', code: 'plaintext_shape', column: 'access_token' });
    expect(tables).toEqual(before);
  });

  it('refuses a value it cannot open, and a value that is neither', async () => {
    const lost = ring(`prod-0:${newKey()}`);
    const { tables } = use([sealedRow('u1', lost), legacyRow('u2', { refresh_token: 'enc:v1:broken' })]);
    const before = JSON.parse(JSON.stringify(tables));
    const rows = await listTokenRows();

    expect(await rewriteTokenRow(rows[0], 'decrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'failed', code: 'unknown_key_id', column: 'access_token' });
    expect(await rewriteTokenRow(rows[1], 'decrypt', ACTIVE, { dryRun: false })).toEqual({ status: 'failed', code: 'unrecognised', column: 'refresh_token' });
    expect(tables).toEqual(before);
  });
});
