/**
 * GET/PUT /api/groups/settings (ADR 012 beslut 6): gruppinställningar, en rad per (grupp, nyckel).
 * Registrets regler (resolveSettings, sanitizePatch, diffResolvedSettings) testas i packages/shared och rollregeln (groupRoleCan,
 * resolveActingGroupForWrite) i utils/groupAccess; här testas routens koppling: att gruppen kommer ur det aktiva medlemskapet, att
 * bara en admin skriver, att annan grupps rader aldrig nås, updated_by/updated_at, och sömmen onGroupSettingsChanged.
 * Registret är ett test-register med en gruppnyckel: inga produktionsnycklar finns i v0.8.0.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import express from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import type { SettingDefinition } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createApp } from '../../app.js';
import { createGroupSettingsRouter } from '../groupSettings.js';
import type { GroupSettingsChangedEvent } from '../../services/groupSettings.js';
import { createFakeDb, type FakeDbOptions, type RecordedQuery, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

const DIGEST: SettingDefinition = { key: 'group.digest', scope: 'group', type: 'boolean', default: false };
const PACE: SettingDefinition = { key: 'group.pace', scope: 'group', type: 'enum', default: 'easy', values: ['easy', 'hard'] };
const MINE: SettingDefinition = { key: 'notify.title_others', scope: 'user', type: 'boolean', default: true };
const REGISTRY: readonly SettingDefinition[] = [DIGEST, PACE, MINE];

const ADMIN = 'u-admin';
const MEMBER = 'u-member';
const OUTSIDER = 'u-outsider';
const OTHER_ADMIN = 'u-admin-b';
const G1 = 'g1';
const G2 = 'g2';
const T0 = '2026-01-01T00:00:00.000Z';

const member = (user_id: string, group_id: string, role: 'admin' | 'member', left_at: string | null = null): Row => ({
  id: `m-${user_id}`, user_id, group_id, role, left_at, starts_on: null, joined_at: T0,
});
const stored = (group_id: string, key: string, value: unknown, updated_by: string | null = ADMIN): Row => ({
  group_id, key, value, updated_by, updated_at: T0,
});
const MEMBERSHIPS = [member(ADMIN, G1, 'admin'), member(MEMBER, G1, 'member'), member(OTHER_ADMIN, G2, 'admin')];

let server: TestServer;
let appServer: TestServer;
const changes: GroupSettingsChangedEvent[] = [];
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/groups/settings', createGroupSettingsRouter(REGISTRY, { onGroupSettingsChanged: (event) => { changes.push(event); } }));
  server = await startServer(app);
  appServer = await startServer(createApp());
});
afterAll(async () => { await server.close(); await appServer.close(); });
beforeEach(() => { changes.length = 0; });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

/** Fördröjer en fråga (fejken är synkron): ger en kapplöpning mellan samtidiga anrop utan att ändra vad som skrivs. */
type Delay = (query: RecordedQuery) => Promise<void> | undefined;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Fördröjning av alla frågor mot group_settings, så att två samtidiga PUT hinner läsa innan någon skrivit. */
const slowSettings: Delay = (query) => (query.table === 'group_settings' ? sleep(10) : undefined);

function use(rows: Row[] = [], memberships: Row[] = MEMBERSHIPS, options: FakeDbOptions = {}, delay?: Delay) {
  const tables: Record<string, Row[]> = { group_members: memberships, group_settings: rows };
  const db = createFakeDb(tables, { primaryKeys: { group_settings: ['group_id', 'key'] }, ...options });
  // fakeDb faller tillbaka på primärnyckeln när onConflict saknas, så upsertens argument spelas in här.
  const upserts: Array<{ rows: Row | Row[]; options: { onConflict?: string } | undefined }> = [];
  const client = {
    ...db.client,
    from: (table: string) => {
      const builder = db.client.from(table);
      const query = db.queries[db.queries.length - 1];
      if (delay) {
        const run = builder.then.bind(builder);
        builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          const wait = delay(query);
          return wait ? wait.then(() => run(resolve, reject)) : run(resolve, reject);
        };
      }
      const upsert = builder.upsert.bind(builder);
      builder.upsert = (values: Row | Row[], opts?: { onConflict?: string }) => {
        upserts.push({ rows: values, options: opts });
        return upsert(values, opts);
      };
      return builder;
    },
  };
  vi.mocked(getSupabaseClient).mockReturnValue(client as never);
  return { db, tables, upserts };
}

// Token-gruppen är medvetet inte medlemskapets: gruppen får aldrig komma ur token.
const token = (user_id: string, group_id: string | null = 'jwt-claims-another-group') => mintToken({ user_id, group_id });
const get = (user_id: string, group_id?: string | null) => server.request('GET', '/api/groups/settings', { token: token(user_id, group_id) });
const put = (user_id: string, body: unknown, group_id?: string | null) =>
  server.request('PUT', '/api/groups/settings', { token: token(user_id, group_id), body });
const mutations = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.mutation);
const settingsReads = (db: ReturnType<typeof use>['db']) => db.queries.filter((q) => q.table === 'group_settings' && !q.mutation);

describe('GET /api/groups/settings', () => {
  it('GET without a token gives 401 and touches nothing', async () => {
    const { db } = use();
    const res = await server.request('GET', '/api/groups/settings');
    expect(res.status).toBe(401);
    expect(db.queries).toEqual([]);
  });

  it('GET as a member returns the values of the group', async () => {
    use([stored(G1, DIGEST.key, true), stored(G1, PACE.key, 'hard')]);
    const res = await get(MEMBER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { values: { [DIGEST.key]: true, [PACE.key]: 'hard' } },
      meta: { customised: [DIGEST.key, PACE.key], can_edit: false },
    });
  });

  it('GET gives the defaults of the registry when the group has stored nothing', async () => {
    use();
    const res = await get(MEMBER);
    expect(res.body.data.values).toEqual({ [DIGEST.key]: false, [PACE.key]: 'easy' });
    expect(res.body.meta).toEqual({ customised: [], can_edit: false });
  });

  it('GET tells an admin that the group is editable', async () => {
    use();
    const res = await get(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.meta.can_edit).toBe(true);
  });

  it('GET never shows a user-scope key', async () => {
    use([stored(G1, MINE.key, false)]);
    const res = await get(MEMBER);
    expect(Object.keys(res.body.data.values)).not.toContain(MINE.key);
    expect(res.body.meta.customised).not.toContain(MINE.key);
  });

  it("another group's rows are never read", async () => {
    const { db } = use([stored(G1, DIGEST.key, false), stored(G2, DIGEST.key, true), stored(G2, PACE.key, 'hard')]);
    const res = await get(MEMBER);
    expect(res.body.data.values).toEqual({ [DIGEST.key]: false, [PACE.key]: 'easy' });
    expect(res.body.meta.customised).toEqual([DIGEST.key]);
    const reads = settingsReads(db);
    expect(reads).toHaveLength(1);
    expect(reads[0].filters).toContainEqual({ op: 'eq', column: 'group_id', value: G1 });
  });

  it('GET reads the group from the active membership, not from the token', async () => {
    use([stored(G1, DIGEST.key, true), stored(G2, DIGEST.key, false)]);
    const staleClaim = await get(MEMBER, G2);
    const noClaim = await get(MEMBER, null);
    expect(staleClaim.body.data.values[DIGEST.key]).toBe(true);
    expect(noClaim.body.data.values[DIGEST.key]).toBe(true);
  });

  it('GET without an active membership gives empty values and reads no settings', async () => {
    const { db } = use([stored(G1, DIGEST.key, true)]);
    for (const user of [OUTSIDER, 'u-left']) {
      const res = await get(user, G1);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { values: {} }, meta: { customised: [], can_edit: false } });
    }
    expect(settingsReads(db)).toEqual([]);
  });

  it('GET treats a left membership as no membership', async () => {
    const { db } = use([stored(G1, DIGEST.key, true)], [member('u-left', G1, 'admin', '2026-09-01T00:00:00Z')]);
    const res = await get('u-left');
    expect(res.body.data.values).toEqual({});
    expect(res.body.meta.can_edit).toBe(false);
    expect(settingsReads(db)).toEqual([]);
  });

  it('GET falls back on the default for a stored value of the wrong type and warns', async () => {
    use([stored(G1, DIGEST.key, 'yes'), stored(G1, PACE.key, 'extreme')]);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const res = await get(MEMBER);
    expect(res.body.data.values).toEqual({ [DIGEST.key]: false, [PACE.key]: 'easy' });
    expect(res.body.meta.customised).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('GET gives 500 without leaking when the membership cannot be read', async () => {
    use([], MEMBERSHIPS, { errors: { group_members: { message: 'secret-membership-text u-member' } } });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await get(MEMBER);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-membership-text');
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-membership-text');
  });

  it('GET gives 500 without leaking when the settings cannot be read', async () => {
    use([], MEMBERSHIPS, { errors: { group_settings: { message: 'relation "group_settings" secret-read-text' } } });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await get(MEMBER);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-read-text');
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-read-text');
  });
});

describe('PUT /api/groups/settings', () => {
  it('PUT without a token gives 401 and writes nothing', async () => {
    const { db } = use();
    const res = await server.request('PUT', '/api/groups/settings', { body: { values: { [DIGEST.key]: true } } });
    expect(res.status).toBe(401);
    expect(db.queries).toEqual([]);
  });

  it('PUT as an admin saves with updated_by and updated_at, and answers with the new state', async () => {
    const { tables } = use();
    const res = await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { values: { [DIGEST.key]: true, [PACE.key]: 'easy' } },
      meta: { customised: [DIGEST.key], can_edit: true },
    });
    expect(tables.group_settings).toEqual([
      { group_id: G1, key: DIGEST.key, value: true, updated_by: ADMIN, updated_at: expect.any(String) },
    ]);
    expect(Number.isNaN(Date.parse(tables.group_settings[0].updated_at))).toBe(false);
    expect((await get(MEMBER)).body.data.values[DIGEST.key]).toBe(true);
  });

  it('PUT upserts all set keys at once on group_id,key and refreshes updated_at and updated_by of an existing row', async () => {
    const { tables, upserts } = use([stored(G1, DIGEST.key, false, 'u-former-admin')]);
    const res = await put(ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: 'hard' } });
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].options).toEqual({ onConflict: 'group_id,key' });
    expect(tables.group_settings).toHaveLength(2);
    const digest = tables.group_settings.find((r) => r.key === DIGEST.key)!;
    expect(digest).toMatchObject({ group_id: G1, value: true, updated_by: ADMIN });
    expect(digest.updated_at).not.toBe(T0);
  });

  it('PUT with null resets a key by deleting the row of the own group only', async () => {
    const { db, tables } = use([stored(G1, DIGEST.key, true), stored(G1, PACE.key, 'hard'), stored(G2, DIGEST.key, true)]);
    const res = await put(ADMIN, { values: { [DIGEST.key]: null } });
    expect(res.status).toBe(200);
    expect(res.body.data.values[DIGEST.key]).toBe(false);
    expect(res.body.meta.customised).toEqual([PACE.key]);
    expect(tables.group_settings.map((r) => [r.group_id, r.key])).toEqual([[G1, PACE.key], [G2, DIGEST.key]]);
    const deletes = mutations(db).filter((q) => q.mutation === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'group_id', value: G1 },
      { op: 'in', column: 'key', value: [DIGEST.key] },
    ]));
  });

  it('PUT as a member who is not an admin is denied and writes nothing', async () => {
    const { db } = use();
    const res = await put(MEMBER, { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(mutations(db)).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('PUT as a non-member is denied with the same answer as for a member, and writes nothing', async () => {
    const { db } = use();
    const asMember = await put(MEMBER, { values: { [DIGEST.key]: true } });
    const asOutsider = await put(OUTSIDER, { values: { [DIGEST.key]: true } });
    expect(asOutsider.status).toBe(403);
    expect(asOutsider.body).toEqual(asMember.body);
    expect(mutations(db)).toEqual([]);
  });

  it('PUT is denied for an admin who has left the group', async () => {
    const { db } = use([], [member('u-left', G1, 'admin', '2026-09-01T00:00:00Z')]);
    const res = await put('u-left', { values: { [DIGEST.key]: true } }, G1);
    expect(res.status).toBe(403);
    expect(mutations(db)).toEqual([]);
  });

  it('PUT denies before it validates, so a non-admin learns nothing about the keys', async () => {
    use();
    const res = await put(MEMBER, { values: { 'no.such.key': true } });
    expect(res.status).toBe(403);
  });

  it('PUT writes the group of the membership, never a group named by the token or the body', async () => {
    const { tables } = use([stored(G2, DIGEST.key, false, OTHER_ADMIN)]);
    const res = await server.request('PUT', '/api/groups/settings?group_id=g2', {
      token: token(ADMIN, G2),
      body: { group_id: G2, groupId: G2, values: { [DIGEST.key]: true } },
      headers: { 'x-group-id': G2 },
    });
    expect(res.status).toBe(200);
    expect(tables.group_settings).toContainEqual(stored(G2, DIGEST.key, false, OTHER_ADMIN));
    expect(tables.group_settings).toContainEqual(expect.objectContaining({ group_id: G1, key: DIGEST.key, value: true, updated_by: ADMIN }));
    expect(tables.group_settings).toHaveLength(2);
  });

  it("an admin of another group never changes this group's rows", async () => {
    const { tables } = use([stored(G1, DIGEST.key, false), stored(G1, PACE.key, 'hard')]);
    const res = await put(OTHER_ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: null } }, G1);
    expect(res.status).toBe(200);
    expect(tables.group_settings.filter((r) => r.group_id === G1)).toEqual([stored(G1, DIGEST.key, false), stored(G1, PACE.key, 'hard')]);
    expect(tables.group_settings.filter((r) => r.group_id === G2).map((r) => r.key)).toEqual([DIGEST.key]);
  });

  it('PUT with a user-scope key gives 400 and writes nothing, not even the valid keys beside it', async () => {
    const { db } = use();
    const res = await put(ADMIN, { values: { [DIGEST.key]: true, [MINE.key]: false } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringContaining(MINE.key) });
    expect(mutations(db)).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('PUT with an unknown key, a wrong type, a bad enum value or a malformed body gives 400', async () => {
    const { db } = use();
    for (const body of [
      { values: { 'no.such.key': true } },
      { values: { [DIGEST.key]: 'yes' } },
      { values: { [PACE.key]: 'extreme' } },
      { values: [DIGEST.key] },
      {},
    ]) {
      const res = await put(ADMIN, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
    expect(mutations(db)).toEqual([]);
  });

  it('PUT gives 500 without writing when the role of the membership is not recognised', async () => {
    const { db } = use([], [{ ...member('u-odd', G1, 'admin'), role: 'owner' }]);
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put('u-odd', { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(500);
    expect(mutations(db)).toEqual([]);
  });

  it('PUT gives 500 without writing or leaking when the membership read fails', async () => {
    const { db } = use([], MEMBERSHIPS, { errors: { group_members: { message: 'secret-member-text' } } });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-member-text');
    expect(mutations(db)).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('PUT gives 500 without leaking and without announcing when the upsert fails', async () => {
    const secret = 'duplicate key value violates "group_settings_pkey" secret-detail-42';
    const { tables } = use([], MEMBERSHIPS, { failWhen: (q) => (q.mutation === 'upsert' ? { message: secret, code: '23505' } : null) });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-detail-42');
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-detail-42');
    expect(JSON.stringify(error.mock.calls)).toContain('23505');
    expect(tables.group_settings).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('PUT deletes nothing when the upsert of the same request fails', async () => {
    const { tables } = use([stored(G1, PACE.key, 'hard')], MEMBERSHIPS, { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'boom' } : null) });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: null } });
    expect(res.status).toBe(500);
    expect(tables.group_settings).toEqual([stored(G1, PACE.key, 'hard')]);
  });

  it('PUT logs user_id, group_id and the keys of a successful write, and no values', async () => {
    use();
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    await put(ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: null } });
    const line = info.mock.calls.find((call) => String(call[0]).includes('group settings saved'));
    expect(line).toBeDefined();
    expect(line![1]).toEqual({ user_id: ADMIN, group_id: G1, keys: [DIGEST.key, PACE.key] });
  });
});

describe('the seam onGroupSettingsChanged', () => {
  it('is called once with the effective changes when a write changes the resolved values', async () => {
    use([stored(G1, PACE.key, 'hard')]);
    const res = await put(ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: null } });
    expect(res.status).toBe(200);
    expect(changes).toEqual([
      {
        groupId: G1,
        actorId: ADMIN,
        changes: [
          { key: DIGEST.key, from: false, to: true },
          { key: PACE.key, from: 'hard', to: 'easy' },
        ],
        updatedAt: expect.any(String),
      },
    ]);
  });

  it('carries the timestamp that the rows were written with, for the dedupe key', async () => {
    const { tables } = use();
    await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(changes[0].updatedAt).toBe(tables.group_settings[0].updated_at);
  });

  it('is called only for the keys that really changed when a write mixes changed and unchanged keys', async () => {
    use([stored(G1, PACE.key, 'hard')]);
    await put(ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: 'hard' } });
    expect(changes).toHaveLength(1);
    expect(changes[0].changes).toEqual([{ key: DIGEST.key, from: false, to: true }]);
  });

  it('is never called for a write that changes nothing', async () => {
    const { tables } = use([stored(G1, PACE.key, 'hard')]);
    // Samma värde som lagrat, ett uttryckligt värde lika med defaulten, en återställning av en nyckel som redan är default och en tom patch.
    for (const values of [{ [PACE.key]: 'hard' }, { [DIGEST.key]: false }, { [DIGEST.key]: null }, {}]) {
      const res = await put(ADMIN, { values });
      expect(res.status, JSON.stringify(values)).toBe(200);
    }
    expect(changes).toEqual([]);
    expect(tables.group_settings.map((r) => r.key)).toEqual([PACE.key]);
  });

  it('keeps an explicit value equal to the default as customised without announcing it', async () => {
    const { tables } = use();
    const res = await put(ADMIN, { values: { [DIGEST.key]: false } });
    expect(res.body.meta.customised).toEqual([DIGEST.key]);
    expect(tables.group_settings).toEqual([expect.objectContaining({ group_id: G1, key: DIGEST.key, value: false })]);
    expect(changes).toEqual([]);
  });

  it('is called once per effective change: a second identical write is silent', async () => {
    use();
    await put(ADMIN, { values: { [DIGEST.key]: true } });
    await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(changes).toHaveLength(1);
    await put(ADMIN, { values: { [DIGEST.key]: false } });
    expect(changes).toHaveLength(2);
    expect(changes[1].changes).toEqual([{ key: DIGEST.key, from: true, to: false }]);
  });

  it('is not called for a denied or an invalid request', async () => {
    use();
    await put(MEMBER, { values: { [DIGEST.key]: true } });
    await put(OUTSIDER, { values: { [DIGEST.key]: true } });
    await put(ADMIN, { values: { [MINE.key]: false } });
    expect(changes).toEqual([]);
  });

  it('does not fail the write when the seam throws, and logs only the error code', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/groups/settings', createGroupSettingsRouter(REGISTRY, { onGroupSettingsChanged: () => { throw Object.assign(new Error('secret-seam-text'), { code: 'SEAM1' }); } }));
    const local = await startServer(app);
    try {
      const { tables } = use();
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const res = await local.request('PUT', '/api/groups/settings', { token: token(ADMIN), body: { values: { [DIGEST.key]: true } } });
      expect(res.status).toBe(200);
      expect(tables.group_settings).toHaveLength(1);
      expect(JSON.stringify(error.mock.calls)).toContain('SEAM1');
      expect(JSON.stringify(error.mock.calls)).not.toContain('secret-seam-text');
    } finally {
      await local.close();
    }
  });

  it('still announces the change, derived from the request, when the read after the write fails (the answer is then 500)', async () => {
    let reads = 0;
    const { tables } = use([], MEMBERSHIPS, {
      failWhen: (q) => {
        if (q.table !== 'group_settings' || q.mutation) return null;
        reads += 1;
        return reads >= 2 ? { message: 'secret-reread' } : null;
      },
    });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-reread');
    expect(tables.group_settings).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].changes).toEqual([{ key: DIGEST.key, from: false, to: true }]);
  });

  it('defaults to a log line that names the group, the actor and the keys, and does nothing else', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/groups/settings', createGroupSettingsRouter(REGISTRY));
    const local = await startServer(app);
    try {
      const { tables } = use();
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const res = await local.request('PUT', '/api/groups/settings', { token: token(ADMIN), body: { values: { [DIGEST.key]: true } } });
      expect(res.status).toBe(200);
      const line = info.mock.calls.find((call) => String(call[0]).includes('group settings changed'));
      expect(line?.[1]).toEqual({ group_id: G1, actor_id: ADMIN, keys: [DIGEST.key] });
      expect(Object.keys(tables).sort()).toEqual(['group_members', 'group_settings']);
    } finally {
      await local.close();
    }
  });
});

describe('concurrent PUT requests', () => {
  it('two identical writes at the same time announce the change exactly once', async () => {
    const { tables } = use([], MEMBERSHIPS, {}, slowSettings);
    const [first, second] = await Promise.all([
      put(ADMIN, { values: { [DIGEST.key]: true } }),
      put(ADMIN, { values: { [DIGEST.key]: true } }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(changes).toHaveLength(1);
    expect(changes[0].changes).toEqual([{ key: DIGEST.key, from: false, to: true }]);
    expect(tables.group_settings).toHaveLength(1);
  });

  it('writes to different keys at the same time are each announced with only their own change', async () => {
    use([], MEMBERSHIPS, {}, slowSettings);
    const [first, second] = await Promise.all([
      put(ADMIN, { values: { [DIGEST.key]: true } }),
      put(ADMIN, { values: { [PACE.key]: 'hard' } }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(changes).toHaveLength(2);
    expect(changes.map((event) => event.changes).sort((a, b) => a[0].key.localeCompare(b[0].key))).toEqual([
      [{ key: DIGEST.key, from: false, to: true }],
      [{ key: PACE.key, from: 'easy', to: 'hard' }],
    ]);
    // Svaret till den som skrev sist visar båda, eftersom det visar nuläget.
    expect([first, second].some((res) => res.body.data.values[DIGEST.key] === true && res.body.data.values[PACE.key] === 'hard')).toBe(true);
  });

  it('a second write on the same group does not start reading until the first has finished', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let blocked = false;
    const { db } = use([], MEMBERSHIPS, {}, (query) => {
      if (query.table !== 'group_settings' || blocked) return undefined;
      blocked = true;
      return held;
    });
    const first = put(ADMIN, { values: { [DIGEST.key]: true } });
    await sleep(20);
    const second = put(ADMIN, { values: { [PACE.key]: 'hard' } });
    await sleep(40);
    expect(db.queries.filter((q) => q.table === 'group_settings')).toHaveLength(1);
    release();
    expect([(await first).status, (await second).status]).toEqual([200, 200]);
    expect(db.queries.filter((q) => q.table === 'group_settings').length).toBeGreaterThan(1);
  });

  it('writes on different groups are not serialised against each other', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { tables } = use([], MEMBERSHIPS, {}, (query) =>
      query.table === 'group_settings' && query.filters.some((f) => f.column === 'group_id' && f.value === G1) ? held : undefined);
    const stuck = put(ADMIN, { values: { [DIGEST.key]: true } });
    await sleep(20);
    const other = await put(OTHER_ADMIN, { values: { [DIGEST.key]: true } });
    expect(other.status).toBe(200);
    expect(tables.group_settings.map((r) => r.group_id)).toEqual([G2]);
    release();
    expect((await stuck).status).toBe(200);
    expect(changes.map((event) => event.groupId).sort()).toEqual([G1, G2]);
  });

  it('releases the group when a write fails, so the next write is not stuck behind it', async () => {
    let upserts = 0;
    const { tables } = use([], MEMBERSHIPS, { failWhen: (q) => (q.mutation === 'upsert' && ++upserts === 1 ? { message: 'boom', code: 'XX000' } : null) }, slowSettings);
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const [failing, following] = await Promise.all([
      put(ADMIN, { values: { [DIGEST.key]: true } }),
      put(ADMIN, { values: { [PACE.key]: 'hard' } }),
    ]);
    expect(failing.status).toBe(500);
    expect(following.status).toBe(200);
    expect(tables.group_settings.map((r) => r.key)).toEqual([PACE.key]);
    expect(changes.map((event) => event.changes)).toEqual([[{ key: PACE.key, from: 'easy', to: 'hard' }]]);
    expect((await put(ADMIN, { values: { [DIGEST.key]: true } })).status).toBe(200);
  });

  it('releases the group when the first read fails', async () => {
    let reads = 0;
    use([], MEMBERSHIPS, { failWhen: (q) => (q.table === 'group_settings' && !q.mutation && ++reads === 1 ? { message: 'boom' } : null) }, slowSettings);
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const [failing, following] = await Promise.all([
      put(ADMIN, { values: { [DIGEST.key]: true } }),
      put(ADMIN, { values: { [DIGEST.key]: true } }),
    ]);
    expect([failing.status, following.status]).toEqual([500, 200]);
  });
});

describe('the seam when parts of a write fail', () => {
  it('announces only the part that was saved when the delete fails and the read after it fails too', async () => {
    let reads = 0;
    const { tables } = use([stored(G1, PACE.key, 'hard')], MEMBERSHIPS, {
      failWhen: (q) => {
        if (q.mutation === 'delete') return { message: 'secret-delete', code: 'XX001' };
        if (q.table === 'group_settings' && !q.mutation && ++reads >= 2) return { message: 'secret-reread' };
        return null;
      },
    });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [DIGEST.key]: true, [PACE.key]: null } });
    expect(res.status).toBe(500);
    expect(tables.group_settings.map((r) => r.key).sort()).toEqual([DIGEST.key, PACE.key]);
    expect(changes).toHaveLength(1);
    expect(changes[0].changes).toEqual([{ key: DIGEST.key, from: false, to: true }]);
  });

  it('announces a reset derived from the request when the read after the write fails', async () => {
    let reads = 0;
    const { tables } = use([stored(G1, PACE.key, 'hard')], MEMBERSHIPS, {
      failWhen: (q) => (q.table === 'group_settings' && !q.mutation && ++reads >= 2 ? { message: 'secret-reread' } : null),
    });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [PACE.key]: null } });
    expect(res.status).toBe(500);
    expect(tables.group_settings).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0].changes).toEqual([{ key: PACE.key, from: 'hard', to: 'easy' }]);
  });

  it('announces nothing when the upsert fails and the read after it fails too', async () => {
    let reads = 0;
    use([], MEMBERSHIPS, {
      failWhen: (q) => {
        if (q.mutation === 'upsert') return { message: 'boom' };
        return q.table === 'group_settings' && !q.mutation && ++reads >= 2 ? { message: 'boom' } : null;
      },
    });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(res.status).toBe(500);
    expect(changes).toEqual([]);
  });

  it('logs "group settings saved" only when the write succeeded', async () => {
    use([], MEMBERSHIPS, { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'boom' } : null) });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    await put(ADMIN, { values: { [DIGEST.key]: true } });
    expect(info.mock.calls.some((call) => String(call[0]).includes('group settings saved'))).toBe(false);
  });
});

describe('a seam that never answers', () => {
  it('does not hang the PUT or hold the group: the answer comes after the timeout and the next write goes through', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/groups/settings', createGroupSettingsRouter(REGISTRY, { onGroupSettingsChanged: () => new Promise<void>(() => {}), announceTimeoutMs: 40 }));
    const local = await startServer(app);
    try {
      const { tables } = use();
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const started = Date.now();
      const first = await local.request('PUT', '/api/groups/settings', { token: token(ADMIN), body: { values: { [DIGEST.key]: true } } });
      expect(first.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(JSON.stringify(error.mock.calls)).toContain('seam_timeout');
      const second = await local.request('PUT', '/api/groups/settings', { token: token(ADMIN), body: { values: { [PACE.key]: 'hard' } } });
      expect(second.status).toBe(200);
      expect(tables.group_settings.map((r) => r.key).sort()).toEqual([DIGEST.key, PACE.key]);
    } finally {
      await local.close();
    }
  });
});

describe('PUT /api/groups/settings rate limit', () => {
  it('stops PUT with 429 after 60 requests per minute and leaves GET alone', async () => {
    use();
    const app = express();
    app.use(express.json());
    app.use('/api/groups/settings', createGroupSettingsRouter(REGISTRY));
    const limited = await startServer(app);
    try {
      const attempts: number[] = [];
      for (let i = 0; i < 61; i++) attempts.push((await limited.request('PUT', '/api/groups/settings', { token: token(ADMIN), body: { values: {} } })).status);
      expect(attempts.slice(0, 60).every((s) => s === 200)).toBe(true);
      expect(attempts[60]).toBe(429);
      expect((await limited.request('GET', '/api/groups/settings', { token: token(ADMIN) })).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('createApp mounts the group settings router', () => {
  it('serves GET /api/groups/settings behind authentication, with the production registry', async () => {
    const unauthenticated = await appServer.request('GET', '/api/groups/settings');
    expect(unauthenticated.status).toBe(401);

    use();
    const res = await appServer.request('GET', '/api/groups/settings', { token: token(ADMIN) });
    expect(res.status).toBe(200);
    // Inga produktionsnycklar finns i v0.8.0: tomt register, men admin-rollen läses ur medlemskapet.
    expect(res.body).toEqual({ success: true, data: { values: {} }, meta: { customised: [], can_edit: true } });
  });

  it('answers PUT /api/groups/settings from the router: every key is unknown while no group key is registered', async () => {
    const { db } = use();
    const denied = await appServer.request('PUT', '/api/groups/settings', { token: token(MEMBER), body: { values: {} } });
    expect(denied.status).toBe(403);
    const unknown = await appServer.request('PUT', '/api/groups/settings', { token: token(ADMIN), body: { values: { 'xp.ruleset': 'x' } } });
    expect(unknown.status).toBe(400);
    expect(mutations(db)).toEqual([]);
  });
});
