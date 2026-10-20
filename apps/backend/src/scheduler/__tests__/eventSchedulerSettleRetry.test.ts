/**
 * Ett tävlingsevent vars avräkning föll på ett läsfel (kvar som active) försöks igen i nästa timtick, inte först nästa måndag.
 * Mot fakeDb och den riktiga settleCompetitionEvents: bara node-cron är fejkad (uttrycken och deras alternativ fångas).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  crons: new Map<string, () => Promise<void>>(),
  options: new Map<string, unknown>(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (expression: string, callback: () => Promise<void>, options?: unknown) => {
      h.crons.set(expression, callback);
      h.options.set(expression, options);
    },
  },
}));
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({
  getLevelFromXP: vi.fn(async () => 1),
}));

import { STOCKHOLM_TZ } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { COMPETITION_RETRY_CRON, startEventScheduler } from '../eventScheduler.js';

const SUNDAY_END = '2026-10-18T21:59:00.000Z'; // söndag 23:59 svensk tid
const MONDAY_SETTLE = new Date('2026-10-18T22:05:00.000Z'); // måndag 00:05
const TICK = new Date('2026-10-18T22:35:00.000Z');

type Tables = Record<string, Row[]>;

const member = (id: string, name: string): Row => ({ id, name, group_id: 'g1', total_xp: 0, event_xp: 0, current_level: 1 });
const run = (userId: string, distance: number): Row => ({ id: `r-${userId}`, user_id: userId, date: '2026-10-14', distance, total_elevation_gain: 0, is_treadmill: false });

function world(): Tables {
  return {
    activity_log: [],
    events: [{
      id: 'ev-done', group_id: 'g1', type: 'competition', metric: 'km', status: 'active', settled_at: null,
      starts_at: '2026-10-12T00:00:00.000Z', ends_at: SUNDAY_END,
      event_templates: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 40, reward_xp_2nd: 30, reward_xp_3rd: 20 },
    }],
    users: [member('u1', 'Anna'), member('u2', 'Bertil'), member('u3', 'Cecilia')],
    event_entries: ['u1', 'u2', 'u3'].map((u) => ({ id: `n-${u}`, event_id: 'ev-done', user_id: u })),
    runs: [run('u1', 12), run('u2', 30), run('u3', 5)],
  };
}

function use(tables: Tables, failWhen?: (q: RecordedQuery) => { message: string; code?: string } | null) {
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
  return db;
}

const paid = (t: Tables) => t.users.map((u) => u.event_xp);
const monday = () => h.crons.get('5 0 * * 1')!;
const tick = () => h.crons.get(RETRY)!;
const RETRY = COMPETITION_RETRY_CRON;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY_SETTLE);
  h.crons.clear();
  h.options.clear();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  startEventScheduler();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('event scheduler — settlement retry', () => {
  it('keeps the Monday 00:05 settlement and adds an hourly tick in Stockholm time', () => {
    expect(h.crons.has('5 0 * * 1')).toBe(true);
    expect(h.options.get('5 0 * * 1')).toEqual({ timezone: STOCKHOLM_TZ });
    expect(RETRY).toBe('35 * * * *'); // minut 35: måndagens 00:05 går alltid först
    expect(h.crons.has(RETRY)).toBe(true);
    expect(h.options.get(RETRY)).toEqual({ timezone: STOCKHOLM_TZ });
  });

  it('settles a competition whose standings could not be read on Monday in the next tick, not the following Monday', async () => {
    const t = world();
    use(t, (q) => (q.table === 'runs' ? { message: 'canceling statement due to statement timeout', code: '57014' } : null));
    await monday()();
    expect(t.events[0].status).toBe('active');
    expect(paid(t)).toEqual([0, 0, 0]);

    use(t); // läsningen fungerar igen
    vi.setSystemTime(TICK);
    await tick()();

    expect(t.events[0].status).toBe('settled');
    expect(paid(t)).toEqual([30, 40, 20]); // Anna 12 km, Bertil 30 km, Cecilia 5 km: Bertil 40, Anna 30, Cecilia 20
  });

  it('pays exactly once when ticks and the Monday run overlap', async () => {
    const t = world();
    use(t);
    vi.setSystemTime(TICK);

    await Promise.all([tick()(), tick()(), monday()()]);
    await tick()();

    expect(t.events[0].status).toBe('settled');
    expect(t.users.find((u) => u.id === 'u2')!.event_xp).toBe(40);
    expect(paid(t).reduce((a, b) => a + b, 0)).toBe(90);
    expect(t.activity_log.filter((r) => r.type === 'event_closed')).toHaveLength(1);
  });

  it('never touches an event that is already settled or has not ended yet, and writes nothing', async () => {
    const t = world();
    t.events = [
      { ...t.events[0], id: 'ev-settled', status: 'settled', settled_at: '2026-10-11T22:05:00.000Z' },
      { ...t.events[0], id: 'ev-running', ends_at: '2026-10-25T21:59:00.000Z' },
    ];
    const before = structuredClone(t);
    const db = use(t);
    vi.setSystemTime(TICK);

    await tick()();

    expect(t).toEqual(before);
    expect(db.queries.filter((q) => q.mutation)).toEqual([]);
  });

  it('reads only the events table when nothing has ended', async () => {
    const t = world();
    t.events = [{ ...t.events[0], ends_at: '2026-10-25T21:59:00.000Z' }];
    const db = use(t);
    vi.setSystemTime(TICK);

    await tick()();

    expect(db.queries.map((q) => q.table)).toEqual(['events']);
  });

  it('logs a tick that cannot read the events as an error and does not throw out of the cron callback', async () => {
    use(world(), (q) => (q.table === 'events' ? { message: 'down', code: '57014' } : null));
    vi.setSystemTime(TICK);
    await expect(tick()()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
