/**
 * group-eligibility är gruppsatt och fail-closed (ADR 007 A6): utan grupp läses ingenting. Vad tjänsten räknar för en grupp med data
 * bevisas genom slutpunkten i routes/__tests__/titles-group-eligibility*.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { getGroupEligibility } from '../groupEligibility.js';
import { createFakeDb } from '../../routes/__tests__/helpers/fakeDb.js';

describe('getGroupEligibility', () => {
  it.each([['tomt groupId', ''], ['saknat groupId', undefined as unknown as string]])('%s kastar innan något läses', async (_label, groupId) => {
    const db = createFakeDb({
      group_members: [{ group_id: 'g1', user_id: 'u1', starts_on: null, left_at: null }],
      users: [{ id: 'u1', name: 'Alice', total_km: 1, longest_streak: 1, gender: null }],
    });
    holder.client = db.client;

    await expect(getGroupEligibility(groupId)).rejects.toThrow('kräver groupId');
    expect(db.queries).toEqual([]);
  });
});
