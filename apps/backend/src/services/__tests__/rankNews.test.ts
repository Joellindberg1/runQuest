/**
 * rank_passed för måttet xp (ADR 011 beslut 6): recordRankPassesForXp läser gruppen, dagens runs och dagens event_entries, bygger
 * liggaren med samma buildXpLedger + buildRankDelta som GET /leaderboard/rank-delta (asOf = idag), och skriver via activityLog.
 * Beteendetest mot fakeDb; själva korsningsreglerna är enhetstestade i packages/shared (rankPasses.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
// Spion runt den riktiga detektionen: "ett fel i detektionen" och "samma ögonblick" kräver att testet når in i anropet.
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  return { ...actual, detectRankPasses: vi.fn(actual.detectRankPasses) };
});

import { activityKeys, detectRankPasses } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { recordRankPassesForXp } from '../rankNews.js';

const G = 'g1';
const TODAY = '2026-10-15';
const YESTERDAY = '2026-10-14';
const NOW = new Date('2026-10-15T10:00:00.000Z'); // 12:00 i Stockholm

const user = (id: string, name: string, total_xp: number, over: Row = {}): Row => (
  { id, name, group_id: G, total_xp, created_at: '2026-01-01T08:00:00.000Z', ...over }
);
const runOf = (id: string, user_id: string, date: string, xp_gained: number): Row => ({ id, user_id, date, xp_gained });

function world(users: Row[], runs: Row[] = [], extra: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = { users, runs, event_entries: [], activity_log: [], ...(extra as Record<string, Row[]>) };
  return tables;
}

function use(tables: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const rankRows = (t: Record<string, Row[]>) => t.activity_log.filter((r) => r.type === 'rank_passed');
const setXp = (t: Record<string, Row[]>, id: string, xp: number) => { t.users.find((u) => u.id === id)!.total_xp = xp; };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('recordRankPassesForXp', () => {
  it('en runda som tar W förbi M (som låg före vid dygnsskiftet) skriver exakt en rank_passed med rätt aktör, mål och rangerna efter', async () => {
    // W (Anna) 100 → 130 med en runda idag på 30; M (Bertil) 120. Vid dygnsskiftet: W 100, M 120.
    const t = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120), user('u-c', 'Cecilia', 50), user('u-x', 'Xavier', 500, { group_id: 'g2' })],
      [runOf('r1', 'u-w', TODAY, 30), runOf('r0', 'u-m', YESTERDAY, 20), runOf('rx', 'u-x', TODAY, 400)],
    );
    use(t);

    await recordRankPassesForXp('u-w', G, 100);

    expect(rankRows(t)).toHaveLength(1);
    expect(rankRows(t)[0]).toMatchObject({
      type: 'rank_passed', group_id: G, actor_user_id: 'u-w', target_user_id: 'u-m', is_backfill: false,
      occurred_at: NOW.toISOString(), dedupe_key: `rank_passed:xp:u-w:u-m:${TODAY}`,
    });
    // Rangerna EFTER passeringen, och ingen XP-siffra i payloaden (ADR 011 beslut 13.3).
    expect(rankRows(t)[0].payload).toEqual({ measure: 'xp', passer_rank: 1, passed_rank: 2 });
  });

  it('en andra runda samma dag ger ingen dubblett', async () => {
    const t = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)],
      [runOf('r1', 'u-w', TODAY, 30)],
    );
    use(t);
    await recordRankPassesForXp('u-w', G, 100);

    // Andra rundan: W 130 → 150. M ligger redan bakom, så ingen korsning; samma anrop som förra gången upprepas också.
    setXp(t, 'u-w', 150);
    t.runs.push(runOf('r2', 'u-w', TODAY, 20));
    await recordRankPassesForXp('u-w', G, 130);
    await recordRankPassesForXp('u-w', G, 100); // omkörning/överlappande instans: nyckeln håller

    expect(rankRows(t)).toHaveLength(1);
  });

  it('pingis: W förbi M, M förbi W, W förbi M ger en rad', async () => {
    const t = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)],
      [runOf('rw1', 'u-w', TODAY, 30)],
    );
    use(t);
    await recordRankPassesForXp('u-w', G, 100); // kl 10: W förbi M
    expect(rankRows(t)).toHaveLength(1);

    // kl 14: M tar tillbaka platsen (160 mot W:s 130). M låg FÖRE W vid dygnsskiftet (120 mot 100): ingen rad.
    setXp(t, 'u-m', 160);
    t.runs.push(runOf('rm1', 'u-m', TODAY, 40));
    await recordRankPassesForXp('u-m', G, 120);
    expect(rankRows(t)).toHaveLength(1);

    // kl 18: W förbi M igen (180 mot 160). Samma nyckel som kl 10: ingen ny rad.
    setXp(t, 'u-w', 180);
    t.runs.push(runOf('rw2', 'u-w', TODAY, 50));
    await recordRankPassesForXp('u-w', G, 130);

    expect(rankRows(t).map((r) => [r.actor_user_id, r.target_user_id])).toEqual([['u-w', 'u-m']]);
  });

  it('W som inte låg bakom M vid dygnsskiftet ger ingen rad', async () => {
    // Anna 110 ligger före Bertil 100 vid dygnsskiftet. Bertil tar sig förbi (rad för Bertil), Anna tar tillbaka platsen: ingen rad för Anna.
    const t = world(
      [user('u-w', 'Anna', 110), user('u-m', 'Bertil', 130)],
      [runOf('rm1', 'u-m', TODAY, 30)],
    );
    use(t);
    await recordRankPassesForXp('u-m', G, 100);
    expect(rankRows(t).map((r) => [r.actor_user_id, r.target_user_id])).toEqual([['u-m', 'u-w']]);

    setXp(t, 'u-w', 135);
    t.runs.push(runOf('rw1', 'u-w', TODAY, 25));
    await recordRankPassesForXp('u-w', G, 110);

    expect(rankRows(t).map((r) => [r.actor_user_id, r.target_user_id])).toEqual([['u-m', 'u-w']]);
  });

  it('en runda daterad igår som synkas efter midnatt ger ingen rad (utebliven notis, aldrig falsk)', async () => {
    // Känd begränsning: liggaren är datumbaserad, så rundans XP räknas som krediterad före dygnsskiftet (W "låg redan före M").
    const t = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)],
      [runOf('r1', 'u-w', YESTERDAY, 30)],
    );
    use(t);

    await recordRankPassesForXp('u-w', G, 100);

    expect(rankRows(t)).toHaveLength(0);
  });

  it('en minskning av XP skapar ingen rad och retractar dagens rader för de M som W åter ligger bakom', async () => {
    // W (Anna) låg på 130 efter en passering idag, men rundan raderades: nu 100. M (Bertil) 120 ligger åter före, C (Cecilia) 90 inte.
    const key = (m: string, day: string) => activityKeys.rankPassed('xp', 'u-w', m, day);
    const row = (id: number, dedupe_key: string): Row => ({ id, type: 'rank_passed', group_id: G, actor_user_id: 'u-w', dedupe_key });
    const t = world(
      [user('u-w', 'Anna', 100), user('u-m', 'Bertil', 120), user('u-c', 'Cecilia', 90)],
      [],
      {
        activity_log: [
          row(1, key('u-m', TODAY)),       // ska bort
          row(2, key('u-m', YESTERDAY)),   // äldre dag: historia, rörs inte
          row(3, key('u-c', TODAY)),       // W ligger fortfarande före C: stämmer fortfarande
        ],
      },
    );
    use(t);

    await recordRankPassesForXp('u-w', G, 130);

    expect(t.activity_log.map((r) => r.dedupe_key)).toEqual([key('u-m', YESTERDAY), key('u-c', TODAY)]);
  });

  it('retract_only skriver aldrig nya rader, även när W har passerat någon, men retractar vid en minskning', async () => {
    // Ökning: samma värld som den första testet. 'full' skulle skriva en rad; retract_only skriver ingen.
    const gain = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)],
      [runOf('r1', 'u-w', TODAY, 30)],
    );
    use(gain);
    await recordRankPassesForXp('u-w', G, 100, { mode: 'retract_only' });
    expect(rankRows(gain)).toHaveLength(0);

    // Minskning: dagens rad för M som W åter ligger bakom retractas, äldre dagars rad rörs inte.
    const key = (day: string) => activityKeys.rankPassed('xp', 'u-w', 'u-m', day);
    const drop = world(
      [user('u-w', 'Anna', 100), user('u-m', 'Bertil', 120)],
      [],
      { activity_log: [{ id: 1, type: 'rank_passed', dedupe_key: key(TODAY) }, { id: 2, type: 'rank_passed', dedupe_key: key(YESTERDAY) }] },
    );
    use(drop);
    await recordRankPassesForXp('u-w', G, 130, { mode: 'retract_only' });
    expect(drop.activity_log.map((r) => r.dedupe_key)).toEqual([key(YESTERDAY)]);
  });

  it('lika XP avgörs av namn och id', async () => {
    // W går från 90 till 100 (runda idag på 10) och hamnar på lika XP med M (100, ingen runda idag). W låg bakom vid dygnsskiftet (90 mot 100).
    const passes = async (w: [string, string], m: [string, string]) => {
      const t = world([user(w[0], w[1], 100), user(m[0], m[1], 100)], [runOf('r1', w[0], TODAY, 10)]);
      use(t);
      await recordRankPassesForXp(w[0], G, 90);
      return rankRows(t);
    };

    // Namn stigande: Anna före Bertil, så W (Anna) tar platsen vid lika XP...
    const byName = await passes(['u-w', 'Anna'], ['u-m', 'Bertil']);
    expect(byName).toHaveLength(1);
    expect(byName[0].payload).toEqual({ measure: 'xp', passer_rank: 1, passed_rank: 2 });
    // ...men inte W (Zelda).
    expect(await passes(['u-w', 'Zelda'], ['u-m', 'Bertil'])).toHaveLength(0);
    // Skiftlägesokänsligt: "anna" före "BERTIL".
    expect(await passes(['u-w', 'anna'], ['u-m', 'BERTIL'])).toHaveLength(1);
    // Samma namn (utan hänsyn till skiftläge): id avgör.
    expect(await passes(['u-a', 'Anna'], ['u-b', 'anna'])).toHaveLength(1);
    expect(await passes(['u-b', 'Anna'], ['u-a', 'anna'])).toHaveLength(0);
  });

  it('en medlem skapad efter dygnsskiftet passerar och passeras inte samma dag', async () => {
    // Importerad historik: rundorna är daterade igår, så de nya medlemmarnas XP ser "krediterad före dygnsskiftet" ut.
    const created = '2026-10-15T06:00:00.000Z'; // 08:00 i Stockholm, idag

    const passed = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120, { created_at: created })],
      [runOf('r1', 'u-w', TODAY, 30), runOf('rm', 'u-m', YESTERDAY, 120)],
    );
    use(passed);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(passed)).toHaveLength(0); // M fanns inte vid dygnsskiftet: W passerar inte M

    const passer = world(
      [user('u-w', 'Anna', 130, { created_at: created }), user('u-m', 'Bertil', 120)],
      [runOf('r1', 'u-w', TODAY, 30), runOf('rw0', 'u-w', YESTERDAY, 100)],
    );
    use(passer);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(passer)).toHaveLength(0); // W fanns inte vid dygnsskiftet: W passerar ingen
  });

  it('diverged liggare hoppar över paret', async () => {
    // W:s liggare (200 idag) överstiger total_xp 130 -> previous_xp klampas till 0, och W SKULLE se ut att ha legat bakom M.
    const wDiverged = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)],
      [runOf('r1', 'u-w', TODAY, 200)],
    );
    use(wDiverged);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(wDiverged)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();

    // M:s liggare överstiger M:s total_xp: paret W–M hoppas över, men W passerar fortfarande C.
    const mDiverged = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120), user('u-c', 'Cecilia', 110)],
      [runOf('r1', 'u-w', TODAY, 30), runOf('rm', 'u-m', TODAY, 200)],
    );
    use(mDiverged);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(mDiverged).map((r) => r.target_user_id)).toEqual(['u-c']);

    // Klampningen gör M:s ställning vid dygnsskiftet 0, vilket annars skulle läsas som att Zed (0 vid dygnsskiftet) låg bakom Anna.
    const pairOnly = world(
      [user('u-w', 'Zed', 30), user('u-m', 'Anna', 20)],
      [runOf('r1', 'u-w', TODAY, 30), runOf('rm', 'u-m', TODAY, 50)],
    );
    use(pairOnly);
    await recordRankPassesForXp('u-w', G, 0);
    expect(rankRows(pairOnly)).toHaveLength(0);
  });

  it('ett fel i detektionen kastar aldrig', async () => {
    const t = world([user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)], [runOf('r1', 'u-w', TODAY, 30)]);
    use(t);

    // 1. detektionen själv kastar
    vi.mocked(detectRankPasses).mockImplementationOnce(() => { throw new Error('secret-detector-detail'); });
    await expect(recordRankPassesForXp('u-w', G, 100)).resolves.toBeUndefined();

    // 2. databasen svarar med fel (radvärden i meddelandet får aldrig loggas)
    use(t, { failWhen: (q) => (q.table === 'runs' ? { message: 'secret row values', code: 'XX000' } as any : null) });
    await expect(recordRankPassesForXp('u-w', G, 100)).resolves.toBeUndefined();

    // 3. klienten kastar redan vid uppslag
    vi.mocked(getSupabaseClient).mockImplementation(() => { throw new Error('no client'); });
    await expect(recordRankPassesForXp('u-w', G, 100)).resolves.toBeUndefined();

    expect(rankRows(t)).toHaveLength(0); // inga rader på ett läsfel
    expect(logger.error).toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain('secret');
  });
});

describe('recordRankPassesForXp — vilka anrop som kostar något', () => {
  const twoMembers = () => world([user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)], [runOf('r1', 'u-w', TODAY, 30)]);

  it('en XP-vinst kostar högst tre läsningar: medlemmar, dagens runs och dagens event_entries', async () => {
    const db = use(twoMembers());
    await recordRankPassesForXp('u-w', G, 100);
    expect(db.queries.filter((q) => q.table !== 'activity_log').map((q) => q.table).sort()).toEqual(['event_entries', 'runs', 'users']);
    // Bara DAGENS runs läses (inte historiken), och bara gruppens egna event_entries.
    expect(db.queries.find((q) => q.table === 'runs')!.filters).toContainEqual({ op: 'gte', column: 'date', value: TODAY });
    expect(db.queries.find((q) => q.table === 'event_entries')!.filters).toContainEqual({ op: 'eq', column: 'events.group_id', value: G });
  });

  it('saknad grupp eller föregående värde: noll queries', async () => {
    const db = use(twoMembers());
    await recordRankPassesForXp('u-w', null, 100);
    await recordRankPassesForXp('u-w', undefined, 100);
    await recordRankPassesForXp('u-w', G, null);
    await recordRankPassesForXp('u-w', G, undefined);
    expect(db.queries).toHaveLength(0);
  });

  it('en grupp med en enda medlem läser bara medlemmarna', async () => {
    const t = world([user('u-w', 'Anna', 130)], [runOf('r1', 'u-w', TODAY, 30)]);
    const db = use(t);
    await recordRankPassesForXp('u-w', G, 100);
    expect(db.queries.map((q) => q.table)).toEqual(['users']);
  });

  it('oförändrad XP skriver ingenting och läser inte liggaren', async () => {
    const t = twoMembers();
    const db = use(t);
    await recordRankPassesForXp('u-w', G, 130);
    expect(db.queries.map((q) => q.table)).toEqual(['users']);
    expect(t.activity_log).toHaveLength(0);
  });
});

describe('recordRankPassesForXp — dygnsskiftets ställning ur samma liggare som rank-delta', () => {
  it('event-XP som krediterats idag räknas in; en avräkning från förra veckan gör det inte', async () => {
    const entry = (id: string, type: 'participation' | 'competition', xp: number, ev: Row): Row => ({
      id, user_id: 'u-w', event_id: `ev-${id}`, xp_awarded: xp, qualified_at: ev.qualified_at ?? null,
      events: { type, ends_at: ev.ends_at, settled_at: ev.settled_at ?? null, group_id: G },
    });
    const users = () => [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)];

    // participation: kvalificerad idag 09:00 Stockholm (+30) -> W:s ställning vid dygnsskiftet är 100
    const participation = world(users(), [], {
      event_entries: [entry('e1', 'participation', 30, { qualified_at: '2026-10-15T07:00:00.000Z', ends_at: '2026-10-15T20:00:00.000Z' })],
    });
    use(participation);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(participation)).toHaveLength(1);

    // competition avräknad 00:05 idag (22:05Z igår) med ends_at kvällen före: datum = settled_at -> krediterad idag
    const competition = world(users(), [], {
      event_entries: [entry('e2', 'competition', 30, { ends_at: '2026-10-14T21:59:59.000Z', settled_at: '2026-10-14T22:05:00.000Z' })],
    });
    use(competition);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(competition)).toHaveLength(1);

    // avräknad förra veckan: krediterad före dygnsskiftet -> W låg redan på 130 vid dygnsskiftet, ingen rad
    const lastWeek = world(users(), [], {
      event_entries: [entry('e3', 'competition', 30, { ends_at: '2026-10-11T21:59:59.000Z', settled_at: '2026-10-11T22:05:00.000Z' })],
    });
    use(lastWeek);
    await recordRankPassesForXp('u-w', G, 100);
    expect(rankRows(lastWeek)).toHaveLength(0);
  });

  it('samma ögonblick för dagen och för occurred_at: nyckeln stämmer med detektionens även över Stockholms midnatt', async () => {
    // 23:59:59.999 i Stockholm. Klockan går över midnatt mitt i anropet: delades "nu" i två läsningar skulle nycklarna skilja sig åt.
    const before = new Date('2026-10-14T21:59:59.999Z');
    vi.setSystemTime(before);
    const t = world(
      [user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)],
      [runOf('r1', 'u-w', YESTERDAY, 30)], // idag (för anropet) är 2026-10-14
    );
    use(t);
    const actual = (await vi.importActual<typeof import('@runquest/shared')>('@runquest/shared')).detectRankPasses;
    vi.mocked(detectRankPasses).mockImplementationOnce((input) => {
      vi.setSystemTime(new Date('2026-10-14T22:00:00.001Z')); // nu är det 2026-10-15 i Stockholm
      return actual(input);
    });

    await recordRankPassesForXp('u-w', G, 100);

    const [pass] = vi.mocked(detectRankPasses).mock.results[0].value.passes;
    expect(pass.dedupeKey).toBe(`rank_passed:xp:u-w:u-m:${YESTERDAY}`);
    expect(rankRows(t)).toHaveLength(1);
    expect(rankRows(t)[0].dedupe_key).toBe(pass.dedupeKey);
    expect(rankRows(t)[0].occurred_at).toBe(before.toISOString());
  });
});
