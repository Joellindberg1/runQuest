/**
 * RUN-141 — group-eligibility ska räkna med SAMMA vinterfönster som de lagrade innehavarna, dvs. med klockan
 * från gruppens senaste titelomräkning (max title_leaderboard.updated_at för gruppen, ADR 012 beslut 5.6), inte med request-tiden.
 * Annars visar "Best so far" den nya vinterns värden från 1 december medan lagrade innehavare byter vinter först vid nästa omräkning.
 * Klockan är per grupp: en annan grupps omräkning flyttar den inte.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(() => holder.client),
}));

import app from '../../app.js';
import { enhancedTitleService } from '../../services/enhancedTitleService.js';
import { createFakeDb } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

// 1 december, 10:00 i Stockholm — första dagen i den nya vintern.
const DEC_1 = new Date('2026-12-01T09:00:00Z');
const LAST_WINTER_RUN = { id: 'r1', user_id: 'user-1', date: '2026-02-10', distance: 12, start_time: null, total_elevation_gain: null, pace_std_dev: null, moving_time: null, run_weather: null };
const NEW_WINTER_RUN = { id: 'r2', user_id: 'user-1', date: '2026-12-01', distance: 3, start_time: null, total_elevation_gain: null, pace_std_dev: null, moving_time: null, run_weather: null };

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); // bara klockan — riktiga timers behövs för HTTP-servern
  vi.setSystemTime(DEC_1);
});
afterEach(() => { vi.useRealTimers(); });

/** En rad ur en grupps topplista; updated_at är när gruppens topplista för titeln senast byggdes om. */
function lb(updated_at: string | null, group_id = 'group-1', title_id = 't-1') {
  return { group_id, title_id, user_id: 'user-1', position: 1, value: 1, earned_at: '2026-11-01T00:00:00Z', updated_at };
}

function seed(
  leaderboard: Array<Record<string, unknown>>,
  options: Parameters<typeof createFakeDb>[1] = {},
  titles: Array<Record<string, unknown>> = [],
) {
  const db = createFakeDb({
    users: [{ id: 'user-1', name: 'Alice', group_id: 'group-1', total_km: 15, longest_streak: 1, gender: 'female' }],
    group_members: [{ group_id: 'group-1', user_id: 'user-1', starts_on: null, left_at: null }],
    runs: [LAST_WINTER_RUN, NEW_WINTER_RUN],
    title_leaderboard: leaderboard,
    titles,
  }, options);
  holder.client = db.client;
  return db;
}

async function winterKmFromEndpoint(): Promise<number> {
  const res = await server.request('GET', '/api/titles/group-eligibility', { token: mintToken({ user_id: 'user-1' }) });
  expect(res.status).toBe(200);
  return res.body.data[0].values.winterKm;
}

describe('GET /api/titles/group-eligibility — klockan', () => {
  it('1 dec, senaste omräkningen 30 nov: samma vinter som de lagrade innehavarna (förra), inte den nya', async () => {
    seed([
      lb('2026-11-30T12:00:00Z', 'group-1', 't-old'),
      lb('2026-11-12T08:00:00Z', 'group-1', 't-older'),
    ]);

    expect(await winterKmFromEndpoint()).toBe(12); // förra vintern (2025-12-01 – 2026-03-01), inte 3 km ur den nya
  });

  it('eligibility och en omräkning med samma klocka ger samma winterKm (lagrad innehavare = eligibility)', async () => {
    seed([lb('2026-11-30T12:00:00Z', 'group-1', 't-old')]);

    // Den lagrade innehavarens värde: omräkningen 30 nov räknade med den dagens klocka.
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'));
    const stored = enhancedTitleService.calculateUserValues(
      [LAST_WINTER_RUN, NEW_WINTER_RUN].map((r) => ({ ...r, distance_km: r.distance })), 15, 1,
    ).winterKm;
    vi.setSystemTime(DEC_1);

    expect(await winterKmFromEndpoint()).toBe(stored);
  });

  it('1 dec, omräkningen har körts (gruppens topplista byggd 1 dec): den nya vintern, som omräkningen räknade', async () => {
    seed([
      lb('2026-11-30T12:00:00Z', 'group-1', 't-old'),
      lb('2026-12-01T07:30:00Z', 'group-1', 't-new'),
    ]);

    expect(await winterKmFromEndpoint()).toBe(3);
  });

  it('klockan är max(updated_at) över gruppens topplistor, oberoende av radordning', async () => {
    seed([
      lb('2026-12-01T07:30:00Z', 'group-1', 'a'),
      lb('2026-11-01T07:30:00Z', 'group-1', 'b'),
    ]);
    expect(await winterKmFromEndpoint()).toBe(3);
  });

  it('klampen: updated_at efter request-tid (2 dec när nu är 1 dec) ger request-tid, alltså nya vintern', async () => {
    seed([lb('2026-12-02T09:00:00Z', 'group-1', 'future')]);
    // Utan klampen skulle klockan stå på 2 dec; båda ligger i nya vintern, så ett datum före 1 dec visar att klampen inte släpper igenom framtiden
    expect(await winterKmFromEndpoint()).toBe(3);

    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'));
    seed([lb('2026-12-02T09:00:00Z', 'group-1', 'future')]);
    expect(await winterKmFromEndpoint()).toBe(12); // request-tid 30 nov = förra vintern, inte framtida 2 dec
  });

  it('inga topplistor att läsa klocka ur → request-tiden (oförändrat beteende)', async () => {
    seed([]);
    expect(await winterKmFromEndpoint()).toBe(3);
  });

  it('topplistor utan giltig tidsstämpel → request-tiden', async () => {
    seed([lb(null, 'group-1', 'a'), lb('inte-ett-datum', 'group-1', 'b')]);
    expect(await winterKmFromEndpoint()).toBe(3);
  });

  it('en topplistrad utan tidsstämpel hindrar inte gruppens giltiga klocka', async () => {
    seed([lb('2026-11-30T12:00:00Z', 'group-1', 'b'), lb(null, 'group-1', 'a')]);
    expect(await winterKmFromEndpoint()).toBe(12);
  });

  it('klockläsningen misslyckas → svaret kommer ändå, med request-tiden (eligibility är en bonus)', async () => {
    seed([lb('2026-11-30T12:00:00Z', 'group-1', 'a')], { errors: { title_leaderboard: { message: 'boom' } } });
    expect(await winterKmFromEndpoint()).toBe(3);
  });

  it('en annan grupps omräkning 1 dec flyttar inte min grupps klocka', async () => {
    seed([
      lb('2026-11-30T12:00:00Z', 'group-1', 't-1'),
      lb('2026-12-01T07:30:00Z', 'group-2', 't-1'),
    ]);

    expect(await winterKmFromEndpoint()).toBe(12); // gruppens egen omräkning var 30 nov, grupp 2:s 1 dec ska inte räknas
  });

  it('titles.updated_at, som alla grupper delar, är inte längre klockans källa', async () => {
    seed(
      [lb('2026-11-30T12:00:00Z', 'group-1', 't-1')],
      {},
      [{ id: 't-1', metric_key: 'totalKm', updated_at: '2026-12-01T07:30:00Z' }],
    );

    expect(await winterKmFromEndpoint()).toBe(12);
  });

  it('gruppen har ingen topplista men en annan grupp har → request-tiden, inte den andra gruppens klocka', async () => {
    seed([lb('2026-11-30T12:00:00Z', 'group-2', 't-1')]);

    expect(await winterKmFromEndpoint()).toBe(3);
  });
});
