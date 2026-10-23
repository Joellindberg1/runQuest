/**
 * Eventgränserna räknas i gruppens dygn: rundans dag börjar vid gruppens midnatt (zoneMidnightIso), inte vid UTC-midnatt
 * (`${runDate}T00:00:00Z`). Ett event som slutar 00:30 svensk tid och en runda den dagen hörde ihop i verkligheten men inte i frågan.
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
import { checkEventQualification } from '../eventService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

// 00:10 svensk tid den 19 oktober (sommartid), 22:10 den 18:e i New York.
const NOW = new Date('2026-10-18T22:10:00.000Z');

function tables(): Record<string, Row[]> {
  return {
    activity_log: [],
    events: [{
      id: 'e1', group_id: 'g1', type: 'participation', metric: null, status: 'active',
      starts_at: '2026-10-18T15:00:00.000Z', ends_at: '2026-10-18T22:30:00.000Z', // slutar 00:30 svensk tid den 19:e
      event_templates: { min_km: 3, reward_xp: 25 },
    }],
    event_entries: [],
    users: [{ id: 'a', group_id: 'g1', total_xp: 40, event_xp: 0, current_level: 1 }],
  };
}

function use(t: Record<string, Row[]>) {
  const db = createFakeDb(t, { autoIds: true, numericIds: ['activity_log'], rpc: { increment_event_xp: () => ({ data: null }) } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

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

const params = { userId: 'a', runId: 'r1', runDate: '2026-10-19', distanceKm: 5, groupId: 'g1' };

describe('checkEventQualification — eventgränsen i gruppens dygn', () => {
  it('asks for events ending after the Stockholm midnight of the run day, not after UTC midnight', async () => {
    const db = use(tables());
    await checkEventQualification(params);
    const events = db.queries.find((q) => q.table === 'events')!;
    expect(events.filters).toContainEqual({ op: 'gte', column: 'ends_at', value: '2026-10-18T22:00:00.000Z' });
  });

  it('qualifies a run of the 19th for an event that ends 00:30 Stockholm time on the 19th', async () => {
    const t = tables();
    use(t);
    await checkEventQualification(params);
    expect(t.event_entries).toHaveLength(1);
  });

  it('uses the midnight of the group time zone through the resolver, which also moves who qualifies', async () => {
    setGroupTimeZoneSource((groupId) => (groupId === 'g1' ? 'America/New_York' : undefined));
    const t = tables();
    const db = use(t);
    await checkEventQualification(params);
    const events = db.queries.find((q) => q.table === 'events')!;
    // New Yorks 19 oktober börjar 04:00Z, efter att eventet slutat.
    expect(events.filters).toContainEqual({ op: 'gte', column: 'ends_at', value: '2026-10-19T04:00:00.000Z' });
    expect(t.event_entries).toHaveLength(0);
  });

  describe('when the run date window is enforced', () => {
    // Eventet startar 00:30 svensk tid den 19:e (18:30 den 18:e i New York) och slutar 12:00 den 19:e svensk tid.
    const lateStart = (): Record<string, Row[]> => {
      const t = tables();
      Object.assign(t.events[0], { starts_at: '2026-10-18T22:30:00.000Z', ends_at: '2026-10-19T10:00:00.000Z' });
      return t;
    };
    const enforced = { ...params, runDate: '2026-10-18', enforceRunDateWindow: true };

    beforeEach(() => { vi.setSystemTime(new Date('2026-10-18T23:00:00.000Z')); });

    it('skips a run of the 18th, which is before the event starts in Stockholm', async () => {
      const t = lateStart();
      use(t);
      await checkEventQualification(enforced);
      expect(t.event_entries).toHaveLength(0);
    });

    it('qualifies the same run in a group whose time zone has the event starting on the 18th', async () => {
      setGroupTimeZoneSource((groupId) => (groupId === 'g1' ? 'America/New_York' : undefined));
      const t = lateStart();
      use(t);
      await checkEventQualification(enforced);
      expect(t.event_entries).toHaveLength(1);
    });
  });
});
