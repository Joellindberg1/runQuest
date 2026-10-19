/**
 * Flödestest för rank_passed (ADR 011 beslut 6 och 15, "Skrivvägen (zon 1)" och "settleChallenge / respond"): kedjan från en
 * skrivning av XP eller utmaningspoäng, via den tredje observatören i calculateUserTotals/eventService/settleChallenge, till
 * raden i activity_log och klockans räknare i GET /news. Enhetstesterna täcker varje del (shared: rankPasses.test.ts,
 * services/__tests__/rankNews*.test.ts, calculateUserTotals.news.test.ts); det som bevisas här är att kedjan hänger ihop.
 *
 * Allt går genom den riktiga appen (`createApp()`, riktig auth) mot en in-memory-databas, och skrivvägarna är de riktiga:
 *   POST /api/runs och DELETE /api/runs/:id          -> reprocess, calculateUserTotals, recordRankPassesForXp
 *   POST /api/strava/sync (första importen)           -> calculateUserTotals(userId, { emitRankNews: false })
 *   PUT /api/challenges/:id/respond + GET .../progress -> settleChallenge -> recordRankPassesForChallenge
 *   settleCompetitionEvents (schedulerns enda ingång)  -> utbetalningsloopen i eventService
 * Läsningen är alltid GET /api/news som M, W och en utomstående. Bara andra observatörer (badges, titlar, väder) är utbytta:
 * de hör inte till kedjan och skulle annars lägga egna rader i flödet. recordRankPassesForXp och rankNews är riktiga överallt,
 * utom att detectRankPasses är en spion runt den riktiga detektionen så att "detektionen kastar" kan provas.
 *
 * Världen (grupp g1, 2026-10-15 12:00 Stockholm), XP vid dygnsskiftet = total XP, alla på samma nivå så att inga level_up-rader
 * skräpar ner räknarna:
 *   Anna (W)    110 XP, nivå 3   springer en 5 km-runda idag = 30 XP -> 140
 *   Bertil (M)  135 XP, nivå 3   ligger före Anna vid dygnsskiftet och efter rundan är han kvar bakom henne
 *   Cecilia (C) 60 XP, nivå 2    utomstående: varken W eller M
 *   Dagny (D)   i grupp g2       ska aldrig se något av g1
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
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: vi.fn(async () => null) }));
const processGroupTitles = vi.hoisted(() => vi.fn(async () => ({ total: 0, processed: 0, failed: 0 })));
const processAllGroupsTitles = vi.hoisted(() => vi.fn(async () => ({ total: 0, processed: 0, failed: 0 })));
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processGroupTitles = processGroupTitles; processAllGroupsTitles = processAllGroupsTitles; },
  enhancedTitleService: { processGroupTitles, processAllGroupsTitles },
}));
vi.mock('../../services/weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
// Spion runt den riktiga detektionen: bara "detektionen kastar" byter ut den, en gång.
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  return { ...actual, detectRankPasses: vi.fn(actual.detectRankPasses) };
});

import { detectRankPasses, notifyKey } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { plainRow, tokenCols } from '../../test-utils/stravaTokens.js';
import { createApp } from '../../app.js';
import { settleChallenge } from '../../services/challengeService.js';
import { settleCompetitionEvents } from '../../services/eventService.js';
import { logger } from '../logger.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from '../../routes/__tests__/helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });

const W = 'a0000000-0000-4000-8000-000000000001'; // Anna
const M = 'a0000000-0000-4000-8000-000000000002'; // Bertil
const C = 'a0000000-0000-4000-8000-000000000003'; // Cecilia
const D = 'a0000000-0000-4000-8000-000000000004'; // Dagny, grupp g2
const ERIK = 'a0000000-0000-4000-8000-000000000005'; // Erik, bara i event-världen
const G = 'g1';
const OTHER_GROUP = 'g2';
const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T10:00:00.000Z'); // 12:00 i Stockholm
const USER_CREATED = '2026-01-01T08:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Tables = Record<string, Row[]>;

function member(id: string, name: string, total_xp: number, current_level: number, over: Row = {}): Row {
  return {
    id, name, profile_picture: null, group_id: id === D ? OTHER_GROUP : G, total_xp, event_xp: 0, current_level, total_km: 0,
    current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 0, challenge_active: false, highest_rewarded_level: current_level,
    created_at: USER_CREATED, news_last_seen_id: null, ...over,
  };
}
const oldRun = (id: string, user_id: string, xp_gained: number): Row => ({
  id, user_id, date: '2026-10-10', distance: 3, xp_gained, streak_day: 1, source: 'manual', is_treadmill: false,
});

function world(over: Partial<Tables> = {}): Tables {
  return {
    users: [member(W, 'Anna', 110, 3), member(M, 'Bertil', 135, 3), member(C, 'Cecilia', 60, 2), member(D, 'Dagny', 500, 3)],
    runs: [oldRun('run-w-old', W, 110), oldRun('run-m-old', M, 135), oldRun('run-c-old', C, 60)],
    activity_log: [], event_entries: [], user_boosts: [], news_read: [], user_settings: [],
    ...over,
  };
}

/**
 * Databasen. Samma primärnycklar som migrationerna för news_read/user_settings. activity_log.created_at är en databas-default
 * (now()) som fakeDb inte har: den sätts här vid skrivning, annars filtrerar oläst-läsningen (`created_at > users.created_at`)
 * bort varje rad som routerna skrivit.
 */
function use(t: Tables, options: Parameters<typeof createFakeDb>[1] = {}) {
  // Medlemskapet i group_members är sanningen för titelkedjan (ADR 012); fixturen speglar pekaren users.group_id.
  t.group_members ??= (t.users ?? []).filter((u) => u.group_id).map((u) => ({ id: `m-${u.id}`, user_id: u.id, group_id: u.group_id, role: 'member', starts_on: null, left_at: null }));
  const db = createFakeDb(t, {
    autoIds: true,
    numericIds: ['activity_log'],
    primaryKeys: { news_read: ['user_id', 'activity_id'], user_settings: ['user_id', 'key'] },
    ...options,
  });
  const client = {
    ...db.client,
    from: (table: string) => {
      const builder = db.client.from(table);
      if (table !== 'activity_log') return builder;
      const upsert = builder.upsert;
      builder.upsert = (values: Row | Row[], opts: unknown) =>
        upsert(([] as Row[]).concat(values).map((v) => ({ created_at: new Date().toISOString(), ...v })), opts);
      return builder;
    },
  };
  vi.mocked(getSupabaseClient).mockReturnValue(client as never);
  return db;
}

const token = (userId: string) => mintToken({ user_id: userId, group_id: userId === D ? OTHER_GROUP : G });
const request = (method: string, path: string, userId: string, body?: unknown) =>
  server.request(method, path, { token: token(userId), body });

const getNews = (userId: string) => request('GET', '/api/news', userId);
const unreadCount = async (userId: string): Promise<number> => (await getNews(userId)).body.meta.unread_count;
const feedOf = async (userId: string) => (await getNews(userId)).body.data.items as Array<{
  id: number; type: string; is_unread: boolean; actor: { id: string } | null; target: { id: string } | null; payload: Row;
}>;
const rankItem = async (userId: string) => (await feedOf(userId)).filter((i) => i.type === 'rank_passed');
const postRun = (userId: string, distance = 5) => request('POST', '/api/runs', userId, { date: TODAY, distance });

const rankRows = (t: Tables) => t.activity_log.filter((r) => r.type === 'rank_passed');
const userRow = (t: Tables, id: string) => t.users.find((u) => u.id === id)!;
const totalXp = (t: Tables, id: string) => userRow(t, id).total_xp as number;

/** Anna loggar dagens 5 km-runda: 110 -> 140 XP, förbi Bertil (135). Det enda som händer i världen. */
async function annaPassesBertil(t: Tables) {
  const res = await postRun(W);
  expect(res.status).toBe(200);
  expect(totalXp(t, W)).toBe(140);
  return res;
}

describe('rank_passed i flödet: xp', () => {
  it('en runda som tar W förbi M skriver en rank_passed och M:s klocka räknar den', async () => {
    const t = world();
    use(t);
    expect(await unreadCount(M)).toBe(0);

    await annaPassesBertil(t);

    // Exakt en rad i loggen och inget annat: ingen level_up, run_milestone eller streak_broken skräpar ner räknarna.
    expect(t.activity_log.map((r) => r.type)).toEqual(['rank_passed']);
    expect(rankRows(t)).toEqual([
      expect.objectContaining({
        group_id: G, actor_user_id: W, target_user_id: M, is_backfill: false, occurred_at: NOW.toISOString(),
        dedupe_key: `rank_passed:xp:${W}:${M}:${TODAY}`,
        // Rangerna EFTER passeringen: Anna 140 är ettan, Bertil 135 tvåan. Ingen XP-siffra i payloaden.
        payload: { measure: 'xp', passer_rank: 1, passed_rank: 2 },
      }),
    ]);
    expect(totalXp(t, M)).toBe(135);

    // M: klockan räknar raden (rank_passed_xp_me är påslagen som standard) och raden lyser.
    expect(await unreadCount(M)).toBe(1);
    expect(await rankItem(M)).toEqual([
      expect.objectContaining({ is_unread: true, actor: expect.objectContaining({ id: W }), target: expect.objectContaining({ id: M }) }),
    ]);
    // W: egen handling räknas aldrig, men raden finns i flödet.
    expect(await unreadCount(W)).toBe(0);
    expect(await rankItem(W)).toEqual([expect.objectContaining({ is_unread: false })]);
  });

  it('rank_passed_others är avstängd som default: en utomstående räknar den inte men ser den på /news', async () => {
    const t = world();
    use(t);
    await annaPassesBertil(t);
    expect(rankRows(t)).toHaveLength(1);

    // C är varken W eller M. Klockan räknar 0, /news visar raden som läst, och reglaget står av.
    expect(await unreadCount(C)).toBe(0);
    expect(await rankItem(C)).toEqual([expect.objectContaining({ type: 'rank_passed', is_unread: false })]);
    const settings = await request('GET', '/api/settings', C);
    expect(settings.body.data.values[notifyKey('rank_passed_others')]).toBe(false);
    expect(settings.body.meta.customised).toEqual([]);
    // Och M räknar den ändå: det är reglaget för "andra", inte raden, som tystar C.
    expect(await unreadCount(M)).toBe(1);

    // Gruppfiltret: Dagny i g2 ser ingenting av g1.
    const outsider = await getNews(D);
    expect(outsider.body.data.items).toEqual([]);
    expect(outsider.body.meta.unread_count).toBe(0);
  });

  it('att slå på rank_passed_others gör att utomstående räknar den', async () => {
    const t = world();
    use(t);
    await annaPassesBertil(t);
    expect(await unreadCount(C)).toBe(0);

    const put = await request('PUT', '/api/settings', C, { values: { [notifyKey('rank_passed_others')]: true } });

    expect(put.status).toBe(200);
    expect(put.body.meta.customised).toEqual([notifyKey('rank_passed_others')]);
    expect(await unreadCount(C)).toBe(1);
    expect(await rankItem(C)).toEqual([expect.objectContaining({ is_unread: true })]);
    // Ingen annans räknare rörs av Cecilias val, och inget nytt skrevs i loggen.
    expect(await unreadCount(M)).toBe(1);
    expect(await unreadCount(W)).toBe(0);
    expect(rankRows(t)).toHaveLength(1);
  });

  it('totalerna sparas även när rank-detektionen kastar', async () => {
    const t = world();
    use(t);
    vi.mocked(detectRankPasses).mockImplementationOnce(() => { throw new Error('detektionen föll'); });

    const res = await postRun(W);

    // Rundan svarar 200 och totalerna är skrivna: XP, nivå, streak och km räknades om före observatören.
    expect(res.status).toBe(200);
    expect(userRow(t, W)).toMatchObject({ total_xp: 140, current_level: 3, current_streak: 1, longest_streak: 1, total_km: 8 });
    // Detektionen anropades på riktigt och fångades: inga rader, felet loggat med kod och ingen annan rad förlorad.
    expect(detectRankPasses).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`recordRankPassesForXp failed for user ${W}`));
    expect(t.activity_log).toEqual([]);
    expect(await unreadCount(M)).toBe(0);
    // Resten av kedjan efter observatören kördes: titlarna omräknades för gruppen.
    expect(processGroupTitles).toHaveBeenCalledWith(G);

    // Felet var engångs: nästa runda går som vanligt och passeringen skrivs. Bertil har under tiden gått upp till 150 XP, så Anna
    // (som låg bakom honom vid dygnsskiftet och med 140 fortfarande gör det) går förbi honom med en 6 km-runda på 32 XP -> 172.
    userRow(t, M).total_xp = 150;
    t.runs.find((r) => r.id === 'run-m-old')!.xp_gained = 150;
    expect((await postRun(W, 6)).status).toBe(200);
    expect(totalXp(t, W)).toBe(172);
    expect(rankRows(t)).toEqual([expect.objectContaining({ actor_user_id: W, target_user_id: M, payload: { measure: 'xp', passer_rank: 1, passed_rank: 2 } })]);
  });

  it('emitRankNews false skriver ingen rad', async () => {
    // Den riktiga massvägen: Annas FÖRSTA Strava-import (hon har bara manuella rundor) går via POST /api/strava/sync och
    // calculateUserTotals(userId, { emitRankNews: false }). Importen lyfter henne förbi Bertil, men ingen enskild runda orsakade det.
    const t = world({
      strava_tokens: [{ user_id: W, ...tokenCols(W, 'at', 'rt'), expires_at: 9999999999, connection_date: '2026-09-01' }],
    });
    use(t);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/athlete/activities')) {
        return {
          ok: true, status: 200,
          json: async () => [{ id: 1001, type: 'Run', sport_type: 'Run', distance: 5000, moving_time: 1500, start_date_local: `${TODAY}T07:00:00Z`, trainer: false }],
        };
      }
      // 500, inte 404: detaljanropet faller och importen använder sammanfattningen (404 betyder "aktiviteten är borta").
      return { ok: false, status: 500, json: async () => ({}) };
    }));

    const res = await request('POST', '/api/strava/sync', W);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 1 });
    // Anna ligger nu förbi Bertil (140 mot 135): passeringen är sann, men massvägen skriver den inte.
    expect(totalXp(t, W)).toBe(140);
    expect(totalXp(t, W)).toBeGreaterThan(totalXp(t, M));
    expect(t.runs.filter((r) => r.user_id === W && r.source === 'strava')).toHaveLength(1);
    expect(t.activity_log).toEqual([]);
    expect(await unreadCount(M)).toBe(0);
    expect(await feedOf(M)).toEqual([]);
  });

  it('en raderad runda (XP ner) tar bort dagens rank_passed ur flödet', async () => {
    const t = world();
    use(t);
    await annaPassesBertil(t);
    expect(await unreadCount(M)).toBe(1);
    const run = t.runs.find((r) => r.user_id === W && r.date === TODAY)!;

    const res = await request('DELETE', `/api/runs/${run.id}`, W);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Run deleted successfully' });
    // XP är tillbaka på 110 (Bertil 135 är åter före), dagens rad är retractad och Bertils klocka är tillbaka där den var.
    expect(totalXp(t, W)).toBe(110);
    expect(rankRows(t)).toEqual([]);
    expect(await rankItem(M)).toEqual([]);
    expect(await unreadCount(M)).toBe(0);
    expect(await rankItem(C)).toEqual([]);
    expect(await unreadCount(W)).toBe(0);
  });
});

describe('rank_passed i flödet: challenge_points', () => {
  /** Cecilia har utmanat Anna (väntande). Bertil har 1 seger och 1 förlust (0,5 poäng); Anna och Cecilia har aldrig spelat. */
  function challengeWorld(): Tables {
    const t = world({
      challenges: [{
        id: 'ch-1', group_id: G, challenger_id: C, opponent_id: W, status: 'pending', tier: 'minor', metric: 'km', duration_days: 1,
        winner_type: 'multiplier_days', winner_delta: 0.1, winner_duration: 3,
        loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 3, created_at: '2026-10-14T10:00:00.000Z',
      }],
    });
    Object.assign(userRow(t, M), { wins: 1, losses: 1 });
    Object.assign(userRow(t, W), { challenge_active: true });
    Object.assign(userRow(t, C), { challenge_active: true });
    return t;
  }

  it('avgörande av en utmaning skriver rank_passed (challenge_points) en gång', async () => {
    const t = challengeWorld();
    use(t);

    // Anna tackar ja: utmaningen startar imorgon 2026-10-16 och löper ett dygn (en dags duell: start och slut är samma kalenderdag).
    const accept = await request('PUT', '/api/challenges/ch-1/respond', W, { action: 'accept' });
    expect(accept.status).toBe(200);
    expect(accept.body.data).toEqual({ start_date: '2026-10-16', end_date: '2026-10-16' });
    expect(t.activity_log.map((r) => r.type)).toEqual(['challenge_accepted']);

    // Under utmaningen springer Anna 8 km och Cecilia 3 km. Därefter har determine_at (2026-10-18 03:00 Stockholm) passerat.
    t.runs.push(
      { id: 'run-w-ch', user_id: W, date: '2026-10-16', distance: 8, xp_gained: 0, streak_day: 1, source: 'manual', is_treadmill: false },
      { id: 'run-c-ch', user_id: C, date: '2026-10-16', distance: 3, xp_gained: 0, streak_day: 1, source: 'manual', is_treadmill: false },
    );
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));

    // Två instanser avgör samtidigt (schedulerns ingång, utan HTTP emellan): båda läser "active", och bara den som vinner claimen
    // (`update … where status = 'active'`) får dela ut boostar, W/D/L och rader. Det är claim-guarden som provas här.
    await Promise.all([settleChallenge('ch-1'), settleChallenge('ch-1')]);
    // Progress-routen avgör en utmaning som passerat determine_at; den är den riktiga HTTP-vägen. Efter avgörandet ser den en
    // avgjord utmaning och avgör inte om, vilket proves av att inget nedan ändras. Anropen över HTTP serialiseras, så de säger
    // ingenting om samtidighet.
    const [first, second] = await Promise.all([
      request('GET', '/api/challenges/ch-1/progress', W),
      request('GET', '/api/challenges/ch-1/progress', C),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(t.challenges[0]).toMatchObject({ status: 'completed', winner_id: W, outcome: 'opponent_wins' });
    expect(userRow(t, W)).toMatchObject({ wins: 1, draws: 0, losses: 0 });
    expect(userRow(t, C)).toMatchObject({ wins: 0, draws: 0, losses: 1 });
    expect(t.user_boosts).toHaveLength(2);
    // Anna (1,0 poäng) går förbi Bertil (0,5): hon var en obesegrad nolla vid dygnsskiftet. Cecilia låg bakom henne på namn
    // redan före avgörandet, så ingen rad för henne. Exakt EN rank_passed, med rangerna efter avgörandet.
    expect(rankRows(t)).toEqual([
      expect.objectContaining({
        group_id: G, actor_user_id: W, target_user_id: M, is_backfill: false,
        occurred_at: '2026-10-18T10:00:00.000Z',
        dedupe_key: `rank_passed:challenge_points:${W}:${M}:2026-10-18`,
        payload: { measure: 'challenge_points', passer_rank: 1, passed_rank: 2 },
      }),
    ]);
    expect(t.activity_log.map((r) => r.type).sort()).toEqual(['challenge_accepted', 'challenge_won', 'rank_passed']);

    // Räknarna: Bertil (utomstående till utmaningen) räknar accepten och vinsten som "andras utmaningar" och passeringen som sin egen.
    expect(await unreadCount(M)).toBe(3);
    expect(await rankItem(M)).toEqual([expect.objectContaining({ is_unread: true })]);
    // Anna: egen accept räknas inte, vinsten gör (challenge_won_me), egen passering gör det inte.
    expect(await unreadCount(W)).toBe(1);
    // Cecilia: accepten av hennes utmaning och förlusten räknas; passeringen mellan andra är avstängd som standard.
    expect(await unreadCount(C)).toBe(2);
    expect(await rankItem(C)).toEqual([expect.objectContaining({ is_unread: false })]);

    // Reglaget för challenge_points-passeringar är rank_passed_challenge_me, inte xp-reglaget. Bertil stänger av det rätta: 3 -> 2,
    // och raden finns kvar på /news.
    const challengeKey = notifyKey('rank_passed_challenge_me');
    const xpKey = notifyKey('rank_passed_xp_me');
    expect((await request('PUT', '/api/settings', M, { values: { [challengeKey]: false } })).status).toBe(200);
    expect(await unreadCount(M)).toBe(2);
    expect(await rankItem(M)).toEqual([expect.objectContaining({ is_unread: false })]);
    // xp-reglaget av och på rör inte utmaningsraden: räknaren står kvar på 2, och efter att challenge-reglaget slagits på igen är den 3 även med xp av.
    await request('PUT', '/api/settings', M, { values: { [xpKey]: false } });
    expect(await unreadCount(M)).toBe(2);
    await request('PUT', '/api/settings', M, { values: { [xpKey]: true } });
    expect(await unreadCount(M)).toBe(2);
    await request('PUT', '/api/settings', M, { values: { [xpKey]: false, [challengeKey]: true } });
    expect(await unreadCount(M)).toBe(3);
  });

  it('W förbi M, M förbi W, W förbi M igen samma dag ger en rank_passed: dedupe_key håller i flödet', async () => {
    const t = world();
    use(t);
    await annaPassesBertil(t); // Anna 140 förbi Bertil 135
    expect(rankRows(t)).toHaveLength(1);

    // Bertil tar tillbaka platsen med en egen runda (165): han låg före Anna vid dygnsskiftet, så ingen rad för honom.
    expect((await postRun(M)).status).toBe(200);
    expect(totalXp(t, M)).toBe(165);
    expect(rankRows(t)).toHaveLength(1);

    // Anna går förbi honom igen (172): samma ordnade par, mått och dag, alltså samma dedupe_key, och upserten ger ingen andra rad.
    expect((await postRun(W, 6)).status).toBe(200);
    expect(totalXp(t, W)).toBe(172);
    expect(rankRows(t)).toEqual([
      expect.objectContaining({ actor_user_id: W, target_user_id: M, dedupe_key: `rank_passed:xp:${W}:${M}:${TODAY}`, payload: { measure: 'xp', passer_rank: 1, passed_rank: 2 } }),
    ]);
  });
});

describe('rank_passed i flödet: event-utbetalningen', () => {
  const SUNDAY_END = '2026-10-18T21:59:59.000Z'; // söndag 23:59:59 Stockholm
  const MONDAY_SETTLE = new Date('2026-10-18T22:05:00.000Z'); // måndag 00:05 Stockholm: dagens datum är 2026-10-19

  /**
   * Veckotävlingen avslutas. Anna (110) och Bertil (125) deltar och får 40 respektive 30 XP; Erik (140) deltar inte.
   * Slutställningen: Bertil 155, Anna 150, Erik 140, Cecilia 60. Bertil låg före Anna vid dygnsskiftet och gör det fortfarande,
   * så Anna har INTE gått förbi honom. Båda har däremot gått förbi Erik.
   * Anna får sin XP först (ettan), vid det tillfället har Bertil ännu inte fått sin: en detektion mitt i loopen skulle då
   * skriva en falsk "Anna gick förbi Bertil".
   */
  function eventWorld() {
    const event = {
      id: 'ev-1', group_id: G, type: 'competition', status: 'active', metric: 'km', starts_at: '2026-10-12T00:00:00.000Z', ends_at: SUNDAY_END,
      settled_at: null as string | null,
      event_templates: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 40, reward_xp_2nd: 30, reward_xp_3rd: 20 },
    };
    const eventRun = (id: string, user_id: string, distance: number): Row => ({
      id, user_id, date: '2026-10-14', distance, xp_gained: 0, streak_day: 1, source: 'manual', is_treadmill: false,
    });
    const t = world({
      users: [member(W, 'Anna', 110, 3), member(M, 'Bertil', 125, 3), member(C, 'Cecilia', 60, 2), member(ERIK, 'Erik', 140, 3)],
      runs: [eventRun('run-w-ev', W, 30), eventRun('run-m-ev', M, 20)],
      events: [event],
      // Joinen `events!inner(...)` i rankNews läser entryns inbäddade event: samma objekt som event-raden, så avräkningens update syns i den.
      event_entries: [
        { id: 'en-w', event_id: 'ev-1', user_id: W, xp_awarded: 0, qualified_at: null, events: event },
        { id: 'en-m', event_id: 'ev-1', user_id: M, xp_awarded: 0, qualified_at: null, events: event },
      ],
    });
    return { t, event };
  }

  /** increment_event_xp som i 000_baseline: event_xp och total_xp växer med beloppet. */
  const incrementEventXp = (t: Tables) => ({
    increment_event_xp: ({ p_user_id, p_xp }: { p_user_id: string; p_xp: number }) => {
      const u = userRow(t, p_user_id);
      u.event_xp += p_xp;
      u.total_xp += p_xp;
      return { data: null };
    },
  });

  it('ett stängt event delar ut XP och skriver rank_passed mot slutställningen, inte mitt i utbetalningen', async () => {
    const { t } = eventWorld();
    use(t, { rpc: incrementEventXp(t) });
    vi.setSystemTime(MONDAY_SETTLE);

    await settleCompetitionEvents();

    expect(totalXp(t, W)).toBe(150);
    expect(totalXp(t, M)).toBe(155);
    // Slutställningen: Bertil 1, Anna 2, Erik 3. Båda deltagarna går förbi Erik. Ingen rad för Anna förbi Bertil.
    const passes = rankRows(t).map((r) => [r.actor_user_id, r.target_user_id, r.payload]);
    expect(passes).toHaveLength(2);
    expect(passes).toEqual(expect.arrayContaining([
      [W, ERIK, { measure: 'xp', passer_rank: 2, passed_rank: 3 }],
      [M, ERIK, { measure: 'xp', passer_rank: 1, passed_rank: 3 }],
    ]));
    expect(rankRows(t).some((r) => r.actor_user_id === W && r.target_user_id === M)).toBe(false);
    expect(t.activity_log.filter((r) => r.type === 'event_closed')).toHaveLength(1);
    // Bertils klocka: bara event_closed_me (deltagare). Ingen rank_passed har honom som mål, eftersom Anna aldrig gick förbi honom.
    expect(await unreadCount(M)).toBe(1);
    expect((await rankItem(M)).filter((i) => i.target?.id === M)).toEqual([]);
    // Erik blev passerad av två (rank_passed_xp_me, två rader) och eventet han inte var med i (event_closed_others) räknas också.
    expect(await unreadCount(ERIK)).toBe(3);
  });
});
