/**
 * Veckotävlingens avräkning mot fakeDb: placering till XP (40/30/20 ur mallen), lika totaler avgörs av namn och id (samma ordning som all-time-tabellen),
 * måttet (km eller höjdmeter utan löpband) och dygnen i gruppens zon.
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
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { settleCompetitionEvents } from '../eventService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-19T00:05:00.000Z');

type Tables = Record<string, Row[]>;

function use(tables: Tables) {
  const db = createFakeDb(tables, {
    autoIds: true,
    numericIds: ['activity_log'],
    rpc: {
      increment_event_xp: ({ p_user_id, p_xp }) => {
        const u = tables.users.find((x) => x.id === p_user_id);
        if (u) { u.event_xp += p_xp; u.total_xp += p_xp; }
        return { data: null };
      },
    },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const member = (id: string, name: string): Row => ({ id, name, group_id: 'g1', total_xp: 0, event_xp: 0, current_level: 1 });
const entry = (userId: string): Row => ({ id: `n-${userId}`, event_id: 'e1', user_id: userId });
const kmRun = (userId: string, distance: number, date = '2026-10-14'): Row => ({ id: `r-${userId}-${date}-${distance}`, user_id: userId, date, distance, total_elevation_gain: 0, is_treadmill: false });

function world(over: Partial<Tables> = {}, event: Row = {}): Tables {
  return {
    activity_log: [],
    events: [{
      id: 'e1', group_id: 'g1', type: 'competition', metric: 'km', status: 'active',
      starts_at: '2026-10-12T00:00:00.000Z', ends_at: '2026-10-18T21:55:00.000Z',
      event_templates: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 40, reward_xp_2nd: 30, reward_xp_3rd: 20 },
      ...event,
    }],
    users: [member('u1', 'Anna'), member('u2', 'Bertil'), member('u3', 'Cecilia'), member('u4', 'David'), member('u5', 'Erik')],
    event_entries: [],
    runs: [],
    ...over,
  };
}

const saved = (t: Tables, userId: string) => {
  const { rank, xp_awarded, total_value } = t.event_entries.find((e) => e.user_id === userId)!;
  return { rank, xp_awarded, total_value };
};
const eventXp = (t: Tables, userId: string): number => t.users.find((u) => u.id === userId)!.event_xp;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setGroupTimeZoneSource();
});

describe('settleCompetitionEvents — placering till XP', () => {
  it('pays the template prizes 40, 30 and 20 XP to places one to three and nothing from fourth place', async () => {
    const t = world({
      event_entries: ['u1', 'u2', 'u3', 'u4', 'u5'].map(entry),
      runs: [kmRun('u1', 8), kmRun('u2', 30.5), kmRun('u3', 12), kmRun('u4', 3), kmRun('u5', 20)],
    });
    use(t);
    await settleCompetitionEvents();

    expect(saved(t, 'u2')).toEqual({ rank: 1, xp_awarded: 40, total_value: 30.5 });
    expect(saved(t, 'u5')).toEqual({ rank: 2, xp_awarded: 30, total_value: 20 });
    expect(saved(t, 'u3')).toEqual({ rank: 3, xp_awarded: 20, total_value: 12 });
    expect(saved(t, 'u1')).toEqual({ rank: 4, xp_awarded: 0, total_value: 8 });
    expect(saved(t, 'u4')).toEqual({ rank: 5, xp_awarded: 0, total_value: 3 });
    expect(['u2', 'u5', 'u3', 'u1', 'u4'].map((id) => eventXp(t, id))).toEqual([40, 30, 20, 0, 0]);
  });

  it('pays only the placements that exist when fewer than three took part', async () => {
    const t = world({ event_entries: ['u1', 'u2'].map(entry), runs: [kmRun('u1', 5), kmRun('u2', 9)] });
    use(t);
    await settleCompetitionEvents();

    expect([saved(t, 'u2').xp_awarded, saved(t, 'u1').xp_awarded]).toEqual([40, 30]);
    expect(t.events[0].status).toBe('settled');
  });
});

describe('settleCompetitionEvents — equal totals', () => {
  const tied = (entryOrder: string[]): Tables => world({
    event_entries: entryOrder.map(entry),
    runs: [kmRun('u1', 10), kmRun('u2', 10), kmRun('u3', 10), kmRun('u4', 10), kmRun('u5', 25)],
  });

  it('ranks equal totals by name, so the prizes go to Anna, Bertil and Cecilia and not to whoever the database listed first', async () => {
    const t = tied(['u4', 'u3', 'u2', 'u1', 'u5']);
    use(t);
    await settleCompetitionEvents();

    expect(['u5', 'u1', 'u2', 'u3', 'u4'].map((id) => saved(t, id).rank)).toEqual([1, 2, 3, 4, 5]);
    expect(['u5', 'u1', 'u2', 'u3', 'u4'].map((id) => eventXp(t, id))).toEqual([40, 30, 20, 0, 0]);
  });

  it('gives the same placements whichever order the entries are read in', async () => {
    const a = tied(['u1', 'u2', 'u3', 'u4', 'u5']);
    const b = tied(['u5', 'u4', 'u3', 'u2', 'u1']);
    use(a);
    await settleCompetitionEvents();
    use(b);
    await settleCompetitionEvents();

    const ranks = (t: Tables) => ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => saved(t, id));
    expect(ranks(b)).toEqual(ranks(a));
  });

  it('falls back on the id when two members share a name', async () => {
    const t = world({
      users: [member('u2', 'Anna'), member('u1', 'anna')],
      event_entries: ['u2', 'u1'].map(entry),
      runs: [kmRun('u1', 4), kmRun('u2', 4)],
    });
    use(t);
    await settleCompetitionEvents();

    expect([saved(t, 'u1').rank, saved(t, 'u2').rank]).toEqual([1, 2]);
  });

  it('still settles and pays when a participant has no name to order by', async () => {
    const t = world({
      users: [{ id: 'u1', group_id: 'g1', total_xp: 0, event_xp: 0, current_level: 1 }, member('u2', 'Bertil')],
      event_entries: ['u1', 'u2'].map(entry),
      runs: [kmRun('u1', 7), kmRun('u2', 7)],
    });
    use(t);
    await settleCompetitionEvents();

    expect([saved(t, 'u1').rank, saved(t, 'u2').rank].sort()).toEqual([1, 2]);
    expect(eventXp(t, 'u1') + eventXp(t, 'u2')).toBe(70);
  });
});

describe('settleCompetitionEvents — metric and days', () => {
  it('counts elevation gain without treadmill runs for an elevation competition', async () => {
    const t = world(
      {
        event_entries: ['u1', 'u2'].map(entry),
        runs: [
          { id: 'a1', user_id: 'u1', date: '2026-10-14', distance: 5, total_elevation_gain: 100, is_treadmill: false },
          { id: 'a2', user_id: 'u1', date: '2026-10-15', distance: 5, total_elevation_gain: 300, is_treadmill: true },
          { id: 'b1', user_id: 'u2', date: '2026-10-14', distance: 5, total_elevation_gain: 150, is_treadmill: false },
        ],
      },
      { metric: 'elevation' },
    );
    use(t);
    await settleCompetitionEvents();

    expect(saved(t, 'u2')).toMatchObject({ rank: 1, total_value: 150 });
    expect(saved(t, 'u1')).toMatchObject({ rank: 2, total_value: 100 });
  });

  it('counts the event days in the group time zone, which can move who wins', async () => {
    // Eventet börjar 18:00 den 12:e i New York (00:00 den 13:e svensk tid): en runda den 12:e räknas där men inte i Stockholm.
    const build = (): Tables => world(
      { event_entries: ['u1', 'u2'].map(entry), runs: [kmRun('u1', 20, '2026-10-12'), kmRun('u2', 5, '2026-10-14')] },
      { starts_at: '2026-10-12T22:00:00.000Z', ends_at: '2026-10-18T21:55:00.000Z' },
    );
    const stockholm = build();
    use(stockholm);
    await settleCompetitionEvents();
    expect([saved(stockholm, 'u2').rank, saved(stockholm, 'u1').rank]).toEqual([1, 2]);

    setGroupTimeZoneSource((groupId) => (groupId === 'g1' ? 'America/New_York' : undefined));
    const newYork = build();
    use(newYork);
    await settleCompetitionEvents();
    expect([saved(newYork, 'u1').rank, saved(newYork, 'u2').rank]).toEqual([1, 2]);
  });
});
