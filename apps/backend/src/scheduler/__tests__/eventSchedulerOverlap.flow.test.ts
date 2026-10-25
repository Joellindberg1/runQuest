/**
 * The Monday 00:05 settlement and the hourly :35 retry are separate node-cron tasks, so node-cron's own per-task overlap handling does not
 * connect them: while a slow run of the settlement is still reading the standings, the 00:35 and 01:35 ticks start their own passes over the
 * same still-active event. Only the claim in settleCompetitionEvents (status active -> settled, exactly one winner) keeps them from paying
 * three times.
 *
 * Nothing is mocked in the scheduling path: the real startEventScheduler, the real node-cron 4 (with its Stockholm time zone and its
 * heartbeat on setTimeout) and the real settleCompetitionEvents run on fake time against fakeDb, whose runs read is made slow.
 * Nothing waits on the wall clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cron from 'node-cron';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({
  getLevelFromXP: vi.fn(async () => 1),
}));

import { MS_HOUR, MS_MINUTE } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { startEventScheduler } from '../eventScheduler.js';

const SUNDAY_END = '2026-10-18T21:59:00.000Z'; // Sunday 23:59 Stockholm time (CEST, UTC+2)
const BEFORE_MONDAY_SETTLE = new Date('2026-10-18T22:04:30.000Z'); // Monday 00:04:30
const MONDAY_SETTLE_MS = Date.parse('2026-10-18T22:05:00.000Z'); // Monday 00:05
const TICK_0035_MS = Date.parse('2026-10-18T22:35:00.000Z');
const TICK_0135_MS = Date.parse('2026-10-18T23:35:00.000Z');
const RUNS_READ_MS = 40 * MS_MINUTE; // three participants: the first pass reads for 2 h and claims at 02:05

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

/** fakeDb in which every read of `runs` takes `RUNS_READ_MS` of (fake) time, and which keeps count of the reads in flight. */
function useSlowRunsRead(tables: Tables) {
  const db = createFakeDb(tables, {
    autoIds: true,
    numericIds: ['activity_log'],
    rpc: {
      increment_event_xp: ({ p_user_id, p_xp }) => {
        const u = tables.users.find((x) => x.id === p_user_id)!;
        u.event_xp += p_xp; u.total_xp += p_xp;
        return { data: null };
      },
    },
  });
  const reads = { started: [] as number[], inFlight: 0 };
  const client = {
    ...db.client,
    from(table: string) {
      const builder = db.client.from(table);
      if (table !== 'runs') return builder;
      const slow: any = new Proxy(builder, {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
              reads.started.push(Date.now());
              reads.inFlight++;
              setTimeout(() => { reads.inFlight--; target.then(resolve, reject); }, RUNS_READ_MS);
            };
          }
          const member = target[prop];
          if (typeof member !== 'function') return member;
          return (...args: unknown[]) => {
            const result = member.apply(target, args);
            return result === target ? slow : result;
          };
        },
      });
      return slow;
    },
  };
  vi.mocked(getSupabaseClient).mockReturnValue(client as never);
  return reads;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BEFORE_MONDAY_SETTLE);
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const task of cron.getTasks().values()) task.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('event scheduler — overlapping settlement ticks with real node-cron 4', () => {
  it('pays the competition exactly once and writes event_closed exactly once when the 00:35 and 01:35 ticks arrive during the run from 00:05', async () => {
    const t = world();
    const reads = useSlowRunsRead(t);
    startEventScheduler();

    // Monday 00:05 starts the settlement; its first runs read is under way when the clock reaches 00:35 and 01:35.
    await vi.advanceTimersByTimeAsync(MONDAY_SETTLE_MS - Date.now() + 1000);
    expect(reads.started).toEqual([MONDAY_SETTLE_MS]);
    await vi.advanceTimersByTimeAsync(TICK_0135_MS - Date.now() + 1000);

    // The two ticks really did overlap the first run: three passes read at once, the first one still short of its claim.
    expect(reads.started.filter((at) => at === TICK_0035_MS)).toHaveLength(1);
    expect(reads.started.filter((at) => at === TICK_0135_MS)).toHaveLength(1);
    expect(reads.inFlight).toBe(3);
    expect(t.events[0].status).toBe('active');
    expect(t.users.map((u) => u.event_xp)).toEqual([0, 0, 0]);

    // Let all three passes run to their end (the last one finishes at 03:35).
    await vi.advanceTimersByTimeAsync(6 * MS_HOUR);

    expect(reads.inFlight).toBe(0);
    expect(t.events[0].status).toBe('settled');
    expect(t.users.map((u) => u.event_xp)).toEqual([30, 40, 20]); // Anna 12 km, Bertil 30 km, Cecilia 5 km: Bertil 40, Anna 30, Cecilia 20
    expect(t.users.reduce((sum, u) => sum + u.event_xp, 0)).toBe(90);
    expect(t.activity_log.filter((r) => r.type === 'event_closed')).toHaveLength(1);
  });
});
