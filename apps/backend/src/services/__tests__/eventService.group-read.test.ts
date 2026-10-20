/**
 * checkEventQualification när gruppen inte följer med anropet och måste läsas ur users.group_id (readUserGroupId). Fail-closed:
 * en användare utan grupp kvalificerar inget och läser inga events; ett läsfel är inte "ingen grupp" utan kastas, så att anroparnas
 * .catch loggar det (förut avbröts kvalificeringen tyst) — och inga events läses eller skrivs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../levelService.js', () => ({
  getLevelFromXP: vi.fn(async () => 1),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { checkEventQualification } from '../eventService.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const params = { userId: 'a', runId: 'r1', runDate: '2026-10-05', distanceKm: 5 };

function tables(userGroup: string | null): Record<string, Row[]> {
  const event = (id: string, group_id: string): Row => ({
    id, group_id, type: 'participation', metric: null, status: 'active',
    starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z', event_templates: { min_km: 3, reward_xp: 25 },
  });
  return {
    activity_log: [],
    events: [event('e-own', 'g1'), event('e-foreign', 'g2')],
    event_entries: [],
    users: [{ id: 'a', group_id: userGroup, total_xp: 40, event_xp: 0, current_level: 1 }],
  };
}

function setup(data: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const db = createFakeDb(data, { autoIds: true, numericIds: ['activity_log'], rpc: { increment_event_xp: () => ({ data: null }) }, ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('checkEventQualification — gruppen läses ur users.group_id', () => {
  it('reads the events of the group of the user and qualifies only for those', async () => {
    const data = tables('g1');
    const db = setup(data);

    await checkEventQualification(params);

    const eventQuery = db.queries.find((q) => q.table === 'events')!;
    expect(eventQuery.filters).toContainEqual({ op: 'eq', column: 'group_id', value: 'g1' });
    expect(data.event_entries.map((e) => e.event_id)).toEqual(['e-own']);
  });

  it('a user without a group qualifies for nothing and reads no events', async () => {
    const data = tables(null);
    const db = setup(data);

    await expect(checkEventQualification(params)).resolves.toBeUndefined();

    expect(db.queries.some((q) => q.table === 'events')).toBe(false);
    expect(data.event_entries).toHaveLength(0);
  });

  it('a group id in the call is used as it is, without reading users', async () => {
    const data = tables(null);
    const db = setup(data);

    await checkEventQualification({ ...params, groupId: 'g1' });

    expect(db.queries.some((q) => q.table === 'users' && q.select === 'group_id')).toBe(false);
    expect(data.event_entries.map((e) => e.event_id)).toEqual(['e-own']);
  });

  it('a failed read of users.group_id rejects with the database code, reads no events and writes nothing', async () => {
    const data = tables('g1');
    const db = setup(data, {
      failWhen: (q) => (q.table === 'users' && q.select === 'group_id' ? { message: 'row value secret-4711 leaked', code: '57014' } : null),
    });

    await expect(checkEventQualification(params)).rejects.toMatchObject({ code: '57014' });

    expect(db.queries.some((q) => q.table === 'events')).toBe(false);
    expect(data.event_entries).toHaveLength(0);
    expect(data.users[0]).toMatchObject({ total_xp: 40, event_xp: 0 });
  });

  it('the rejection of a failed group read carries a fixed message, never the database text', async () => {
    setup(tables('g1'), {
      failWhen: (q) => (q.table === 'users' && q.select === 'group_id' ? { message: 'row value secret-4711 leaked', code: '57014' } : null),
    });

    const error = await checkEventQualification(params).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect(`${(error as Error).message}${JSON.stringify(error)}`).not.toContain('secret-4711');
    expect(errorSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n')).not.toContain('secret-4711');
  });
});
