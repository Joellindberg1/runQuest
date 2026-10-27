/**
 * GET /api/leaderboard/positions (ADR 007 B11) — route-test med fake-DB.
 * Placeringsreglerna (komparator, närvaro, bakåträkning, beskärning) testas rent i packages/shared (buildPositionHistory);
 * här: HTTP-form, validering av `weeks`, gruppavgränsning, antalet frågor, sidläsning och loggning.
 * Överensstämmelsen med rank-delta och Standings över zoner och midnatt ligger i leaderboard-rank-crossflow.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import type { PositionHistoryApiResponse } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T10:00:00Z')); // torsdag; veckostart 2026-09-28
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); setGroupTimeZoneSource(); });

const G1 = 'group-1';
const G2 = 'group-2';
const WEEKS_ERROR = 'weeks must be an integer between 1 and 26';

function user(id: string, name: string, group_id: string, total_xp: number | null, extra: Row = {}): Row {
  return { id, name, group_id, total_xp, created_at: '2026-01-01T08:00:00Z', profile_picture: null, email: `${id}@example.test`, ...extra };
}
function run(id: string, user_id: string, group_id: string, date: string, xp_gained: number): Row {
  return { id, user_id, date, xp_gained, users: { group_id } };
}
function entryRow(id: string, user_id: string, group_id: string, xp_awarded: number, ev: Row): Row {
  return {
    id, user_id, event_id: `ev-${id}`, xp_awarded,
    qualified_at: ev.qualified_at ?? null,
    events: { type: ev.type, ends_at: ev.ends_at, settled_at: ev.settled_at ?? null, group_id },
  };
}

function useDb(tables: Record<string, Row[]>, options?: Parameters<typeof createFakeDb>[1]) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const token = (group_id: string | null = G1) => mintToken({ group_id });
const get = (path: string, group_id: string | null = G1) => server.request('GET', path, { token: token(group_id) });

/**
 * Med weeks=3 (nu = torsdag 2026-10-01): vecka 0 = 09-14..20 (slutgräns 09-21), vecka 1 = 09-21..27 (slutgräns 09-28), vecka 2 = pågående.
 * Vecka 0: Anna 400-80-100 = 220, Bertil 450-160 = 290, Cecilia saknas (skapad 09-24). Anna ligger före utan event-XP (320 mot 290): eventet avgör.
 * Vecka 1: Anna 400, Bertil 450-100 = 350, Cecilia 100. Pågående: Bertil 450, Anna 400, Cecilia 100.
 */
const scenario = () => ({
  users: [
    user('u-anna', 'Anna', G1, 400),
    user('u-bertil', 'Bertil', G1, 450, { profile_picture: 'https://img/b.png' }),
    user('u-cecilia', 'Cecilia', G1, 100, { created_at: '2026-09-24T09:00:00Z' }),
    user('u-x', 'Främling', G2, 9999),
  ],
  runs: [
    run('r1', 'u-bertil', G1, '2026-09-29', 100),
    run('r2', 'u-bertil', G1, '2026-09-22', 60),
    run('r3', 'u-anna', G1, '2026-09-23', 80),
    run('r0', 'u-anna', G1, '2026-09-10', 40), // före fönstret
    run('rx', 'u-x', G2, '2026-09-29', 500),
  ],
  event_entries: [
    entryRow('e1', 'u-anna', G1, 100, { type: 'participation', qualified_at: '2026-09-22T10:00:00Z', ends_at: '2026-10-02T21:59:59Z' }),
    entryRow('ex', 'u-x', G2, 300, { type: 'participation', qualified_at: '2026-09-29T10:00:00Z', ends_at: '2026-10-02T21:59:59Z' }),
  ],
});

describe('GET /api/leaderboard/positions', () => {
  it('kräver token (401)', async () => {
    const res = await server.request('GET', '/api/leaderboard/positions');
    expect(res.status).toBe(401);
  });

  it('positions returns the empty shape without a group and makes no database call', async () => {
    const db = useDb(scenario());
    const res = await get('/api/leaderboard/positions', null);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { as_of: '2026-10-01', weeks: [], runners: [] } } satisfies PositionHistoryApiResponse);
    expect(db.queries).toHaveLength(0);
  });

  it('svarar {success,data} i kontraktsformen, äldst först, med live-placeringen sist och löparna i Standings ordning', async () => {
    useDb(scenario());
    const res = await get('/api/leaderboard/positions?weeks=3');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        as_of: '2026-10-01',
        weeks: [
          { start: '2026-09-14', end: '2026-09-20', iso_week: 38, iso_year: 2026, is_current_week: false },
          { start: '2026-09-21', end: '2026-09-27', iso_week: 39, iso_year: 2026, is_current_week: false },
          { start: '2026-09-28', end: '2026-10-04', iso_week: 40, iso_year: 2026, is_current_week: true },
        ],
        runners: [
          { user_id: 'u-bertil', name: 'Bertil', profile_picture: 'https://img/b.png', member_since: '2026-01-01', positions: [1, 2, 1] },
          { user_id: 'u-anna', name: 'Anna', profile_picture: null, member_since: '2026-01-01', positions: [2, 1, 2] },
          { user_id: 'u-cecilia', name: 'Cecilia', profile_picture: null, member_since: '2026-09-24', positions: [null, 3, 3] },
        ],
      },
    } satisfies PositionHistoryApiResponse);
  });

  it('positions response contains no email anywhere', async () => {
    const db = useDb(scenario());
    const res = await get('/api/leaderboard/positions?weeks=3');

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('@');
    expect(body).not.toContain('email');
    for (const runner of res.body.data.runners) {
      expect(Object.keys(runner).sort()).toEqual(['member_since', 'name', 'positions', 'profile_picture', 'user_id']);
    }
    // och routen ber inte ens om kolumnen
    expect(db.queries.find((q) => q.table === 'users')!.select).not.toMatch(/email/);
  });

  describe('weeks', () => {
    it.each([
      ['0', 'weeks=0'],
      ['27', 'weeks=27'],
      ['abc', 'weeks=abc'],
      ['2.5', 'weeks=2.5'],
      ['a repeated parameter', 'weeks=3&weeks=4'],
      ['an empty value', 'weeks='],
      ['a negative number', 'weeks=-1'],
      ['exponent notation', 'weeks=1e1'],
    ])('400 invalid_request for weeks = %s, and the database is not touched', async (_label, query) => {
      const db = useDb(scenario());
      const res = await get(`/api/leaderboard/positions?${query}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: WEEKS_ERROR, code: 'invalid_request' });
      expect(db.queries).toHaveLength(0);
    });

    it('validates weeks before the group check, so a bad value is a 400 also without a group', async () => {
      const db = useDb(scenario());
      const res = await get('/api/leaderboard/positions?weeks=0', null);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(WEEKS_ERROR);
      expect(db.queries).toHaveLength(0);
    });

    it('defaults to 8 weeks: seven finished and the current one', async () => {
      const db = useDb(scenario());
      const res = await get('/api/leaderboard/positions');
      expect(res.status).toBe(200);
      const weeks = res.body.data.weeks;
      expect(weeks).toHaveLength(8);
      expect(weeks[0].start).toBe('2026-08-10');
      expect(weeks[7]).toMatchObject({ start: '2026-09-28', is_current_week: true });
      expect(weeks.filter((w: any) => w.is_current_week)).toHaveLength(1);
      expect(res.body.data.runners.every((r: any) => r.positions.length === 8)).toBe(true);
      // fönstret börjar vid den äldsta avslutade veckans slutgräns: måndagen 2026-08-17
      expect(db.queries.find((q) => q.table === 'runs')!.filters).toContainEqual({ op: 'gte', column: 'date', value: '2026-08-17' });
    });

    it('accepts the largest value, 26 weeks, and 1', async () => {
      useDb(scenario());
      const max = await get('/api/leaderboard/positions?weeks=26');
      expect(max.status).toBe(200);
      expect(max.body.data.weeks).toHaveLength(26);
      expect(max.body.data.weeks[0].start).toBe('2026-04-06');

      useDb(scenario());
      const min = await get('/api/leaderboard/positions?weeks=1');
      expect(min.status).toBe(200);
      expect(min.body.data.weeks).toHaveLength(1);
    });

    it('weeks=1 gives only the current week and skips the run and event reads', async () => {
      const db = useDb(scenario());
      const res = await get('/api/leaderboard/positions?weeks=1');

      expect(res.status).toBe(200);
      expect(res.body.data.weeks).toEqual([{ start: '2026-09-28', end: '2026-10-04', iso_week: 40, iso_year: 2026, is_current_week: true }]);
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([
        ['u-bertil', [1]], ['u-anna', [2]], ['u-cecilia', [3]],
      ]);
      expect(db.queries.map((q) => q.table)).toEqual(['users']);
    });

    it('a group younger than the window gets fewer weeks, and the current week is always there', async () => {
      const t = scenario();
      t.users = t.users.map((u) => (u.group_id === G1 ? { ...u, created_at: '2026-09-23T09:00:00Z' } : u)); // alla skapade vecka 39
      useDb(t);
      const res = await get('/api/leaderboard/positions?weeks=26');
      expect(res.status).toBe(200);
      expect(res.body.data.weeks.map((w: any) => w.start)).toEqual(['2026-09-21', '2026-09-28']);
    });
  });

  describe('group scope', () => {
    it('never shows another group: its members, runs and events are neither listed nor counted', async () => {
      useDb(scenario());
      const res = await get('/api/leaderboard/positions?weeks=3');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('u-x');
      expect(body).not.toContain('Främling');
      // G2:s 9999 XP hade annars gett u-x första plats och flyttat alla andra ett steg ner
      expect(res.body.data.runners.map((r: any) => r.user_id)).toEqual(['u-bertil', 'u-anna', 'u-cecilia']);
      expect(res.body.data.runners[0].positions).toEqual([1, 2, 1]);
    });

    it("the other group sees its own data and none of the first group's", async () => {
      useDb(scenario());
      const res = await get('/api/leaderboard/positions?weeks=3', G2);
      expect(res.status).toBe(200);
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([['u-x', [1, 1, 1]]]);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('u-anna');
      expect(body).not.toContain('Bertil');
    });

    it('sets the group filter on all three reads, with the window and the event tail', async () => {
      const db = useDb(scenario());
      await get('/api/leaderboard/positions?weeks=3');
      const by = (table: string) => db.queries.filter((q) => q.table === table);
      expect(by('users')).toHaveLength(1);
      expect(by('runs')).toHaveLength(1);
      expect(by('event_entries')).toHaveLength(1);
      expect(by('users')[0].filters).toContainEqual({ op: 'eq', column: 'group_id', value: G1 });
      // b_0 = slutgränsen för den äldsta avslutade veckan = 2026-09-21
      expect(by('runs')[0].select).toContain('users!inner(group_id)');
      expect(by('runs')[0].filters).toContainEqual({ op: 'eq', column: 'users.group_id', value: G1 });
      expect(by('runs')[0].filters).toContainEqual({ op: 'gte', column: 'date', value: '2026-09-21' });
      expect(by('event_entries')[0].select).toContain('events!inner(');
      expect(by('event_entries')[0].filters).toContainEqual({ op: 'eq', column: 'events.group_id', value: G1 });
      // 14-dagarssvansen: Stockholms midnatt 2026-09-07 (sommartid, UTC+2)
      expect(by('event_entries')[0].filters).toContainEqual({ op: 'gte', column: 'events.ends_at', value: '2026-09-06T22:00:00.000Z' });
      expect(by('event_entries')[0].filters).toContainEqual({ op: 'gt', column: 'xp_awarded', value: 0 });
    });

    it("starts the event tail at the midnight of the group's zone, not at UTC midnight", async () => {
      setGroupTimeZoneSource((groupId) => (groupId === G1 ? 'America/New_York' : undefined));
      const db = useDb(scenario());
      await get('/api/leaderboard/positions?weeks=3');
      const entries = db.queries.find((q) => q.table === 'event_entries')!;
      // 2026-09-07 00:00 i New York (UTC-4) = 04:00Z
      expect(entries.filters).toContainEqual({ op: 'gte', column: 'events.ends_at', value: '2026-09-07T04:00:00.000Z' });
    });
  });

  describe('query count and paging', () => {
    function groupOf(members: number): Record<string, Row[]> {
      const users: Row[] = [];
      const runs: Row[] = [];
      const event_entries: Row[] = [];
      for (let i = 0; i < members; i++) {
        const id = `u-${String(i).padStart(2, '0')}`;
        users.push(user(id, `Runner ${String(i).padStart(2, '0')}`, G1, 300 + i * 10));
        runs.push(run(`r-${id}`, id, G1, '2026-09-29', 20));
        event_entries.push(entryRow(`e-${id}`, id, G1, 15, { type: 'participation', qualified_at: '2026-09-30T08:00:00Z', ends_at: '2026-10-02T21:59:59Z' }));
      }
      return { users, runs, event_entries };
    }

    it('makes the same number of database queries for 3 and for 12 members: one per table', async () => {
      const three = useDb(groupOf(3));
      const small = await get('/api/leaderboard/positions');
      const twelve = useDb(groupOf(12));
      const large = await get('/api/leaderboard/positions');

      expect(small.body.data.runners).toHaveLength(3);
      expect(large.body.data.runners).toHaveLength(12);
      expect(three.queries).toHaveLength(3);
      expect(twelve.queries).toHaveLength(three.queries.length);
      expect(twelve.queries.map((q) => q.table).sort()).toEqual(['event_entries', 'runs', 'users']);
    });

    it('reads more than 1000 runs in pages ordered by date and id, and answers from all of them', async () => {
      // 2 500 rundor à 1 XP efter gränsen 2026-09-28. Annas total är 2 900, Bertils 1 500:
      // läses bara 1 000 eller 2 000 rader ligger Anna kvar före Bertil i förra veckan (1 900 / 2 400 mot 1 500); läses alla är hon på 400 och Bertil först.
      const runs: Row[] = [];
      for (let i = 0; i < 2500; i++) runs.push(run(`r${String(2500 - i).padStart(4, '0')}`, 'u-anna', G1, i % 2 === 0 ? '2026-09-29' : '2026-09-30', 1));
      const db = useDb({
        users: [user('u-anna', 'Anna', G1, 2900), user('u-bertil', 'Bertil', G1, 1500)],
        runs,
        event_entries: [],
      });

      const res = await get('/api/leaderboard/positions?weeks=2');

      expect(res.status).toBe(200);
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([
        ['u-anna', [2, 1]],
        ['u-bertil', [1, 2]],
      ]);
      const runQueries = db.queries.filter((q) => q.table === 'runs');
      expect(runQueries.map((q) => q.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
      for (const q of runQueries) expect(q.order).toEqual([{ column: 'date', ascending: true }, { column: 'id', ascending: true }]);
      expect(db.queries).toHaveLength(1 + 3 + 1); // users, tre sidor rundor, en sida event
    });

    it('a run count that is an exact multiple of the page size does not fail on the empty page that follows', async () => {
      const runs: Row[] = [];
      for (let i = 0; i < 1000; i++) runs.push(run(`r${String(i).padStart(4, '0')}`, 'u-anna', G1, '2026-09-29', 1));
      const db = useDb({
        users: [user('u-anna', 'Anna', G1, 1400), user('u-bertil', 'Bertil', G1, 1100)],
        runs,
        event_entries: [],
      });

      const res = await get('/api/leaderboard/positions?weeks=2');

      expect(res.status).toBe(200);
      // vecka 0: Anna 400, Bertil 1 100
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([['u-anna', [2, 1]], ['u-bertil', [1, 2]]]);
      expect(db.queries.filter((q) => q.table === 'runs').map((q) => q.range)).toEqual([[0, 999], [1000, 1999]]);
    });

    it('reads event entries in pages ordered by id too', async () => {
      const event_entries: Row[] = [];
      for (let i = 0; i < 1200; i++) {
        event_entries.push(entryRow(`e${String(i).padStart(4, '0')}`, 'u-anna', G1, 1, { type: 'participation', qualified_at: '2026-09-30T08:00:00Z', ends_at: '2026-10-02T21:59:59Z' }));
      }
      const db = useDb({
        users: [user('u-anna', 'Anna', G1, 1500), user('u-bertil', 'Bertil', G1, 400)],
        runs: [],
        event_entries,
      });

      const res = await get('/api/leaderboard/positions?weeks=2');

      // Vecka 0: Anna 1 500 - 1 200 = 300 mot Bertils 400, alltså Bertil först. Läses bara första sidan blir Anna 500 och ligger före.
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([['u-anna', [2, 1]], ['u-bertil', [1, 2]]]);
      const entryQueries = db.queries.filter((q) => q.table === 'event_entries');
      expect(entryQueries.map((q) => q.range)).toEqual([[0, 999], [1000, 1999]]);
      for (const q of entryQueries) expect(q.order).toEqual([{ column: 'id', ascending: true }]);
    });
  });

  describe('data handling', () => {
    it('a competition that ended before the window but was settled inside it still counts, from its settlement day (the 14 day tail)', async () => {
      // weeks=2: b_0 = 2026-09-28. Tävlingen tog slut 2026-09-20 men avräknades först måndag 09-28 01:00 (Stockholm, 2026-09-27T23:00Z).
      // Den ligger i svansen (från 09-14) och ska räknas bort ur veckan som slutade: Anna 400 - 100 = 300 < Bertil 350.
      useDb({
        users: [user('u-anna', 'Anna', G1, 400), user('u-bertil', 'Bertil', G1, 350)],
        runs: [],
        event_entries: [
          entryRow('e1', 'u-anna', G1, 100, { type: 'competition', ends_at: '2026-09-20T21:59:59Z', settled_at: '2026-09-27T23:00:00Z' }),
        ],
      });
      const res = await get('/api/leaderboard/positions?weeks=2');
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([['u-anna', [2, 1]], ['u-bertil', [1, 2]]]);
    });

    it('a member without total_xp counts as 0: equal XP is decided by name, and nothing becomes NaN or a 500', async () => {
      useDb({
        users: [user('u-anna', 'Anna', G1, 100), user('u-bertil', 'Bertil', G1, 0), user('u-aaron', 'Aaron', G1, null)],
        runs: [],
        event_entries: [],
      });
      const res = await get('/api/leaderboard/positions?weeks=2');
      expect(res.status).toBe(200);
      expect(res.body.data.runners.map((r: any) => [r.user_id, r.positions])).toEqual([
        ['u-anna', [1, 1]], ['u-aaron', [2, 2]], ['u-bertil', [3, 3]],
      ]);
    });

    it('the group zone decides the week: Sunday 23:30 UTC is already Monday in Stockholm but still Sunday in New York', async () => {
      vi.setSystemTime(new Date('2026-10-04T23:30:00Z'));
      const tables = () => ({ users: [user('u-anna', 'Anna', G1, 100)], runs: [], event_entries: [] });
      setGroupTimeZoneSource((groupId) => (groupId === G1 ? 'Europe/Stockholm' : undefined));
      useDb(tables());
      const stockholm = await get('/api/leaderboard/positions?weeks=1');
      setGroupTimeZoneSource((groupId) => (groupId === G1 ? 'America/New_York' : undefined));
      useDb(tables());
      const newYork = await get('/api/leaderboard/positions?weeks=1');

      expect(stockholm.body.data.as_of).toBe('2026-10-05');
      expect(stockholm.body.data.weeks[0].start).toBe('2026-10-05');
      expect(newYork.body.data.as_of).toBe('2026-10-04');
      expect(newYork.body.data.weeks[0].start).toBe('2026-09-28');
    });

    it('dates event XP in the group zone: the same entry is credited on different days in Stockholm and New York', async () => {
      // Söndag 2026-09-27 23:30Z = måndag 01:30 i Stockholm (krediterad från 09-28), söndag 19:30 i New York (krediterad före 09-28).
      const tables = () => ({
        users: [user('u-anna', 'Anna', G1, 400), user('u-bertil', 'Bertil', G1, 350)],
        runs: [],
        event_entries: [entryRow('e1', 'u-anna', G1, 100, { type: 'participation', qualified_at: '2026-09-27T23:30:00Z', ends_at: '2026-10-02T21:59:59Z' })],
      });
      const annaIn = async (zone: string) => {
        setGroupTimeZoneSource((groupId) => (groupId === G1 ? zone : undefined));
        useDb(tables());
        const res = await get('/api/leaderboard/positions?weeks=2');
        return res.body.data.runners.find((r: any) => r.user_id === 'u-anna').positions;
      };
      expect(await annaIn('Europe/Stockholm')).toEqual([2, 1]); // 400 - 100 = 300 < 350 i veckan som slutade
      expect(await annaIn('America/New_York')).toEqual([1, 1]); // krediteringen ligger före gränsen och räknas inte bort
    });

    it('logs a warning when the ledger exceeds total_xp, like rank-delta, and still answers', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      useDb({
        users: [user('u-anna', 'Anna', G1, 100), user('u-bertil', 'Bertil', G1, 50)],
        runs: [run('r1', 'u-anna', G1, '2026-09-29', 500), run('r2', 'u-bertil', G1, '2026-09-29', 500)],
        event_entries: [],
      });
      const res = await get('/api/leaderboard/positions?weeks=2');
      expect(res.status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe('⚠️ positions: XP-liggaren överstiger total_xp för 2 användare (u-anna, u-bertil) — previous_xp klampad till 0');
    });

    it('logs nothing when the ledger agrees with total_xp', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      useDb(scenario());
      await get('/api/leaderboard/positions?weeks=3');
      expect(warn).not.toHaveBeenCalled();
    });

    it('500 with the fixed text and no leaked detail on a database error', async () => {
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      useDb(scenario(), { errors: { event_entries: { message: 'relation "event_entries" secret detail' } } });
      const res = await get('/api/leaderboard/positions?weeks=3');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Failed to fetch position history', code: 'internal_error' });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });
  });
});
