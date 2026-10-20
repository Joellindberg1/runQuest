/**
 * Tävlingstabellen i API:t: namnet är det riktiga och "det är jag" är flaggan `isMe` (inget lokaliserat namn), och live-tabellen
 * (GET /api/events) och avräkningen (settleCompetitionEvents) rankar samma data lika, även vid lika totaler.
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
vi.mock('../../services/levelService.js', () => ({
  getLevelFromXP: vi.fn(async () => 1),
}));

import { getSupabaseClient } from '../../config/database.js';
import app from '../../app.js';
import { settleCompetitionEvents } from '../../services/eventService.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
afterEach(() => { vi.clearAllMocks(); });

const G1 = 'group-1';
const ME = 'u-anna';
const token = () => mintToken({ user_id: ME, group_id: G1 });

function useDb(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, {
    autoIds: true,
    numericIds: ['activity_log'],
    rpc: {
      increment_event_xp: ({ p_user_id, p_xp }) => {
        const u = tables.users.find((x) => x.id === p_user_id);
        if (u) { u.event_xp = (u.event_xp ?? 0) + p_xp; u.total_xp = (u.total_xp ?? 0) + p_xp; }
        return { data: null };
      },
    },
  });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
  return db;
}

const template = { name: 'Weekly Km', icon: 'trophy', description: 'Most km', min_km: 0, reward_xp: null, reward_xp_1st: 40, reward_xp_2nd: 30, reward_xp_3rd: 20, requires_weather: null };
const people = (): Row[] => [
  { id: ME, name: 'Anna Andersson', group_id: G1, total_xp: 0, event_xp: 0, current_level: 1 },
  { id: 'u-bertil', name: 'Bertil Berg', group_id: G1, total_xp: 0, event_xp: 0, current_level: 1 },
  { id: 'u-cecilia', name: 'Cecilia Cederberg', group_id: G1, total_xp: 0, event_xp: 0, current_level: 1 },
  { id: 'u-david', name: 'David Dahl', group_id: G1, total_xp: 0, event_xp: 0, current_level: 1 },
];
const run = (user_id: string, distance: number): Row => ({ id: `r-${user_id}`, user_id, date: '2026-10-14', distance, total_elevation_gain: 0, is_treadmill: false });

const liveCompetition = (status = 'active'): Row => ({
  id: 'ev-c', group_id: G1, type: 'competition', metric: 'km', status,
  starts_at: '2026-10-12T00:00:00Z', ends_at: '2026-10-18T21:55:00Z', event_templates: template,
});
const entryOf = (user_id: string, extra: Row = {}): Row => ({ id: `n-${user_id}`, event_id: 'ev-c', user_id, rank: null, xp_awarded: null, qualified_at: '2026-10-13T09:00:00Z', total_value: null, ...extra });

describe('GET /api/events — competition leaderboard', () => {
  it('sends the real name and isMe for the caller, never a localized name', async () => {
    useDb({
      users: people(), events: [liveCompetition()],
      event_entries: [entryOf(ME), entryOf('u-bertil')],
      runs: [run(ME, 10), run('u-bertil', 20)],
    });
    const res = await server.request('GET', '/api/events', { token: token() });

    const rows = res.body.events[0].leaderboard;
    expect(rows.map((r: Row) => [r.userName, r.isMe, r.rank])).toEqual([['Bertil Berg', false, 1], ['Anna Andersson', true, 2]]);
    expect(res.body.data.events[0].leaderboard).toEqual(rows);
  });
});

describe('GET /api/events/history — leaderboards', () => {
  it('sends the real name and isMe for the caller in competition and participation events alike', async () => {
    useDb({
      users: people(),
      events: [
        { ...liveCompetition('settled') },
        { id: 'ev-p', group_id: G1, type: 'participation', metric: 'km', status: 'settled', starts_at: '2026-10-05T00:00:00Z', ends_at: '2026-10-05T23:00:00Z', event_templates: { ...template, reward_xp: 25 } },
      ],
      event_entries: [
        entryOf(ME, { rank: 2, total_value: 10, xp_awarded: 30 }),
        entryOf('u-bertil', { rank: 1, total_value: 20, xp_awarded: 40 }),
        { id: 'p-me', event_id: 'ev-p', user_id: ME, rank: null, xp_awarded: 25, qualified_at: '2026-10-05T09:00:00Z', total_value: null },
      ],
    });
    const res = await server.request('GET', '/api/events/history', { token: token() });

    const byId = Object.fromEntries(res.body.events.map((e: Row) => [e.id, e]));
    expect(byId['ev-c'].leaderboard.map((r: Row) => [r.userName, r.isMe])).toEqual([['Bertil Berg', false], ['Anna Andersson', true]]);
    const everyone = byId['ev-p'].leaderboard as Row[];
    expect(everyone.map((r) => [r.userName, r.isMe])).toEqual([
      ['Anna Andersson', true], ['Bertil Berg', false], ['Cecilia Cederberg', false], ['David Dahl', false],
    ]);
  });
});

describe('live table and settlement', () => {
  it('rank the same data the same way when totals are equal', async () => {
    const tables: Record<string, Row[]> = {
      users: people(),
      events: [liveCompetition()],
      // Listade i en ordning som inte är namnordningen, så att en tie-break på inläsningsordning skulle synas.
      event_entries: [entryOf('u-david'), entryOf('u-cecilia'), entryOf(ME), entryOf('u-bertil')],
      runs: [run('u-david', 12), run('u-cecilia', 12), run(ME, 12), run('u-bertil', 30)],
    };
    useDb(tables);

    const live = await server.request('GET', '/api/events', { token: token() });
    const liveRanking = live.body.events[0].leaderboard.map((r: Row) => [r.userId, r.rank]);

    await settleCompetitionEvents();
    const settledRanking = [...tables.event_entries].sort((a, b) => a.rank - b.rank).map((e) => [e.user_id, e.rank]);

    expect(liveRanking).toEqual([['u-bertil', 1], [ME, 2], ['u-cecilia', 3], ['u-david', 4]]);
    expect(settledRanking).toEqual(liveRanking);
  });
});
