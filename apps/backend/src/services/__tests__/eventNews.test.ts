/**
 * Pack News-skrivpunkter i eventService (ADR 008 beslut 5):
 *  event_open  — maybeCreateEvent (active) och activateScheduledEvents (faktiskt aktiverade)
 *  event_closed — settleCompetitionEvents (efter utbetalning, topp 3) och settleExpiredParticipationEvents
 *  level_up    — participation-XP och competition-utbetalning
 * Varje punkt ska ge EXAKT en rad även vid omkörning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

// Enkel nivåtrappa: 0 → 1, 50 → 2, 100 → 3
vi.mock('../levelService.js', () => ({
  getLevelFromXP: vi.fn(async (xp: number) => (xp >= 100 ? 3 : xp >= 50 ? 2 : 1)),
}));

import { getSupabaseClient } from '../../config/database.js';
import {
  activateScheduledEvents,
  checkEventQualification,
  maybeCreateEvent,
  settleCompetitionEvents,
  settleExpiredParticipationEvents,
} from '../eventService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, {
    autoIds: true,
    numericIds: ['activity_log'],
    rpc: {
      // som increment_event_xp: event_xp och total_xp växer
      increment_event_xp: ({ p_user_id, p_xp }) => {
        const u = tables.users.find((x) => x.id === p_user_id);
        if (u) { u.event_xp = (u.event_xp ?? 0) + p_xp; u.total_xp = (u.total_xp ?? 0) + p_xp; }
        return { data: null };
      },
    },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const tmpl = (over: Row = {}): Row => ({
  id: 'tp1', name: 'Morning Run', type: 'participation', metric: null, icon: 'sun', reward_xp: 25,
  reward_xp_1st: null, reward_xp_2nd: null, reward_xp_3rd: null, min_km: 3, active: true, ...over,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('event_open', () => {
  it('maybeCreateEvent: ett event som skapas som active loggas (occurred_at = starts_at)', async () => {
    const tables: Record<string, Row[]> = { activity_log: [], events: [], event_templates: [tmpl()] };
    use(tables);
    const created = await maybeCreateEvent('Morning Run', 'g1', new Date('2026-10-05T06:00:00.000Z'), new Date('2026-10-05T10:00:00.000Z'));

    expect(created).toBe(true);
    expect(tables.events).toHaveLength(1);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      group_id: 'g1', type: 'event_open', actor_user_id: null, target_user_id: null,
      occurred_at: '2026-10-05T06:00:00.000Z', dedupe_key: `event_open:${tables.events[0].id}`,
      payload: { event_id: tables.events[0].id, event_type: 'participation', template_name: 'Morning Run', icon: 'sun', reward_xp: 25, ends_at: '2026-10-05T10:00:00.000Z' },
    });
  });

  it('maybeCreateEvent: competition använder förstapriset som reward_xp', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], events: [],
      event_templates: [tmpl({ name: 'Weekly Km', type: 'competition', metric: 'km', icon: 'trophy', reward_xp: null, reward_xp_1st: 150 })],
    };
    use(tables);
    await maybeCreateEvent('Weekly Km', 'g1', new Date('2026-10-05T00:00:00.000Z'), new Date('2026-10-11T21:55:00.000Z'));
    expect(tables.activity_log[0].payload).toMatchObject({ event_type: 'competition', reward_xp: 150 });
  });

  it('maybeCreateEvent: ett schemalagt (framtida) event loggas INTE vid skapandet', async () => {
    const tables: Record<string, Row[]> = { activity_log: [], events: [], event_templates: [tmpl()] };
    use(tables);
    await maybeCreateEvent('Morning Run', 'g1', new Date('2026-10-06T06:00:00.000Z'), new Date('2026-10-06T10:00:00.000Z'));
    expect(tables.events[0].status).toBe('scheduled');
    expect(tables.activity_log).toHaveLength(0);
  });

  it('maybeCreateEvent: nekat skapande (dubblett) ger ingen rad', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [], event_templates: [tmpl()],
      events: [{ id: 'dup', group_id: 'g1', type: 'participation', status: 'active', starts_at: '2026-10-05T05:00:00.000Z', ends_at: '2026-10-05T11:00:00.000Z' }],
    };
    use(tables);
    expect(await maybeCreateEvent('Morning Run', 'g1', new Date('2026-10-05T06:00:00.000Z'), new Date('2026-10-05T10:00:00.000Z'))).toBe(false);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('activateScheduledEvents: loggar bara faktiskt aktiverade; omkörning ger ingen dubblett', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [],
      events: [
        { id: 'e1', group_id: 'g1', type: 'participation', status: 'scheduled', starts_at: '2026-10-05T11:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z',
          event_templates: { name: 'Lunch Run', icon: 'sun', reward_xp: 20, reward_xp_1st: null } },
        { id: 'e2', group_id: 'g1', type: 'participation', status: 'scheduled', starts_at: '2026-10-06T11:00:00.000Z', ends_at: '2026-10-06T16:00:00.000Z', // framtida
          event_templates: { name: 'Later', icon: 'sun', reward_xp: 20, reward_xp_1st: null } },
        { id: 'e3', group_id: 'g1', type: 'participation', status: 'active', starts_at: '2026-10-05T01:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z', // redan aktivt
          event_templates: { name: 'Already', icon: 'sun', reward_xp: 20, reward_xp_1st: null } },
      ],
    };
    use(tables);
    await activateScheduledEvents();
    await activateScheduledEvents();

    expect(tables.events.map((e) => e.status)).toEqual(['active', 'scheduled', 'active']);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'event_open', occurred_at: '2026-10-05T11:00:00.000Z', dedupe_key: 'event_open:e1',
      payload: { event_id: 'e1', template_name: 'Lunch Run', reward_xp: 20 },
    });
  });
});

describe('event_closed — participation', () => {
  const participationEvent = (id: string, over: Row = {}): Row => ({
    id, group_id: 'g1', type: 'participation', status: 'active', starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z',
    event_templates: { name: 'Morning Run', icon: 'sun', reward_xp: 25, reward_xp_1st: null }, ...over,
  });

  it('participants = antal event_entries, members = gruppstorlek; occurred_at = ends_at; exakt en rad även vid omkörning', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [],
      events: [participationEvent('e1')],
      event_entries: [{ id: 'n1', event_id: 'e1', user_id: 'a' }, { id: 'n2', event_id: 'e1', user_id: 'b' }, { id: 'n3', event_id: 'other', user_id: 'a' }],
      users: [{ id: 'a', group_id: 'g1' }, { id: 'b', group_id: 'g1' }, { id: 'c', group_id: 'g1' }, { id: 'd', group_id: 'g2' }],
    };
    use(tables);
    await settleExpiredParticipationEvents();
    await settleExpiredParticipationEvents();

    expect(tables.events[0].status).toBe('settled');
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'event_closed', group_id: 'g1', occurred_at: '2026-10-05T10:00:00.000Z', dedupe_key: 'event_closed:e1',
      payload: { event_id: 'e1', event_type: 'participation', template_name: 'Morning Run', participants: 2, members: 3 },
    });
    expect(tables.activity_log[0].payload).not.toHaveProperty('top');
  });

  it('events som redan är settled eller inte har gått ut loggas inte', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [],
      events: [
        participationEvent('done', { status: 'settled' }),
        participationEvent('running', { ends_at: '2026-10-05T18:00:00.000Z' }),
      ],
      event_entries: [], users: [],
    };
    use(tables);
    await settleExpiredParticipationEvents();
    expect(tables.activity_log).toHaveLength(0);
    expect(tables.events.map((e) => e.status)).toEqual(['settled', 'active']);
  });
});

describe('competition-avräkning', () => {
  const competitionTables = (): Record<string, Row[]> => ({
    activity_log: [],
    events: [{
      id: 'e9', group_id: 'g1', type: 'competition', metric: 'km', status: 'active',
      starts_at: '2026-10-04T00:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z',
      event_templates: { name: 'Weekend Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 75, reward_xp_2nd: 45, reward_xp_3rd: 30 },
    }],
    event_entries: [
      { id: 'n1', event_id: 'e9', user_id: 'a' }, { id: 'n2', event_id: 'e9', user_id: 'b' },
    ],
    users: [
      { id: 'a', group_id: 'g1', total_xp: 40, event_xp: 0, current_level: 1 },
      { id: 'b', group_id: 'g1', total_xp: 10, event_xp: 0, current_level: 1 },
      { id: 'c', group_id: 'g1', total_xp: 0, event_xp: 0, current_level: 1 },
    ],
    runs: [
      { id: 'r1', user_id: 'a', date: '2026-10-04', distance: 12, is_treadmill: false },
      { id: 'r2', user_id: 'b', date: '2026-10-05', distance: 5, is_treadmill: false },
    ],
  });

  it('event_closed efter utbetalning: topp 3 med utdelad XP, participants/members; exakt en rad vid omkörning', async () => {
    const tables = competitionTables();
    use(tables);
    await settleCompetitionEvents();
    await settleCompetitionEvents();

    const closed = tables.activity_log.filter((r) => r.type === 'event_closed');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      group_id: 'g1', dedupe_key: 'event_closed:e9', occurred_at: NOW.toISOString(),
      payload: {
        event_id: 'e9', event_type: 'competition', template_name: 'Weekend Km', participants: 2, members: 3,
        top: [{ user_id: 'a', rank: 1, xp: 75 }, { user_id: 'b', rank: 2, xp: 45 }],
      },
    });
    // XP delades ut exakt en gång (claim-vakten) — loggen ändrar inget
    expect(tables.users.find((u) => u.id === 'a')!.event_xp).toBe(75);
  });

  it('level-up via utbetalningen loggas: en rad per nivå, föregående nivå ur samma select', async () => {
    const tables = competitionTables();
    use(tables);
    await settleCompetitionEvents();

    // a: 40 + 75 = 115 → nivå 3 (från 1): level_up 2 och 3. b: 10 + 45 = 55 → nivå 2.
    const levels = tables.activity_log.filter((r) => r.type === 'level_up').map((r) => [r.actor_user_id, r.payload.level]);
    expect(levels).toEqual([['a', 2], ['a', 3], ['b', 2]]);
    expect(tables.users.find((u) => u.id === 'a')!.current_level).toBe(3);
  });

  it('inga deltagare → event_closed med participants 0 (eventet är ändå avslutat)', async () => {
    const tables = competitionTables();
    tables.event_entries = [];
    use(tables);
    await settleCompetitionEvents();
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({ type: 'event_closed', payload: { participants: 0, members: 3, top: [] } });
  });

  it('en trasig logg fäller inte avräkningen (XP delas ut ändå)', async () => {
    const tables = competitionTables();
    const db = createFakeDb(tables, {
      errors: { activity_log: { message: 'relation "activity_log" does not exist' } },
      rpc: {
        increment_event_xp: ({ p_user_id, p_xp }) => {
          const u = tables.users.find((x) => x.id === p_user_id)!;
          u.event_xp += p_xp; u.total_xp += p_xp;
          return { data: null };
        },
      },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
    await expect(settleCompetitionEvents()).resolves.toBeUndefined();
    expect(tables.events[0].status).toBe('settled');
    expect(tables.users.find((u) => u.id === 'a')!.event_xp).toBe(75);
  });
});

describe('participation-XP → level_up (checkEventQualification)', () => {
  it('kvalificering som lyfter nivån loggar level_up med föregående nivå ur samma select', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [],
      events: [{
        id: 'e1', group_id: 'g1', type: 'participation', metric: null, status: 'active',
        starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z',
        event_templates: { min_km: 3, reward_xp: 25 },
      }],
      event_entries: [],
      users: [{ id: 'a', group_id: 'g1', total_xp: 40, event_xp: 0, current_level: 1 }],
    };
    use(tables);
    await checkEventQualification({ userId: 'a', runId: 'r1', runDate: '2026-10-05', distanceKm: 5, groupId: 'g1' });
    await checkEventQualification({ userId: 'a', runId: 'r1', runDate: '2026-10-05', distanceKm: 5, groupId: 'g1' }); // omkörning (fakeDb saknar UNIQUE-vakten; level_up-nyckeln håller ändå)

    // 40 + 25 = 65 → nivå 2
    expect(tables.activity_log.map((r) => [r.type, r.actor_user_id, r.payload.level])).toEqual([['level_up', 'a', 2]]);
    expect(tables.users[0].current_level).toBe(2);
  });

  it('ingen level_up när XP:n inte lyfter nivån', async () => {
    const tables: Record<string, Row[]> = {
      activity_log: [],
      events: [{
        id: 'e1', group_id: 'g1', type: 'participation', metric: null, status: 'active',
        starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z',
        event_templates: { min_km: 3, reward_xp: 5 },
      }],
      event_entries: [],
      users: [{ id: 'a', group_id: 'g1', total_xp: 10, event_xp: 0, current_level: 1 }],
    };
    use(tables);
    await checkEventQualification({ userId: 'a', runId: 'r1', runDate: '2026-10-05', distanceKm: 5, groupId: 'g1' });
    expect(tables.activity_log).toHaveLength(0);
  });
});

describe('checkEventQualification — enforceRunDateWindow (PUT /runs, open-assumptions backend-fråga 7)', () => {
  const eventTables = (): Record<string, Row[]> => ({
    activity_log: [],
    events: [
      { id: 'p1', group_id: 'g1', type: 'participation', metric: null, status: 'active',
        starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z', event_templates: { min_km: 3, reward_xp: 25 } },
      { id: 'c1', group_id: 'g1', type: 'competition', metric: 'km', status: 'active',
        starts_at: '2026-10-03T00:00:00.000Z', ends_at: '2026-10-09T21:55:00.000Z', event_templates: { min_km: null, reward_xp: null } },
    ],
    event_entries: [],
    users: [{ id: 'a', group_id: 'g1', total_xp: 0, event_xp: 0, current_level: 1 }],
  });
  const qualify = (runDate: string, enforceRunDateWindow?: boolean) =>
    checkEventQualification({ userId: 'a', runId: 'r1', runDate, distanceKm: 5, groupId: 'g1', enforceRunDateWindow });

  it('en redigerad runda inom eventets dagar kvalificerar (participation + competition)', async () => {
    const tables = eventTables();
    use(tables);
    await qualify('2026-10-05', true);
    expect(tables.event_entries.map((e) => e.event_id).sort()).toEqual(['c1', 'p1']);
    expect(tables.users[0].event_xp).toBe(25);
  });

  it('en redigerad GAMMAL runda kvalificerar inte ett event som pågår just nu', async () => {
    const tables = eventTables();
    use(tables);
    await qualify('2026-09-20', true);
    expect(tables.event_entries).toHaveLength(0);
    expect(tables.users[0].event_xp).toBe(0);
  });

  it('competition: dagen före eventets första dag nekas, en dag inom perioden registreras', async () => {
    const tables = eventTables();
    use(tables);
    await qualify('2026-10-02', true);
    expect(tables.event_entries).toHaveLength(0);
    await qualify('2026-10-04', true);
    expect(tables.event_entries.map((e) => e.event_id)).toEqual(['c1']); // participation-eventet är bara 10-05
  });

  it('eventdagar räknas i Stockholm-tid (starts_at 22:30 UTC = 00:30 CEST nästa dag)', async () => {
    const tables = eventTables();
    tables.events = [{
      id: 'late', group_id: 'g1', type: 'participation', metric: null, status: 'active',
      starts_at: '2026-10-04T22:30:00.000Z', ends_at: '2026-10-05T10:00:00.000Z', event_templates: { min_km: 3, reward_xp: 10 },
    }];
    use(tables);
    await qualify('2026-10-04', true); // UTC-dagen för starts_at, men eventets första SVENSKA dag är 5 okt
    expect(tables.event_entries).toHaveLength(0);
    await qualify('2026-10-05', true);
    expect(tables.event_entries).toHaveLength(1);
  });

  it('utan flaggan (POST/Strava) är beteendet OFÖRÄNDRAT — ingen datumavgränsning utöver ends_at >= datum', async () => {
    const tables = eventTables();
    use(tables);
    await qualify('2026-09-20');
    expect(tables.event_entries.map((e) => e.event_id).sort()).toEqual(['c1', 'p1']);
  });
});
