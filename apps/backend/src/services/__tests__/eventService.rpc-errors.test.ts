/**
 * RUN-215 T3 — rpc('increment_event_xp') kontrolleras.
 *
 * Tidigare: {error} från rpc:n ignorerades. Kvalificeringen loggade "✅ qualified (+25 XP)" och räknade om nivå
 * trots att ingen XP gått in, och entryn låg kvar med xp_awarded — så ett omförsök fick 23505 och XP:n kom aldrig.
 * Avräkningen loggade på samma sätt "+75 XP" för en utbetalning som aldrig skedde.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../levelService.js', () => ({
  getLevelFromXP: vi.fn(async (xp: number) => (xp >= 100 ? 3 : xp >= 50 ? 2 : 1)),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { checkEventQualification, settleCompetitionEvents } from '../eventService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');

type RpcImpl = NonNullable<NonNullable<Parameters<typeof createFakeDb>[1]>['rpc']>[string];

function use(tables: Record<string, Row[]>, failFor: string[] = []) {
  const grant: RpcImpl = ({ p_user_id, p_xp }) => {
    if (failFor.includes(p_user_id)) return { error: { message: 'rpc exploded: row secret-9876', code: '23514' } };
    const u = tables.users.find((x) => x.id === p_user_id);
    if (u) { u.event_xp = (u.event_xp ?? 0) + p_xp; u.total_xp = (u.total_xp ?? 0) + p_xp; }
    return { data: null };
  };
  const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'], rpc: { increment_event_xp: grant } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const infoText = () => infoSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
const errorText = () => errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

const qualifyParams = { userId: 'a', runId: 'r1', runDate: '2026-10-05', distanceKm: 5, groupId: 'g1' };

function participationTables(): Record<string, Row[]> {
  return {
    activity_log: [],
    events: [{
      id: 'e1', group_id: 'g1', type: 'participation', metric: null, status: 'active',
      starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z',
      event_templates: { min_km: 3, reward_xp: 25 },
    }],
    event_entries: [],
    users: [{ id: 'a', group_id: 'g1', total_xp: 40, event_xp: 0, current_level: 1 }],
  };
}

describe('checkEventQualification — increment_event_xp', () => {
  it('event qualification surfaces increment_event_xp failure', async () => {
    const tables = participationTables();
    use(tables, ['a']);

    await expect(checkEventQualification(qualifyParams)).rejects.toThrow(/increment_event_xp/);

    expect(errorText()).toMatch(/increment_event_xp/);
    expect(infoText()).not.toMatch(/qualified for participation/);
    expect(tables.users[0]).toMatchObject({ total_xp: 40, current_level: 1 });
    expect(tables.activity_log).toHaveLength(0); // ingen level_up för XP som aldrig gick in
  });

  it('the thrown qualification error carries the database code and none of the database text', async () => {
    use(participationTables(), ['a']);

    const failure = await checkEventQualification(qualifyParams).catch((error: Error & { code?: string }) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as { code?: string }).code).toBe('23514');
    expect((failure as Error).message).toBe('Event qualification failed for user a: increment_event_xp failed for event e1 (23514)');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-9876');
  });

  it('entryn tas bort när XP:n inte gick in, så att nästa kvalificering kan försöka igen', async () => {
    const tables = participationTables();
    use(tables, ['a']);

    await expect(checkEventQualification(qualifyParams)).rejects.toThrow();
    expect(tables.event_entries).toHaveLength(0);
  });

  it('ett event som fallerar stoppar inte de övriga eventen (felet kastas först efter loopen)', async () => {
    const tables = participationTables();
    tables.events.push({
      id: 'e2', group_id: 'g1', type: 'competition', metric: 'km', status: 'active',
      starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-09T16:00:00.000Z', event_templates: {},
    });
    use(tables, ['a']);

    await expect(checkEventQualification(qualifyParams)).rejects.toThrow();
    expect(tables.event_entries.map((e) => e.event_id)).toEqual(['e2']);
  });

  it('lyckad väg oförändrad: entry, XP, nivå och level_up', async () => {
    const tables = participationTables();
    use(tables);

    await expect(checkEventQualification(qualifyParams)).resolves.toBeUndefined();

    expect(tables.event_entries).toHaveLength(1);
    expect(tables.users[0]).toMatchObject({ total_xp: 65, event_xp: 25, current_level: 2 });
    expect(tables.activity_log.map((r) => r.type)).toEqual(['level_up']);
    expect(infoText()).toMatch(/qualified for participation/);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

function competitionTables(): Record<string, Row[]> {
  return {
    activity_log: [],
    events: [{
      id: 'e9', group_id: 'g1', type: 'competition', metric: 'km', status: 'active',
      starts_at: '2026-10-04T00:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z',
      event_templates: { name: 'Weekend Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 75, reward_xp_2nd: 45, reward_xp_3rd: 30 },
    }],
    event_entries: [{ id: 'n1', event_id: 'e9', user_id: 'a' }, { id: 'n2', event_id: 'e9', user_id: 'b' }],
    users: [
      { id: 'a', group_id: 'g1', total_xp: 40, event_xp: 0, current_level: 1 },
      { id: 'b', group_id: 'g1', total_xp: 10, event_xp: 0, current_level: 1 },
    ],
    runs: [
      { id: 'r1', user_id: 'a', date: '2026-10-04', distance: 12, is_treadmill: false },
      { id: 'r2', user_id: 'b', date: '2026-10-05', distance: 5, is_treadmill: false },
    ],
  };
}

describe('settleCompetitionEvents — increment_event_xp', () => {
  it('settlement surfaces increment_event_xp failure and does not log a payout that never happened', async () => {
    const tables = competitionTables();
    use(tables, ['a']);

    await expect(settleCompetitionEvents()).rejects.toThrow(/increment_event_xp/);

    expect(errorText()).toMatch(/increment_event_xp/);
    expect(infoText()).not.toMatch(/User a rank 1/);
    expect(tables.users.find((u) => u.id === 'a')).toMatchObject({ total_xp: 40, current_level: 1 });
    expect(tables.activity_log.filter((r) => r.type === 'level_up' && r.actor_user_id === 'a')).toHaveLength(0);
  });

  it('the thrown settlement error carries the code of the first failure and none of the database text', async () => {
    use(competitionTables(), ['a']);

    const failure = await settleCompetitionEvents().catch((error: Error) => error);

    expect((failure as { code?: string }).code).toBe('23514');
    expect((failure as Error).message).toBe('Competition settlement had failures: event e9: increment_event_xp failed for user a (+75 XP) (23514)');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-9876');
  });

  it('an unexpected error while settling an event is reported by its code, never its message', async () => {
    const tables = competitionTables();
    const db = createFakeDb(tables, { autoIds: true, numericIds: ['activity_log'], rpc: { increment_event_xp: () => ({ data: null }) } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    const { getLevelFromXP } = await import('../levelService.js');
    vi.mocked(getLevelFromXP).mockRejectedValueOnce(Object.assign(new Error('socket hang up near secret-9876'), { code: 'ECONNRESET' }));

    const failure = await settleCompetitionEvents().catch((error: Error) => error);

    expect((failure as { code?: string }).code).toBe('ECONNRESET');
    expect((failure as Error).message).toBe('Competition settlement had failures: event e9: unexpected error (ECONNRESET)');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-9876');
  });

  it('en misslyckad utbetalning hindrar inte de övriga placeringarna', async () => {
    const tables = competitionTables();
    use(tables, ['a']);

    await expect(settleCompetitionEvents()).rejects.toThrow();
    expect(tables.users.find((u) => u.id === 'b')).toMatchObject({ event_xp: 45, total_xp: 55, current_level: 2 });
    expect(infoText()).toMatch(/User b rank 2/);
  });

  it('en misslyckad rank-uppdatering på entryn syns också', async () => {
    const tables = competitionTables();
    const db = createFakeDb(tables, {
      autoIds: true, numericIds: ['activity_log'],
      failWhen: (q) => (q.table === 'event_entries' && q.mutation === 'update' ? { message: 'entry update failed' } : null),
      rpc: { increment_event_xp: () => ({ data: null }) },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await expect(settleCompetitionEvents()).rejects.toThrow(/entry/i);
  });

  it('lyckad väg oförändrad: båda utbetalda, nivåer uppdaterade, inget fel', async () => {
    const tables = competitionTables();
    use(tables);

    await expect(settleCompetitionEvents()).resolves.toBeUndefined();

    expect(tables.events[0].status).toBe('settled');
    expect(tables.users.map((u) => [u.id, u.event_xp, u.current_level])).toEqual([['a', 75, 3], ['b', 45, 2]]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
