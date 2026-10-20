/**
 * readUserGroupId (services/userGroupId.ts): den enda läsningen av users.group_id utanför en rutts egen fråga. Ett läsfel är aldrig
 * "ingen grupp" som öppnar data: onError avgör per anropare (kasta, eller logga och avstå), och återvänder den är svaret null,
 * aldrig ett gruppid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { readUserGroupId } from '../userGroupId.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function setup(users: Row[], options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb({ users }, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const READ_FAILS = { failWhen: (q: { table: string }) => (q.table === 'users' ? { message: 'row value secret-4711 leaked', code: '57014' } : null) };

beforeEach(() => { vi.clearAllMocks(); });

describe('readUserGroupId', () => {
  it('returns the group id of the user and never calls onError', async () => {
    setup([{ id: 'u1', group_id: 'g1' }, { id: 'u2', group_id: 'g2' }]);
    const onError = vi.fn();

    await expect(readUserGroupId('u1', { onError })).resolves.toBe('g1');

    expect(onError).not.toHaveBeenCalled();
  });

  it('returns null without calling onError for a user who has no group', async () => {
    setup([{ id: 'u1', group_id: null }]);
    const onError = vi.fn();

    await expect(readUserGroupId('u1', { onError })).resolves.toBeNull();

    expect(onError).not.toHaveBeenCalled();
  });

  it('reads only the group_id column of the one user', async () => {
    const db = setup([{ id: 'u1', group_id: 'g1' }]);

    await readUserGroupId('u1', { onError: vi.fn() });

    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toMatchObject({ table: 'users', select: 'group_id' });
    expect(db.queries[0].filters).toContainEqual({ op: 'eq', column: 'id', value: 'u1' });
  });

  it('hands a read failure to onError with the database code and a fixed message, never the database text', async () => {
    setup([{ id: 'u1', group_id: 'g1' }], READ_FAILS);
    const onError = vi.fn();

    await readUserGroupId('u1', { onError });

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as Error & { code: string };
    expect(error.code).toBe('57014');
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain('secret-4711');
  });

  it('returns null when onError returns, even though the user has a group: a failed read never yields a group id', async () => {
    setup([{ id: 'u1', group_id: 'g1' }], READ_FAILS);

    await expect(readUserGroupId('u1', { onError: () => undefined })).resolves.toBeNull();
  });

  it('returns null even when onError (against its type) returns a group id', async () => {
    setup([{ id: 'u1', group_id: 'g1' }], READ_FAILS);
    const lying = (() => 'g-other') as unknown as () => void;

    await expect(readUserGroupId('u1', { onError: lying })).resolves.toBeNull();
  });

  it('lets the exception of onError through, so a caller can abort', async () => {
    setup([{ id: 'u1', group_id: 'g1' }], READ_FAILS);

    await expect(readUserGroupId('u1', { onError: (e) => { throw e; } })).rejects.toMatchObject({ code: '57014' });
  });

  it('treats a user who does not exist as a read failure with the code user_not_found', async () => {
    setup([{ id: 'u2', group_id: 'g2' }]);
    const onError = vi.fn();

    await expect(readUserGroupId('ghost', { onError })).resolves.toBeNull();

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as { code: string }).code).toBe('user_not_found');
  });

  it('never returns another user\'s group when the filter finds nobody', async () => {
    setup([{ id: 'u2', group_id: 'g2' }]);

    await expect(readUserGroupId('ghost', { onError: () => undefined })).resolves.toBeNull();
  });
});
