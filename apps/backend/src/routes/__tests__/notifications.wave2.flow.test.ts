/**
 * Flödestest för notiser, våg 2 (ADR 011 beslut 7 och 15): kedjan från en händelse i spelet, via skrivpunkten och loggen, till klockans
 * räknare för rätt person. Våg 1 (notifications.flow.test.ts) bevisar inställning -> räknare -> kvittens på färdiga rader; här skapas
 * raderna av de riktiga skrivvägarna och räknas sedan:
 *   PUT /api/challenges/:id/respond (accept)   -> challenge_accepted -> utmanarens klocka
 *   settleCompetitionEvents (schedulerns ingång) -> event_closed med entrant_ids -> deltagarnas och övrigas klockor, och involves=me
 * rank_passed i flödet ligger i utils/__tests__/rankPassed.flow.test.ts. Allt går genom `createApp()` med riktig auth, gruppfilter och
 * fail-closed mot en in-memory-databas; ingen skrivväg är utbytt.
 *
 * Världen (grupp g1, måndag 2026-10-19 00:05 Stockholm för eventet, annars onsdag 2026-10-15 12:00): Anna (W), Bertil (M), Cecilia
 * (C, utomstående till allt) och Dagny (D) i en annan grupp. Alla XP-värden ligger inom samma nivå och ingen går förbi någon, så
 * inga level_up- eller rank_passed-rader skräpar ner räknarna.
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

import { notifyKey } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { createApp } from '../../app.js';
import { settleCompetitionEvents } from '../../services/eventService.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from './helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(createApp()); });
afterAll(async () => { await server.close(); });

const W = 'a0000000-0000-4000-8000-000000000001'; // Anna
const M = 'a0000000-0000-4000-8000-000000000002'; // Bertil
const C = 'a0000000-0000-4000-8000-000000000003'; // Cecilia
const D = 'a0000000-0000-4000-8000-000000000004'; // Dagny, grupp g2
const G = 'g1';
const OTHER_GROUP = 'g2';
const USER_CREATED = '2026-01-01T08:00:00.000Z';
const NOW = new Date('2026-10-15T10:00:00.000Z'); // 12:00 i Stockholm
const MONDAY_SETTLE = new Date('2026-10-18T22:05:00.000Z'); // måndag 00:05 Stockholm
const SUNDAY_END = '2026-10-18T21:59:59.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

type Tables = Record<string, Row[]>;

function member(id: string, name: string, total_xp: number, current_level: number): Row {
  return {
    id, name, profile_picture: null, group_id: id === D ? OTHER_GROUP : G, total_xp, event_xp: 0, current_level, total_km: 0,
    current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 0, challenge_active: false, highest_rewarded_level: current_level,
    created_at: USER_CREATED, news_last_seen_id: null,
  };
}

const baseUsers = (): Row[] => [member(W, 'Anna', 110, 3), member(M, 'Bertil', 125, 3), member(C, 'Cecilia', 60, 2), member(D, 'Dagny', 500, 3)];

/**
 * Databasen: samma primärnycklar som migrationerna för news_read/user_settings, och activity_log.created_at (en databas-default,
 * now()) sätts vid skrivning eftersom fakeDb saknar defaults. Utan den filtrerar oläst-läsningen bort varje rad routerna skrivit.
 */
function use(t: Tables, options: Parameters<typeof createFakeDb>[1] = {}) {
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
const getNews = (userId: string, query = '') => request('GET', `/api/news${query}`, userId);
const unreadCount = async (userId: string): Promise<number> => (await getNews(userId)).body.meta.unread_count;
const putSetting = (userId: string, kind: Parameters<typeof notifyKey>[0], value: boolean | null) =>
  request('PUT', '/api/settings', userId, { values: { [notifyKey(kind)]: value } });
const typesOf = (t: Tables) => t.activity_log.map((r) => r.type);
const userRow = (t: Tables, id: string) => t.users.find((u) => u.id === id)!;

describe('challenge_accepted i flödet', () => {
  /** Bertil har utmanat Anna (väntande). Båda är upptagna tills den avgörs. */
  function challengeWorld(): Tables {
    const t: Tables = {
      users: baseUsers(),
      challenges: [{
        id: 'ch-1', group_id: G, challenger_id: M, opponent_id: W, status: 'pending', tier: 'major', metric: 'km', duration_days: 7,
        created_at: '2026-10-14T10:00:00.000Z',
      }],
      activity_log: [], news_read: [], user_settings: [],
    };
    Object.assign(userRow(t, M), { challenge_active: true });
    Object.assign(userRow(t, W), { challenge_active: true });
    return t;
  }

  it('accept skriver challenge_accepted och utmanarens räknare ökar', async () => {
    const t = challengeWorld();
    use(t);
    expect(await unreadCount(M)).toBe(0);
    expect(await unreadCount(W)).toBe(0);
    expect(await unreadCount(C)).toBe(0);

    const accept = await request('PUT', '/api/challenges/ch-1/respond', W, { action: 'accept' });

    expect(accept.status).toBe(200);
    expect(accept.body).toEqual({ success: true, message: 'Challenge accepted', data: { start_date: '2026-10-16', end_date: '2026-10-22' } });
    // Aktiverad, och exakt en rad i loggen: Anna (motståndaren) är aktör, Bertil (utmanaren) är mål.
    expect(t.challenges[0]).toMatchObject({ status: 'active', start_date: '2026-10-16', end_date: '2026-10-22' });
    expect(t.activity_log).toEqual([
      expect.objectContaining({
        type: 'challenge_accepted', group_id: G, actor_user_id: W, target_user_id: M, is_backfill: false, occurred_at: NOW.toISOString(),
        dedupe_key: 'challenge_accepted:ch-1',
        payload: { challenge_id: 'ch-1', tier: 'major', metric: 'km', duration_days: 7, start_date: '2026-10-16' },
      }),
    ]);

    // Utmanaren räknar den (challenge_accepted_me), den som accepterade räknar aldrig sin egen handling, och en utomstående
    // räknar den som "andras utmaningar" (challenges_others är påslagen som standard).
    expect(await unreadCount(M)).toBe(1);
    expect(await unreadCount(W)).toBe(0);
    expect(await unreadCount(C)).toBe(1);
    expect(await unreadCount(D)).toBe(0);
    const feed = await getNews(M);
    expect(feed.body.data.items).toEqual([
      expect.objectContaining({
        type: 'challenge_accepted', is_unread: true,
        actor: expect.objectContaining({ id: W }), target: expect.objectContaining({ id: M }),
      }),
    ]);

    // Ett andra svar på en redan besvarad utmaning ger 404 och ingen andra rad, och räknaren står kvar.
    const again = await request('PUT', '/api/challenges/ch-1/respond', W, { action: 'accept' });
    expect(again.status).toBe(404);
    expect(typesOf(t)).toEqual(['challenge_accepted']);
    expect(await unreadCount(M)).toBe(1);

    // Reglaget styr klockan, inte raden: Bertil stänger av slaget och räknaren sjunker, raden finns kvar på /news.
    expect((await putSetting(M, 'challenge_accepted_me', false)).status).toBe(200);
    expect(await unreadCount(M)).toBe(0);
    expect((await getNews(M)).body.data.items).toHaveLength(1);
    expect(await unreadCount(C)).toBe(1);
  });
});

describe('event_closed i flödet', () => {
  /**
   * Veckotävlingen avslutas. Anna (110) och Bertil (125) deltar och får 40 respektive 30 XP: 150 och 155, båda kvar på nivå 3, och
   * Bertil ligger före Anna både vid dygnsskiftet och efteråt, så ingen passerar någon. Cecilia deltar inte.
   */
  function eventWorld(): Tables {
    const event = {
      id: 'ev-1', group_id: G, type: 'competition', status: 'active', metric: 'km', starts_at: '2026-10-12T00:00:00.000Z', ends_at: SUNDAY_END,
      settled_at: null as string | null,
      event_templates: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 40, reward_xp_2nd: 30, reward_xp_3rd: 20 },
    };
    const eventRun = (id: string, user_id: string, distance: number): Row => ({
      id, user_id, date: '2026-10-14', distance, xp_gained: 0, streak_day: 1, source: 'manual', is_treadmill: false,
    });
    return {
      users: baseUsers(),
      runs: [eventRun('run-w-ev', W, 30), eventRun('run-m-ev', M, 20)],
      events: [event],
      // Samma objekt som event-raden: rank_passed-läsningen joinar `events!inner(...)` och ska se avräkningens update.
      event_entries: [
        { id: 'en-w', event_id: 'ev-1', user_id: W, xp_awarded: 0, qualified_at: null, events: event },
        { id: 'en-m', event_id: 'ev-1', user_id: M, xp_awarded: 0, qualified_at: null, events: event },
      ],
      activity_log: [], news_read: [], user_settings: [],
    };
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

  /** Avräkningen körs av schedulern (cron måndag 00:05); den har ingen route, så den riktiga funktionen anropas direkt. */
  async function closeEvent(t: Tables) {
    use(t, { rpc: incrementEventXp(t) });
    vi.setSystemTime(MONDAY_SETTLE);
    await settleCompetitionEvents();
  }

  it('ett stängt event ger event_closed_me för deltagare och event_closed_others för övriga', async () => {
    const t = eventWorld();
    await closeEvent(t);

    // Utbetalningen skedde och ingen gick förbi någon: loggen har exakt en rad, event_closed.
    expect(userRow(t, W).total_xp).toBe(150);
    expect(userRow(t, M).total_xp).toBe(155);
    expect(typesOf(t)).toEqual(['event_closed']);
    // entrant_ids kommer ur den riktiga buildEventClosedDraft: alla med en entry, gemener och sorterade.
    expect(t.activity_log[0]).toMatchObject({
      group_id: G, actor_user_id: null, target_user_id: null, is_backfill: false, dedupe_key: 'event_closed:ev-1',
      occurred_at: MONDAY_SETTLE.toISOString(),
      payload: {
        event_id: 'ev-1', event_type: 'competition', template_name: 'Weekly Km', participants: 2, members: 3,
        entrant_ids: [W, M],
        top: [{ user_id: W, rank: 1, xp: 40 }, { user_id: M, rank: 2, xp: 30 }],
      },
    });

    // Alla tre räknar eventet en gång, men som olika slag. Det visas av att fel reglage inte gör något och rätt reglage gör det.
    expect(await unreadCount(W)).toBe(1);
    expect(await unreadCount(M)).toBe(1);
    expect(await unreadCount(C)).toBe(1);
    expect(await unreadCount(D)).toBe(0);

    // Deltagaren är "me": att stänga av "others" ändrar inget för Anna, och att stänga av "me" tar bort det.
    await putSetting(W, 'event_closed_others', false);
    expect(await unreadCount(W)).toBe(1);
    await putSetting(W, 'event_closed_me', false);
    expect(await unreadCount(W)).toBe(0);
    // Den övriga är "others": att stänga av "me" ändrar inget för Cecilia, och att stänga av "others" tar bort det.
    await putSetting(C, 'event_closed_me', false);
    expect(await unreadCount(C)).toBe(1);
    await putSetting(C, 'event_closed_others', false);
    expect(await unreadCount(C)).toBe(0);
    // Bertil har inte rört något och Annas och Cecilias val syns inte hos honom.
    expect(await unreadCount(M)).toBe(1);
    // Raden finns kvar på /news för alla i gruppen oavsett reglage.
    for (const viewer of [W, M, C]) expect((await getNews(viewer)).body.data.items).toHaveLength(1);
  });

  it('involves=me tar med event_closed för en deltagare', async () => {
    const t = eventWorld();
    // Cecilias egen nivåhöjning ligger i loggen sedan före avräkningen. Id:t ligger över det genererade intervallet så att
    // de riktiga skrivningarna behåller sin egen numrering.
    t.activity_log.push({
      id: 1000, group_id: G, type: 'level_up', actor_user_id: C, target_user_id: null, payload: { level: 2 }, payload_version: 1,
      dedupe_key: 'level_up:c:2', is_backfill: false, occurred_at: '2026-10-14T10:00:00.000Z', created_at: '2026-10-14T10:00:00.000Z',
    });
    await closeEvent(t);
    const closed = t.activity_log.find((r) => r.type === 'event_closed')!;

    const mine = async (userId: string) => {
      const res = await getNews(userId, '?involves=me');
      expect(res.status).toBe(200);
      return res;
    };

    // Deltagarna får eventet, men inte Cecilias nivå (inte deras): bara rader där de är aktör, mål eller står i entrant_ids.
    for (const participant of [W, M]) {
      const res = await mine(participant);
      expect(res.body.data.items.map((i: { id: number }) => i.id)).toEqual([closed.id]);
      expect(res.body.data.items[0]).toMatchObject({ type: 'event_closed', payload: { entrant_ids: [W, M] } });
      // Filtret är ett vyfilter: räknaren är exakt den som ofiltrerade flödet ger.
      expect(res.body.meta.unread_count).toBe(await unreadCount(participant));
    }
    // En icke-deltagare får inte eventet, bara sin egen rad. En användare i en annan grupp får ingenting.
    const outsider = await mine(C);
    expect(outsider.body.data.items.map((i: { type: string }) => i.type)).toEqual(['level_up']);
    expect((await mine(D)).body.data.items).toEqual([]);
    // Det ofiltrerade flödet visar båda raderna för alla i gruppen.
    expect((await getNews(W)).body.data.items.map((i: { type: string }) => i.type)).toEqual(['level_up', 'event_closed']);
  });
});
