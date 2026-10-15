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
import { recordRankPassesForChallenge, recordRankPassesForXp } from '../rankNews.js';

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

  it('en minskning retractar dagens rad även när M:s liggare är diverged', async () => {
    // M:s liggare (200 idag) överstiger hans total_xp 120: paret hoppas över för NYA rader, men retract bygger på före/efter, inte på
    // dygnsskiftet, så raden som W:s minskning gjort felaktig ska bort ändå.
    const key = (day: string) => activityKeys.rankPassed('xp', 'u-w', 'u-m', day);
    const t = world(
      [user('u-w', 'Anna', 100), user('u-m', 'Bertil', 120)],
      [runOf('rm', 'u-m', TODAY, 200)],
      { activity_log: [{ id: 1, type: 'rank_passed', dedupe_key: key(TODAY) }, { id: 2, type: 'rank_passed', dedupe_key: key(YESTERDAY) }] },
    );
    use(t);

    await recordRankPassesForXp('u-w', G, 130);

    expect(t.activity_log.map((r) => r.dedupe_key)).toEqual([key(YESTERDAY)]);
  });

  it('en minskning retractar dagens rad även när W:s egen liggare är diverged, utan att skriva nya rader', async () => {
    // W:s runda idag (200 XP) överstiger hennes total_xp 100: diverged. Minskningen 130 -> 100 lägger henne åter bakom M (120).
    const key = (day: string) => activityKeys.rankPassed('xp', 'u-w', 'u-m', day);
    const t = world(
      [user('u-w', 'Anna', 100), user('u-m', 'Bertil', 120), user('u-c', 'Cecilia', 50)],
      [runOf('rw', 'u-w', TODAY, 200)],
      { activity_log: [{ id: 1, type: 'rank_passed', dedupe_key: key(TODAY) }, { id: 2, type: 'rank_passed', dedupe_key: key(YESTERDAY) }] },
    );
    use(t);

    await recordRankPassesForXp('u-w', G, 130);

    expect(t.activity_log.map((r) => r.dedupe_key)).toEqual([key(YESTERDAY)]);
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

  it('ett läsfel på medlemmarna loggar bara koden, aldrig felobjektet eller dess meddelande', async () => {
    const t = world([user('u-w', 'Anna', 130), user('u-m', 'Bertil', 120)], [runOf('r1', 'u-w', TODAY, 30)]);
    use(t, { failWhen: (q) => (q.table === 'users' ? { message: 'secret member row values', code: 'XX001' } as any : null) });

    await expect(recordRankPassesForXp('u-w', G, 100)).resolves.toBeUndefined();

    expect(rankRows(t)).toHaveLength(0);
    const lines = vi.mocked(logger.error).mock.calls;
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain('secret');
    expect(JSON.stringify(lines)).toContain('XX001');
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

// ─── challenge_points ─────────────────────────────────────────────────────────────────────────────

describe('recordRankPassesForChallenge', () => {
  const MIDNIGHT = '2026-10-14T22:00:00.000Z'; // Stockholm 00:00 den 15 oktober (CEST)
  const EARLIER_TODAY = '2026-10-15T05:00:00.000Z';
  const BEFORE_MIDNIGHT = '2026-10-14T21:59:59.999Z';

  const player = (id: string, name: string, wins: number, draws: number, losses: number, over: Row = {}): Row => (
    { id, name, group_id: G, wins, draws, losses, total_xp: 0, created_at: '2026-01-01T08:00:00.000Z', ...over }
  );
  /** challenge_won (aktör = vinnaren, mål = förloraren) eller challenge_draw (aktör = utmanaren, mål = motståndaren). */
  const settled = (cid: string, type: 'challenge_won' | 'challenge_draw', actor: string, target: string, occurred_at: string, over: Row = {}): Row => (
    { id: cid, group_id: G, type, actor_user_id: actor, target_user_id: target, dedupe_key: activityKeys.challengeSettled(cid), occurred_at, ...over }
  );
  const challengeOf = (id: string, challenger: string, opponent: string, over: Row = {}): Row => (
    { id, group_id: G, status: 'completed', challenger_id: challenger, opponent_id: opponent, ...over }
  );
  const duel = (users: Row[], log: Row[], challenges: Row[] = [challengeOf('c1', 'u-w', 'u-l')]) => (
    { users, challenges, activity_log: log } as Record<string, Row[]>
  );
  const rows = (t: Record<string, Row[]>) => rankRows(t).map((r) => [r.actor_user_id, r.target_user_id]);
  const detectInput = (call = 0) => vi.mocked(detectRankPasses).mock.calls[call][0] as any;
  const valuesOf = (input: any) => Object.fromEntries(input.members.map((m: any) => [m.id, { midnight: m.midnight, before: m.before, after: m.after }]));

  it('poäng vid dygnsskiftet är nuvarande W/D/L minus utfall avgjorda sedan dygnsskiftet', async () => {
    const rec = (wins: number, draws: number, losses: number) => ({ wins, draws, losses });
    const t = duel(
      [
        player('a', 'Anna', 3, 0, 1),
        player('b', 'Bertil', 1, 1, 2),
        player('c', 'Cecilia', 5, 1, 3),
        player('d', 'David', 0, 0, 0),
        player('x', 'Xavier', 9, 0, 0, { group_id: 'g2' }),
      ],
      [
        settled('c0', 'challenge_won', 'a', 'c', EARLIER_TODAY),                  // a vann idag: a.wins och c.losses
        settled('cd', 'challenge_draw', 'b', 'c', EARLIER_TODAY),                 // oavgjort idag: draws åt båda
        settled('cold', 'challenge_won', 'c', 'a', BEFORE_MIDNIGHT),              // IGÅR: ingår i dygnsskiftets ställning
        settled('cx', 'challenge_won', 'a', 'c', EARLIER_TODAY, { group_id: 'g2' }), // annan grupp: ska inte räknas
        settled('c1', 'challenge_won', 'a', 'b', NOW.toISOString()),              // denna avgörande: a vann, b förlorade
      ],
      [challengeOf('c1', 'a', 'b')],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(detectRankPasses).toHaveBeenCalledTimes(1);
    const input = detectInput();
    expect(input).toMatchObject({ measure: 'challenge_points', passerId: 'a', today: TODAY });
    expect(valuesOf(input)).toEqual({
      // a: minus c1 (vinst) och c0 (vinst) vid dygnsskiftet; före avgörandet minus bara c1
      a: { midnight: rec(1, 0, 1), before: rec(2, 0, 1), after: rec(3, 0, 1) },
      // b: minus c1 (förlust) och cd (oavgjort); FÖRLORARENS värde härleds ur challenge_won-radens mål
      b: { midnight: rec(1, 0, 1), before: rec(1, 1, 1), after: rec(1, 1, 2) },
      // c: minus c0 (förlust) och cd (oavgjort); oförändrad av avgörandet
      c: { midnight: rec(5, 0, 2), before: rec(5, 1, 3), after: rec(5, 1, 3) },
      d: { midnight: rec(0, 0, 0), before: rec(0, 0, 0), after: rec(0, 0, 0) },
    });
  });

  it('läser bara avgöranden sedan dygnsskiftet i den egna gruppen', async () => {
    const t = duel([player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1)], [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())]);
    const db = use(t);

    await recordRankPassesForChallenge('c1');

    const q = db.queries.find((x) => x.table === 'activity_log' && x.select !== null)!;
    expect(q.filters).toContainEqual({ op: 'eq', column: 'group_id', value: G });
    expect(q.filters).toContainEqual({ op: 'gte', column: 'occurred_at', value: MIDNIGHT });
    expect(q.filters).toContainEqual({ op: 'in', column: 'type', value: ['challenge_won', 'challenge_draw'] });
  });

  it('vinnaren som tar en plats från en tredje medlem skriver en rank_passed med rangerna efter', async () => {
    // W 0-0-0 → 1-0-0 (1,0). C 1-1-0 (0,75) ligger före W vid dygnsskiftet (W hade inte spelat) men bakom efter.
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(rankRows(t)).toHaveLength(1);
    expect(rankRows(t)[0]).toMatchObject({
      type: 'rank_passed', group_id: G, actor_user_id: 'u-w', target_user_id: 'u-c', is_backfill: false,
      occurred_at: NOW.toISOString(), dedupe_key: `rank_passed:challenge_points:u-w:u-c:${TODAY}`,
    });
    expect(rankRows(t)[0].payload).toEqual({ measure: 'challenge_points', passer_rank: 1, passed_rank: 2 });
  });

  it('lika poäng och vinster avgörs av namn och id', async () => {
    // W vinner mot X och hamnar på 0,5 med 1 vinst, precis som M (1-0-1). W låg bakom M vid dygnsskiftet (0-0-1 mot 1-0-1).
    const passes = async (w: [string, string], m: [string, string]) => {
      const t = duel(
        [player(w[0], w[1], 1, 0, 1), player(m[0], m[1], 1, 0, 1), player('u-x', 'Xavier', 0, 0, 1)],
        [settled('c1', 'challenge_won', w[0], 'u-x', NOW.toISOString())],
        [challengeOf('c1', w[0], 'u-x')],
      );
      use(t);
      await recordRankPassesForChallenge('c1');
      return rankRows(t);
    };

    const byName = await passes(['u-w', 'Anna'], ['u-m', 'Bertil']);
    expect(byName).toHaveLength(1);
    expect(byName[0].payload).toEqual({ measure: 'challenge_points', passer_rank: 1, passed_rank: 2 });
    expect(await passes(['u-w', 'Zelda'], ['u-m', 'Bertil'])).toHaveLength(0);
    expect(await passes(['u-w', 'anna'], ['u-m', 'BERTIL'])).toHaveLength(1); // skiftlägesokänsligt
    expect(await passes(['u-a', 'Anna'], ['u-b', 'anna'])).toHaveLength(1);    // samma namn: id avgör
    expect(await passes(['u-b', 'Anna'], ['u-a', 'anna'])).toHaveLength(0);

    // Lika poäng men fler vinster går före namnet: Zelda 2-0-2 (0,5, 2 vinster) mot Anna 1-0-1 (0,5, 1 vinst).
    const wins = duel(
      [player('u-w', 'Zelda', 2, 0, 2), player('u-m', 'Anna', 1, 0, 1), player('u-x', 'Xavier', 0, 0, 1)],
      [settled('c1', 'challenge_won', 'u-w', 'u-x', NOW.toISOString())],
      [challengeOf('c1', 'u-w', 'u-x')],
    );
    use(wins);
    await recordRankPassesForChallenge('c1');
    expect(rows(wins)).toEqual([['u-w', 'u-m']]);
  });

  it('en förlorare körs aldrig genom detektionen, men passeras av vinnaren om hen låg före', async () => {
    // L 3-0-1 (0,75) → 3-0-2 (0,6) och W 0-0-0 → 1-0-0: W tar platsen från motståndaren L.
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 3, 0, 2)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(vi.mocked(detectRankPasses).mock.calls.map((c) => (c[0] as any).passerId)).toEqual(['u-w']);
    expect(rows(t)).toEqual([['u-w', 'u-l']]);
  });

  it('oavgjort kör detektionen för båda deltagarna', async () => {
    const t = duel(
      [player('u-w', 'Anna', 0, 1, 2), player('u-l', 'Bertil', 0, 1, 1), player('u-c', 'Cecilia', 1, 0, 3)],
      [settled('c1', 'challenge_draw', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(vi.mocked(detectRankPasses).mock.calls.map((c) => (c[0] as any).passerId).sort()).toEqual(['u-l', 'u-w']);
    // Båda är oavgjort-uppdaterade: dygnsskiftets värde är 0-0-2 respektive 0-0-1 för dem.
    expect(valuesOf(detectInput(0))['u-w'].midnight).toEqual({ wins: 0, draws: 0, losses: 2 });
    expect(valuesOf(detectInput(0))['u-l'].midnight).toEqual({ wins: 0, draws: 0, losses: 1 });
  });

  it('ingen rad om avgörandets egen rad saknas i loggen', async () => {
    // Utan raden skulle dygnsskiftets ställning räkna avgörandet som redan inräknat och ge fel värden.
    const t = duel([player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)], []);
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(detectRankPasses).not.toHaveBeenCalled();
    expect(rankRows(t)).toHaveLength(0);
  });

  it('ingen rad om loggraden pekar på andra än utmaningens deltagare', async () => {
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 1)],
      [settled('c1', 'challenge_won', 'u-w', 'u-c', NOW.toISOString())], // utmaningen gäller u-w mot u-l
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(detectRankPasses).not.toHaveBeenCalled();
    expect(rankRows(t)).toHaveLength(0);
  });

  it('en avräkning från före dygnsskiftet räknas inte som sin egen rad', async () => {
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', BEFORE_MIDNIGHT)],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(detectRankPasses).not.toHaveBeenCalled();
    expect(rankRows(t)).toHaveLength(0);
  });

  it('en medlem vars W/D/L går under noll efter subtraktionen hoppas över, resten passerar som vanligt', async () => {
    // C:s ställning är 0-0-0 men dagens rader säger att C förlorat en match: ingenting går att lita på för C.
    // Utan guarden skulle C se ut att ligga före W (som inte spelat) vid dygnsskiftet, och W (0-0-0 → 1-0-0) ha passerat C. Med den hoppas paret över.
    const t = duel(
      [player('u-w', 'Zelda', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 0, 0, 0), player('u-d', 'David', 1, 1, 0)],
      [
        settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString()),
        settled('c9', 'challenge_won', 'u-d', 'u-c', EARLIER_TODAY),
      ],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(valuesOf(detectInput())['u-c'].midnight).toBeNull();
    expect(rows(t)).toEqual([['u-w', 'u-d'], ['u-w', 'u-l']]); // C (diverged) saknas bland de passerade
    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('Cecilia');
  });

  it('en medlem vars vinster eller oavgjorda går under noll efter subtraktionen hoppas över', async () => {
    // Cecilia står på 0 vinster men dagens logg säger att hon vunnit en match (och 4-0-0 med en oavgjord i loggen för draws).
    // Utan vakten skulle hennes negativa term ge ett påhittat dygnsskifte och en rad åt Anna.
    const wins = duel(
      [player('a', 'Aaron', 1, 0, 0), player('b', 'Bertil', 0, 0, 1), player('c', 'Cecilia', 0, 3, 0)],
      [settled('c1', 'challenge_won', 'a', 'b', NOW.toISOString()), settled('e1', 'challenge_won', 'c', 'x', EARLIER_TODAY)],
      [challengeOf('c1', 'a', 'b')],
    );
    use(wins);
    await recordRankPassesForChallenge('c1');
    expect(valuesOf(detectInput(0))['c'].midnight).toBeNull();
    expect(rankRows(wins)).toHaveLength(0);

    const draws = duel(
      [player('a', 'Aaron', 4, 0, 0), player('b', 'Bertil', 0, 0, 1), player('c', 'Cecilia', 4, 0, 0)],
      [settled('c1', 'challenge_won', 'a', 'b', NOW.toISOString()), settled('e1', 'challenge_draw', 'c', 'x', EARLIER_TODAY)],
      [challengeOf('c1', 'a', 'b')],
    );
    use(draws);
    await recordRankPassesForChallenge('c1');
    expect(valuesOf(detectInput(1))['c'].midnight).toBeNull();
    expect(rankRows(draws)).toHaveLength(0);
  });

  it('en medlem skapad idag passerar och passeras inte samma dag', async () => {
    const createdToday = '2026-10-15T06:00:00.000Z'; // 08:00 i Stockholm

    // M fanns inte vid dygnsskiftet: W passerar inte M, även om M:s räknare ser ut att ha funnits.
    const passed = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-m', 'Cecilia', 1, 1, 0, { created_at: createdToday })],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(passed);
    await recordRankPassesForChallenge('c1');
    expect(rows(passed)).toEqual([]);

    // W fanns inte vid dygnsskiftet: W passerar ingen.
    const passer = duel(
      [player('u-w', 'Anna', 1, 0, 0, { created_at: createdToday }), player('u-l', 'Bertil', 0, 0, 1), player('u-m', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(passer);
    await recordRankPassesForChallenge('c1');
    expect(rows(passer)).toEqual([]);
  });

  it('dygnsskiftet följer Stockholms sommar- och vintertid', async () => {
    // [nu, Stockholmsdag, dygnsskiftets ögonblick]: höstens byte till vintertid (25 oktober) och vårens till sommartid (29 mars).
    const cases: Array<[string, string, string]> = [
      ['2026-10-25T22:30:00.000Z', '2026-10-25', '2026-10-24T22:00:00.000Z'], // 23:30 sommartid
      ['2026-10-25T23:30:00.000Z', '2026-10-26', '2026-10-25T23:00:00.000Z'], // 00:30 vintertid, redan nästa dag
      ['2026-03-29T10:00:00.000Z', '2026-03-29', '2026-03-28T23:00:00.000Z'],
      ['2026-03-29T22:30:00.000Z', '2026-03-30', '2026-03-29T22:00:00.000Z'], // 00:30 sommartid, redan nästa dag
    ];
    for (const [now, day, dayStart] of cases) {
      vi.setSystemTime(new Date(now));
      const t = duel(
        [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
        [settled('c1', 'challenge_won', 'u-w', 'u-l', now)],
      );
      const db = use(t);

      await recordRankPassesForChallenge('c1');

      const read = db.queries.find((q) => q.table === 'activity_log' && q.select !== null)!;
      expect(read.filters, now).toContainEqual({ op: 'gte', column: 'occurred_at', value: dayStart });
      expect(rankRows(t).map((r) => r.dedupe_key), now).toEqual([`rank_passed:challenge_points:u-w:u-c:${day}`]);
    }
  });

  it('en dubbelkörning av samma avgörande ger ingen dubblett', async () => {
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(t);

    await recordRankPassesForChallenge('c1');
    await recordRankPassesForChallenge('c1');

    expect(rankRows(t)).toHaveLength(1);
  });

  it('samma ögonblick för dagen, gränsen och occurred_at: nyckeln stämmer med detektionens över Stockholms midnatt', async () => {
    const before = new Date('2026-10-14T21:59:59.999Z'); // 23:59:59.999 den 14:e i Stockholm
    vi.setSystemTime(before);
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', before.toISOString())],
    );
    // Klockan passerar midnatt mitt i läsningarna: allt som läser klockan efter det skulle se den 15:e.
    use(t, {
      failWhen: (q) => {
        if (q.table === 'activity_log' && q.select) vi.setSystemTime(new Date('2026-10-14T22:00:00.001Z'));
        return null;
      },
    });

    await recordRankPassesForChallenge('c1');

    const [pass] = vi.mocked(detectRankPasses).mock.results[0].value.passes;
    expect(pass.dedupeKey).toBe('rank_passed:challenge_points:u-w:u-c:2026-10-14');
    expect(rankRows(t)).toHaveLength(1);
    expect(rankRows(t)[0].dedupe_key).toBe(pass.dedupeKey);
    expect(rankRows(t)[0].occurred_at).toBe(before.toISOString());
  });

  it('en oavgjort-minskning ger inga rader och retractar ingenting', async () => {
    // Ingen avräkning kan idag ångras, så måttet minskar aldrig av ett avgörande; en oavgjort-minskning ger bara inga rader.
    const kept = activityKeys.rankPassed('challenge_points', 'u-w', 'u-c', TODAY);
    const t = duel(
      [player('u-w', 'Anna', 2, 1, 0), player('u-l', 'Bertil', 0, 1, 0), player('u-c', 'Cecilia', 1, 0, 0)],
      [
        settled('c1', 'challenge_draw', 'u-w', 'u-l', NOW.toISOString()),
        { id: 99, type: 'rank_passed', group_id: G, dedupe_key: kept, occurred_at: EARLIER_TODAY },
      ],
    );
    use(t);

    await recordRankPassesForChallenge('c1');

    expect(rankRows(t).map((r) => r.dedupe_key)).toContain(kept);
  });

  it('ett fel kastar aldrig och loggar bara koden', async () => {
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    use(t);

    vi.mocked(detectRankPasses).mockImplementationOnce(() => { throw new Error('secret-detector-detail'); });
    await expect(recordRankPassesForChallenge('c1')).resolves.toBeUndefined();

    use(t, { failWhen: (q) => (q.table === 'activity_log' && q.select ? { message: 'secret row values', code: 'XX002' } as any : null) });
    await expect(recordRankPassesForChallenge('c1')).resolves.toBeUndefined();

    use(t, { failWhen: (q) => (q.table === 'users' ? { message: 'secret member values', code: 'XX003' } as any : null) });
    await expect(recordRankPassesForChallenge('c1')).resolves.toBeUndefined();

    use(t, { failWhen: (q) => (q.table === 'challenges' ? { message: 'secret challenge values', code: 'XX004' } as any : null) });
    await expect(recordRankPassesForChallenge('c1')).resolves.toBeUndefined();

    vi.mocked(getSupabaseClient).mockImplementation(() => { throw new Error('no client'); });
    await expect(recordRankPassesForChallenge('c1')).resolves.toBeUndefined();

    expect(rankRows(t)).toHaveLength(0);
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain('secret');
    expect(logged).toContain('XX002');
    expect(logged).toContain('XX003');
    expect(logged).toContain('XX004');
  });

  it('en okänd, ej avgjord eller grupplös utmaning skriver ingenting och läser inga medlemmar', async () => {
    const log = [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())];
    const users = () => [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)];

    const missing = use(duel(users(), log, []));
    await recordRankPassesForChallenge('c1');
    const active = use(duel(users(), log, [challengeOf('c1', 'u-w', 'u-l', { status: 'active' })]));
    await recordRankPassesForChallenge('c1');
    const groupless = use(duel(users(), log, [challengeOf('c1', 'u-w', 'u-l', { group_id: null })]));
    await recordRankPassesForChallenge('c1');

    for (const db of [missing, active, groupless]) expect(db.queries.some((q) => q.table === 'users')).toBe(false);
    expect(detectRankPasses).not.toHaveBeenCalled();
  });

  it('kostar högst tre läsningar: utmaningen, medlemmarna och dagens avgöranden', async () => {
    const t = duel(
      [player('u-w', 'Anna', 1, 0, 0), player('u-l', 'Bertil', 0, 0, 1), player('u-c', 'Cecilia', 1, 1, 0)],
      [settled('c1', 'challenge_won', 'u-w', 'u-l', NOW.toISOString())],
    );
    const db = use(t);

    await recordRankPassesForChallenge('c1');

    expect(db.queries.filter((q) => q.mutation === undefined).map((q) => q.table).sort()).toEqual(['activity_log', 'challenges', 'users']);
  });
});
