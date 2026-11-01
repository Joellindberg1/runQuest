/**
 * Korsflöden över rutterna, genom rutterna själva (HTTP mot app-factoryn, fake-DB):
 *  1. positions mot rank-delta och Standings (users-with-runs) i flera zoner och måndagar kring midnatt: den sista avslutade veckan är
 *     `previous_rank` i rank-delta, den pågående är Standings, och varje vecka stämmer med ett oberoende orakel (Intl, egen komparator).
 *  2. rank-delta mot rank_passed (recordRankPassesForXp) kring midnatt i flera zoner: de två läsningarna av samma liggare är överens.
 * Rena beräkningsfall ligger i packages/shared; här fälls en route som skickar fel zon, fel fönster eller fel veckogräns.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { MS_DAY, MS_MINUTE, STOCKHOLM_TZ, addDays, mondayOf, zoneWallClockToInstant } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { setGroupTimeZoneSource } from '../../utils/groupTimeZone.js';
import { recordRankPassesForXp } from '../../services/rankNews.js';
import app from '../../app.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); setGroupTimeZoneSource(); });

const G = 'g1';

/** Oraklet för kalenderdagen i en zon: Intl, alltså inte samma kod som routen. */
const oracleDay = (iso: string, zone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const useZone = (zone: string | undefined) => setGroupTimeZoneSource(zone ? (groupId) => (groupId === G ? zone : undefined) : undefined);

function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

const NAMES = ['anna', 'Bertil', 'Cecilia', 'åke', 'Dan', 'Eva', 'Filip', 'Greta', 'Hugo', 'Ida', 'Jon', 'Kajsa'];

/**
 * Tolv medlemmar med rundor över 30 veckor och event vars tidpunkter ligger ±1 och ±61 minuter från gruppens midnatt på varje måndag.
 * Skapandedagarna ligger också kring midnatt, och många medlemmar har lika XP (basen är jämna hundratal) så att namn och id avgör.
 */
function buildTables(seed: number, zone: string, nowIso: string) {
  const next = rng(seed);
  const today = oracleDay(nowIso, zone);
  const mondayNow = mondayOf(today);
  const boundaryInstants: string[] = [];
  for (let w = 0; w < 30; w++) {
    const midnight = zoneWallClockToInstant(addDays(mondayNow, -7 * w), 0, 0, zone).getTime();
    for (const minutes of [-61, -1, 0, 1, 61]) boundaryInstants.push(new Date(midnight + minutes * MS_MINUTE).toISOString());
  }
  const users: Row[] = [];
  const runs: Row[] = [];
  const entries: Row[] = [];
  let runCount = 0;
  let eventCount = 0;

  NAMES.forEach((name, i) => {
    const id = `u${String(i).padStart(2, '0')}`;
    const kind = next();
    const created = kind < 0.1 ? null
      : kind < 0.5 ? boundaryInstants[Math.floor(next() * boundaryInstants.length)]!
        : new Date(new Date(nowIso).getTime() - next() * 40 * 7 * MS_DAY).toISOString();
    let earned = 0;

    const runsToAdd = Math.floor(next() * 25);
    for (let k = 0; k < runsToAdd; k++) {
      const day = addDays(mondayNow, -Math.floor(next() * 30 * 7) + (next() < 0.2 ? 7 : 0));
      const xp = 10 + Math.floor(next() * 90);
      runs.push({ id: `r${++runCount}`, user_id: id, date: day > today ? today : day, xp_gained: xp, users: { group_id: G } });
      earned += xp;
    }

    const eventsToAdd = Math.floor(next() * 3);
    for (let k = 0; k < eventsToAdd; k++) {
      const at = boundaryInstants[Math.floor(next() * boundaryInstants.length)]!;
      if (new Date(at).getTime() > new Date(nowIso).getTime()) continue;
      const xp = 50 * (1 + Math.floor(next() * 3));
      const n = ++eventCount;
      entries.push(next() < 0.5
        ? { id: `e${n}`, user_id: id, event_id: `ev${n}`, xp_awarded: xp, qualified_at: null, events: { type: 'competition', ends_at: at, settled_at: at, group_id: G } }
        : { id: `e${n}`, user_id: id, event_id: `ev${n}`, xp_awarded: xp, qualified_at: at, events: { type: 'participation', ends_at: new Date(new Date(at).getTime() + 3 * MS_DAY).toISOString(), settled_at: null, group_id: G } });
      earned += xp;
    }

    const base = next() < 0.4 ? 0 : Math.floor(next() * 4) * 100;
    users.push({ id, name, group_id: G, profile_picture: null, total_xp: base + earned, created_at: created, current_level: 1, total_km: 0, runs: [] });
  });
  return { users, runs, event_entries: entries, user_challenge_tokens: [] as Row[], activity_log: [] as Row[] };
}

type Tables = ReturnType<typeof buildTables>;

/** Veckans placeringar enligt oraklet: bakåträkning ur total_xp, närvaro per skapandedag, komparator xp/namn/id. */
function oraclePositions(tables: Tables, zone: string, weekStart: string): Map<string, number> {
  const boundary = addDays(weekStart, 7);
  const present = tables.users.filter((u) => !u.created_at || oracleDay(u.created_at, zone) < boundary);
  const credited = (userId: string) => {
    let sum = 0;
    for (const r of tables.runs) if (r.user_id === userId && r.date >= boundary) sum += r.xp_gained;
    for (const e of tables.event_entries) {
      if (e.user_id !== userId) continue;
      const at = e.events.type === 'competition' ? (e.events.settled_at ?? e.events.ends_at) : e.qualified_at;
      if (oracleDay(at, zone) >= boundary) sum += e.xp_awarded;
    }
    return sum;
  };
  const rows = present.map((u) => ({ id: u.id as string, name: (u.name as string).toLowerCase(), xp: Math.max(0, u.total_xp - credited(u.id)) }));
  rows.sort((a, b) => (a.xp !== b.xp ? b.xp - a.xp : a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.id < b.id ? -1 : 1));
  return new Map(rows.map((r, i) => [r.id, i + 1]));
}

const ZONES: Array<string | undefined> = [undefined, 'America/New_York', 'Asia/Tokyo'];
// 2026-10-26: dagen efter Stockholms sommartidsslut. 2027-01-04: ISO-vecka 1, fönstret passerar vecka 53 i 2026. 2026-03-30: dagen efter Stockholms sommartidsstart.
const MONDAYS = ['2026-10-26', '2027-01-04', '2026-03-30'];
const OFFSETS_MIN = [-1, 0, 1];
const WINDOWS = [2, 8, 26];

describe('positions against rank-delta and Standings, in the group zone around Monday midnight', () => {
  for (const zone of ZONES) {
    for (const monday of MONDAYS) {
      for (const offset of OFFSETS_MIN) {
        it(`${zone ?? 'default zone'}, ${monday} ${offset >= 0 ? '+' : ''}${offset} min`, async () => {
          const timeZone = zone ?? STOCKHOLM_TZ;
          const now = new Date(zoneWallClockToInstant(monday, 0, 0, timeZone).getTime() + offset * MS_MINUTE);
          useZone(zone);
          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(now);

          const tables = buildTables(7919 + offset + monday.length, timeZone, now.toISOString());
          vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables as any).client as any);
          const token = mintToken({ group_id: G });
          const rankDelta = await server.request('GET', '/api/leaderboard/rank-delta', { token });
          const standings = await server.request('GET', '/api/auth/users-with-runs', { token });
          expect(rankDelta.status).toBe(200);
          expect(standings.status).toBe(200);

          const failures: string[] = [];
          const check = (condition: boolean, message: string) => { if (!condition) failures.push(message); };

          for (const weeks of WINDOWS) {
            vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables as any).client as any);
            const res = await server.request('GET', `/api/leaderboard/positions?weeks=${weeks}`, { token });
            expect(res.status).toBe(200);
            const data = res.body.data;
            const last = data.weeks.length - 1;
            const tag = `weeks=${weeks}`;

            check(data.as_of === oracleDay(now.toISOString(), timeZone), `${tag}: as_of ${data.as_of}`);
            check(data.weeks[last].is_current_week && data.weeks.slice(0, -1).every((w: any) => !w.is_current_week), `${tag}: is_current_week`);
            check(data.weeks[last].start === rankDelta.body.data.as_of, `${tag}: current week ${data.weeks[last].start} != rank-delta as_of ${rankDelta.body.data.as_of}`);
            // veckorna är sammanhängande och slutar vid den pågående; bara ledande veckor utan närvarande får saknas
            const expectedStarts = Array.from({ length: weeks }, (_, k) => addDays(mondayOf(data.as_of), -7 * (weeks - 1 - k)));
            check(JSON.stringify(data.weeks.map((w: any) => w.start)) === JSON.stringify(expectedStarts.slice(weeks - data.weeks.length)), `${tag}: week starts`);

            // Live = Standings: samma ordning som Board, plats = rad, och rank i rank-delta
            check(JSON.stringify(data.runners.map((r: any) => r.user_id)) === JSON.stringify(standings.body.data.map((u: any) => u.id)), `${tag}: runner order != Standings order`);
            data.runners.forEach((r: any, i: number) => {
              const row = rankDelta.body.data.users.find((u: any) => u.user_id === r.user_id);
              check(r.positions[last] === i + 1, `${tag}: live position of ${r.user_id}`);
              check(r.positions[last] === row.rank, `${tag}: live ${r.positions[last]} != rank-delta rank ${row.rank} for ${r.user_id}`);
              if (data.weeks.length >= 2) {
                check(r.positions[last - 1] === row.previous_rank, `${tag}: last finished week ${r.positions[last - 1]} != previous_rank ${row.previous_rank} for ${r.user_id}`);
              }
            });

            // Varje vecka mot oraklet
            data.weeks.forEach((w: any, k: number) => {
              if (w.is_current_week) return;
              const expected = oraclePositions(tables, timeZone, w.start);
              for (const r of data.runners) {
                check(r.positions[k] === (expected.get(r.user_id) ?? null), `${tag}: week ${w.start} ${r.user_id} got ${r.positions[k]}, oracle ${expected.get(r.user_id) ?? null}`);
              }
            });
          }
          expect(failures).toEqual([]);
        });
      }
    }
  }

  it('the scenarios are not trivial: positions change between the last finished and the current week, and some members have no position yet', async () => {
    const zone = 'America/New_York';
    const now = new Date(zoneWallClockToInstant('2026-10-26', 0, 0, zone).getTime() + MS_MINUTE);
    useZone(zone);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    let changed = 0;
    let withoutPosition = 0;
    for (const seed of [7919, 7920, 7921]) {
      vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(buildTables(seed, zone, now.toISOString()) as any).client as any);
      const res = await server.request('GET', '/api/leaderboard/positions?weeks=8', { token: mintToken({ group_id: G }) });
      for (const runner of res.body.data.runners) {
        const p: Array<number | null> = runner.positions;
        if (p[p.length - 2] !== p[p.length - 1]) changed++;
        if (p.includes(null)) withoutPosition++;
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(withoutPosition).toBeGreaterThan(0);
  });

  it('a competition that ended before the window but was settled right after its start still counts: positions and rank-delta agree', async () => {
    // weeks=2: fönstret börjar måndagen 2026-10-26. Tävlingen tog slut 2026-10-12 och avräknades först måndag 00:30 lokal tid, 14 dagar senare.
    const zone = 'Asia/Tokyo';
    const now = new Date(zoneWallClockToInstant('2026-10-26', 12, 0, zone).getTime());
    useZone(zone);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const tables = {
      users: [
        { id: 'u-anna', name: 'Anna', group_id: G, total_xp: 400, created_at: '2026-01-01T08:00:00Z', profile_picture: null },
        { id: 'u-bertil', name: 'Bertil', group_id: G, total_xp: 350, created_at: '2026-01-01T08:00:00Z', profile_picture: null },
      ],
      runs: [] as Row[],
      event_entries: [{
        id: 'e1', user_id: 'u-anna', event_id: 'ev1', xp_awarded: 100, qualified_at: null,
        events: { type: 'competition', ends_at: zoneWallClockToInstant('2026-10-12', 23, 59, zone).toISOString(), settled_at: zoneWallClockToInstant('2026-10-26', 0, 30, zone).toISOString(), group_id: G },
      }],
    };
    const token = mintToken({ group_id: G });
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables).client as any);
    const rankDelta = await server.request('GET', '/api/leaderboard/rank-delta', { token });
    vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(tables).client as any);
    const positions = await server.request('GET', '/api/leaderboard/positions?weeks=2', { token });

    const anna = rankDelta.body.data.users.find((u: any) => u.user_id === 'u-anna');
    expect(anna).toMatchObject({ previous_xp: 300, previous_rank: 2, rank: 1 });
    expect(positions.body.data.runners.find((r: any) => r.user_id === 'u-anna').positions).toEqual([anna.previous_rank, anna.rank]);
  });
});

describe('rank-delta and rank_passed agree on which day an event credit belongs to, in the group zone', () => {
  const NOW = new Date('2026-09-28T14:00:00Z'); // måndag middag i Stockholm, New York och Tokyo
  const EVENTS: Array<{ label: string; type: 'participation' | 'competition'; at: string }> = [
    { label: 'participation Sunday 23:30Z', type: 'participation', at: '2026-09-27T23:30:00Z' },
    { label: 'participation Monday 02:00Z', type: 'participation', at: '2026-09-28T02:00:00Z' },
    { label: 'participation Monday 05:00Z', type: 'participation', at: '2026-09-28T05:00:00Z' },
    { label: 'participation Sunday 21:59:59Z', type: 'participation', at: '2026-09-27T21:59:59Z' },
    { label: 'participation Sunday 22:00:00Z', type: 'participation', at: '2026-09-27T22:00:00Z' },
    { label: 'competition settled Sunday 23:55Z', type: 'competition', at: '2026-09-27T23:55:00Z' },
    { label: 'competition settled Monday 06:00Z', type: 'competition', at: '2026-09-28T06:00:00Z' },
  ];

  for (const zone of ZONES) {
    for (const event of EVENTS) {
      it(`${zone ?? 'default zone'}: ${event.label}`, async () => {
        useZone(zone);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const tables = () => {
          const entry: Row = event.type === 'participation'
            ? { id: 'e1', user_id: 'u-anna', event_id: 'ev1', xp_awarded: 100, qualified_at: event.at, events: { type: 'participation', ends_at: '2026-10-02T21:59:59Z', settled_at: null, group_id: G } }
            : { id: 'e1', user_id: 'u-anna', event_id: 'ev1', xp_awarded: 100, qualified_at: null, events: { type: 'competition', ends_at: event.at, settled_at: event.at, group_id: G } };
          return {
            users: [
              { id: 'u-anna', name: 'Anna', group_id: G, total_xp: 400, created_at: '2026-01-01T08:00:00Z' },
              { id: 'u-bertil', name: 'Bertil', group_id: G, total_xp: 350, created_at: '2026-01-01T08:00:00Z' },
            ],
            runs: [] as Row[],
            event_entries: [entry],
            activity_log: [] as Row[],
          };
        };

        const deltaTables = tables();
        vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(deltaTables as any).client as any);
        const res = await server.request('GET', '/api/leaderboard/rank-delta', { token: mintToken({ group_id: G }) });
        expect(res.status).toBe(200);
        const anna = res.body.data.users.find((u: any) => u.user_id === 'u-anna');

        // Anna gick från 300 till 400 när eventet krediterades: rank_passed ska bara skrivas om det hände efter dygnsskiftet.
        const passTables = tables();
        vi.mocked(getSupabaseClient).mockReturnValue(createFakeDb(passTables as any, { numericIds: ['activity_log'] }).client as any);
        await recordRankPassesForXp('u-anna', G, 300);
        const passes = passTables.activity_log.filter((row: any) => row.type === 'rank_passed');

        const creditedFromToday = oracleDay(event.at, zone ?? STOCKHOLM_TZ) >= '2026-09-28';
        expect(anna.previous_xp).toBe(creditedFromToday ? 300 : 400);
        expect(anna.previous_rank).toBe(creditedFromToday ? 2 : 1);
        expect(passes).toHaveLength(creditedFromToday ? 1 : 0);
        expect(passes.length === 1).toBe(anna.previous_rank === 2 && anna.rank === 1);
      });
    }
  }
});
