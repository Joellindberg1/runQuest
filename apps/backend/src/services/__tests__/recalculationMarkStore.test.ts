/**
 * The real mark store (services/recalculationMarks/supabaseStore.ts) against createFakeDb: which rpc and table it calls with which
 * arguments, what it makes of the answers, and that a database error never carries more than its code. The SQL behind the rpc names
 * (least, version, clear only on the same version) is migration 057 and is proved against PGlite; the same rules are mirrored by
 * test-utils/inMemoryRecalculationMarks.ts, which the last test here holds to the contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createRecalculationMarkStore } from '../recalculationMarks/supabaseStore.js';
import { createInMemoryMarkStore } from '../../test-utils/inMemoryRecalculationMarks.js';

type RpcAnswer = { data?: unknown; error?: { message: string; code?: string } | null };

function setup(rpc: Record<string, (args: any) => RpcAnswer> = {}, marks: Row[] = []) {
  const tables: Record<string, Row[]> = { recalculation_marks: marks };
  const db = createFakeDb(tables, { rpc });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { store: createRecalculationMarkStore(), tables, db };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recalculation mark store', () => {
  it('mark calls mark_recalculation with the user and the date and returns the version', async () => {
    const seen: unknown[] = [];
    const { store } = setup({
      mark_recalculation: (args) => {
        seen.push(args);
        return { data: 3 };
      },
    });

    await expect(store.mark('user-1', '2026-10-13')).resolves.toBe(3);
    expect(seen).toEqual([{ p_user_id: 'user-1', p_from_date: '2026-10-13' }]);
  });

  it('mark throws with the database code only, and never takes a missing answer for a version', async () => {
    const failing = setup({ mark_recalculation: () => ({ error: { message: 'insert violates user abc@example.com', code: '23503' } }) });
    const error = await failing.store.mark('user-1', '2026-10-13').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('23503');
    expect(error.message).not.toContain('abc@example.com');

    // An rpc that does not exist answers without data and without error in the fake; a real one that returns nothing is as wrong.
    for (const data of [null, undefined, 'x', 0, -1, 1.5, Number.NaN]) {
      const { store } = setup({ mark_recalculation: () => ({ data }) });
      await expect(store.mark('user-1', '2026-10-13'), String(data)).rejects.toMatchObject({ code: 'invalid_mark_version' });
    }
  });

  it('mark accepts the version as a string, which is how PostgREST writes a bigint that does not fit a number', async () => {
    const { store } = setup({ mark_recalculation: () => ({ data: '7' }) });
    await expect(store.mark('user-1', '2026-10-13')).resolves.toBe(7);
  });

  it('clear calls clear_recalculation_mark with the version and returns whether a row went', async () => {
    const seen: unknown[] = [];
    let answer = true;
    const { store } = setup({
      clear_recalculation_mark: (args) => {
        seen.push(args);
        return { data: answer };
      },
    });

    await expect(store.clear('user-1', 4)).resolves.toBe(true);
    answer = false;
    await expect(store.clear('user-1', 4)).resolves.toBe(false);
    expect(seen).toEqual([
      { p_user_id: 'user-1', p_version: 4 },
      { p_user_id: 'user-1', p_version: 4 },
    ]);
  });

  it('clear throws with the code when the database fails, and treats an answer that is not true as "nothing cleared"', async () => {
    const failing = setup({ clear_recalculation_mark: () => ({ error: { message: 'x', code: '57P01' } }) });
    await expect(failing.store.clear('user-1', 1)).rejects.toMatchObject({ code: '57P01' });

    const odd = setup({ clear_recalculation_mark: () => ({ data: null }) });
    await expect(odd.store.clear('user-1', 1)).resolves.toBe(false);
  });

  it('listPending reads the oldest marks first, at most the limit', async () => {
    const { store } = setup({}, [
      { user_id: 'user-2', from_date: '2026-10-14', version: 1, marked_at: '2026-10-18T02:00:00Z' },
      { user_id: 'user-1', from_date: '2026-10-13', version: 2, marked_at: '2026-10-18T01:00:00Z' },
      { user_id: 'user-3', from_date: '2026-10-15', version: 1, marked_at: '2026-10-18T03:00:00Z' },
    ]);

    await expect(store.listPending(2)).resolves.toEqual([
      { userId: 'user-1', fromDate: '2026-10-13', version: 2 },
      { userId: 'user-2', fromDate: '2026-10-14', version: 1 },
    ]);
  });

  it('listPending and read throw with the code only when the table cannot be read', async () => {
    const tables: Record<string, Row[]> = { recalculation_marks: [] };
    const db = createFakeDb(tables, { failWhen: (query) => (query.table === 'recalculation_marks' ? { message: 'secret row value', code: '42P01' } : null) });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const store = createRecalculationMarkStore();

    const listError = await store.listPending(5).catch((e) => e);
    expect(listError.code).toBe('42P01');
    expect(listError.message).not.toContain('secret');
    await expect(store.read('user-1')).rejects.toMatchObject({ code: '42P01' });
  });

  it('read gives the user\'s mark, or null when there is none', async () => {
    const { store } = setup({}, [{ user_id: 'user-1', from_date: '2026-10-13', version: 5, marked_at: '2026-10-18T01:00:00Z' }]);

    await expect(store.read('user-1')).resolves.toEqual({ userId: 'user-1', fromDate: '2026-10-13', version: 5 });
    await expect(store.read('user-2')).resolves.toBeNull();
  });

  it('the in-memory store used by the other tests follows the same contract: least date, version + 1, clear only on the same version', async () => {
    const memory = createInMemoryMarkStore();

    expect(await memory.mark('user-1', '2026-10-13')).toBe(1);
    expect(await memory.mark('user-1', '2026-10-20')).toBe(2); // a later date does not move the mark later
    expect(await memory.read('user-1')).toEqual({ userId: 'user-1', fromDate: '2026-10-13', version: 2 });
    expect(await memory.mark('user-1', '2026-10-05')).toBe(3);
    expect(await memory.read('user-1')).toEqual({ userId: 'user-1', fromDate: '2026-10-05', version: 3 });
    expect(await memory.clear('user-1', 2)).toBe(false); // an old version clears nothing
    expect(await memory.clear('user-1', 3)).toBe(true);
    expect(await memory.read('user-1')).toBeNull();
    expect(await memory.clear('user-1', 3)).toBe(false);
  });
});
