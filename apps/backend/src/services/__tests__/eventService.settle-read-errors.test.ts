/**
 * Avräkningen läser entries, rundor och namn och räknar fram placeringarna INNAN eventet claimas. Ett läsfel får inte ge en utbetalning på
 * halva data (alla med total 0, eller id i stället för namn vid lika totaler): eventet ska stå kvar som active så att nästa körning försöker igen.
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
import { settleCompetitionEvents } from '../eventService.js';
import { createFakeDb, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-19T00:05:00.000Z');

type Tables = Record<string, Row[]>;
type FailWhen = (q: RecordedQuery) => { message: string; code?: string } | null;

const member = (id: string, name: string): Row => ({ id, name, group_id: 'g1', total_xp: 0, event_xp: 0, current_level: 1 });
const entry = (userId: string): Row => ({ id: `n-${userId}`, event_id: 'e1', user_id: userId });
const kmRun = (userId: string, distance: number): Row => ({ id: `r-${userId}`, user_id: userId, date: '2026-10-14', distance, total_elevation_gain: 0, is_treadmill: false });

// Anna (u1) och Bertil (u2) har lika total: bara namnen avgör vem som får förstapriset.
function standings(): Tables {
  return {
    activity_log: [],
    events: [{
      id: 'e1', group_id: 'g1', type: 'competition', metric: 'km', status: 'active', settled_at: null,
      starts_at: '2026-10-12T00:00:00.000Z', ends_at: '2026-10-18T21:55:00.000Z',
      event_templates: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 40, reward_xp_2nd: 30, reward_xp_3rd: 20 },
    }],
    users: [member('u1', 'Anna'), member('u2', 'Bertil'), member('u3', 'Cecilia')],
    event_entries: ['u2', 'u1', 'u3'].map(entry),
    runs: [kmRun('u2', 10), kmRun('u1', 10), kmRun('u3', 4)],
  };
}

function use(tables: Tables, failWhen?: FailWhen) {
  const db = createFakeDb(tables, {
    autoIds: true,
    numericIds: ['activity_log'],
    failWhen,
    rpc: {
      increment_event_xp: ({ p_user_id, p_xp }) => {
        const u = tables.users.find((x) => x.id === p_user_id)!;
        u.event_xp += p_xp; u.total_xp += p_xp;
        return { data: null };
      },
    },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
}

const failingRead = (table: string, select?: string): FailWhen => (q) =>
  (q.table === table && !q.mutation && (select === undefined || q.select === select)
    ? { message: 'canceling statement due to statement timeout', code: '57014' }
    : null);

const paid = (t: Tables) => t.users.map((u) => u.event_xp);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('settleCompetitionEvents — a read that fails', () => {
  it.each([
    ['the runs of a participant', failingRead('runs')],
    ['the names of the participants', failingRead('users', 'id, name')],
    ['the entries of the event', failingRead('event_entries')],
  ])('does not claim or pay when it cannot read %s, and reports the event as failed', async (_what, failWhen) => {
    const t = standings();
    use(t, failWhen);

    const failure = await settleCompetitionEvents().catch((error: Error & { code?: string }) => error);

    expect((failure as Error).message).toBe('Competition settlement had failures: event e1: could not read the standings (57014)');
    expect((failure as { code?: string }).code).toBe('57014');
    expect(t.events[0]).toMatchObject({ status: 'active', settled_at: null });
    expect(paid(t)).toEqual([0, 0, 0]);
    expect(t.event_entries.map((e) => e.rank ?? null)).toEqual([null, null, null]);
    expect(t.activity_log).toEqual([]);
  });

  it('settles and pays 40, 30 and 20 XP to the right people the next time the reads work, and only once', async () => {
    const t = standings();
    use(t, failingRead('runs'));
    await expect(settleCompetitionEvents()).rejects.toThrow();

    use(t);
    await settleCompetitionEvents();
    await settleCompetitionEvents();

    expect(t.events[0].status).toBe('settled');
    expect(paid(t)).toEqual([40, 30, 20]); // Anna, Bertil, Cecilia: lika totaler avgörs av namnet
  });

  it('does not put the error text of the database in the log or in the thrown error', async () => {
    const t = standings();
    use(t, failingRead('runs'));

    const failure = await settleCompetitionEvents().catch((error: Error) => error);

    expect(JSON.stringify([(failure as Error).message, vi.mocked(logger.error).mock.calls])).not.toContain('statement timeout');
  });

  it('still settles the other events when one cannot be read', async () => {
    const t = standings();
    t.events.push({ ...t.events[0], id: 'e2' });
    t.event_entries.push({ id: 'n-e2', event_id: 'e2', user_id: 'u1' });
    use(t, (q) => (q.table === 'event_entries' && !q.mutation && q.filters.some((f) => f.column === 'event_id' && f.value === 'e1') ? { message: 'x', code: '57014' } : null));

    await expect(settleCompetitionEvents()).rejects.toThrow(/event e1/);

    expect(t.events.map((e) => e.status)).toEqual(['active', 'settled']);
  });
});
