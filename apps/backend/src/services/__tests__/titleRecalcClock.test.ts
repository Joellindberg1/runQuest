/**
 * Klockan är gruppens (ADR 012 beslut 5.6) och fail-closed: utan grupp läses ingenting, och det blir aldrig en global klocka som
 * ersättning. Vad klockan ger för en grupp med data bevisas genom slutpunkten i routes/__tests__/titles-group-eligibility-clock.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { getTitleRecalcContext } from '../titleRecalcClock.js';
import { createFakeDb } from '../../routes/__tests__/helpers/fakeDb.js';

describe('getTitleRecalcContext', () => {
  it.each([['tomt groupId', ''], ['saknat groupId', undefined as unknown as string]])('%s kastar innan något läses', async (_label, groupId) => {
    const db = createFakeDb({ title_leaderboard: [{ group_id: 'g1', updated_at: '2026-10-01T00:00:00Z' }] });
    holder.client = db.client;

    await expect(getTitleRecalcContext(groupId)).rejects.toThrow('kräver groupId');
    expect(db.queries).toEqual([]);
  });

  it('läser bara den egna gruppens topplistor', async () => {
    const db = createFakeDb({
      title_leaderboard: [
        { group_id: 'g1', updated_at: '2026-10-01T00:00:00Z' },
        { group_id: 'g2', updated_at: '2026-10-02T00:00:00Z' },
      ],
    });
    holder.client = db.client;

    const ctx = await getTitleRecalcContext('g1');

    expect(ctx.now.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(db.queries.map((q) => q.table)).toEqual(['title_leaderboard']);
    expect(db.queries[0].filters).toContainEqual({ op: 'eq', column: 'group_id', value: 'g1' });
  });
});
