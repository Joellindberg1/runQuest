/**
 * Vilka vägar som skriver rank_passed (xp) och vilka som är MASSVÄGAR (ADR 011 beslut 6, "Undertryckning vid massomräkning").
 * Hela kedjan är riktig: sync-routen, removeStravaConnection, webhookens omräkning och calculateUserTotals mot fakeDb. Bara
 * nivåtrappan, utmaningstokens, badges, titlar, väder och eventkvalificering är utbytta (de hör inte hit). rankNews är en spion
 * runt den riktiga observatören, så "skriver ingen rank_passed" visas både på anropet och på det som hamnar i activity_log.
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
vi.mock('../levelService.js', () => ({ getLevelFromXP: vi.fn(async () => 1) }));
vi.mock('../challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../badgeService.js', () => ({ evaluateBadges: vi.fn(async () => null) }));
const processGroupTitles = vi.hoisted(() => vi.fn(async () => ({ total: 0, processed: 0, failed: 0 })));
const processAllGroupsTitles = vi.hoisted(() => vi.fn(async () => ({ total: 0, processed: 0, failed: 0 })));
vi.mock('../enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processGroupTitles = processGroupTitles; processAllGroupsTitles = processAllGroupsTitles; },
  enhancedTitleService: { processGroupTitles, processAllGroupsTitles },
}));
vi.mock('../eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});
vi.mock('../rankNews.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rankNews.js')>();
  return { ...actual, recordRankPassesForXp: vi.fn(actual.recordRankPassesForXp) };
});

import { activityKeys } from '@runquest/shared';
import { getSupabaseClient } from '../../config/database.js';
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import app from '../../app.js';
import { recordRankPassesForXp } from '../rankNews.js';
import { removeStravaConnection } from '../stravaConnection.js';
import { createRecompute } from '../stravaWebhook/supabaseAdapters.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { mintToken, startServer, type TestServer } from '../../routes/__tests__/helpers/http.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(app); });
afterAll(async () => { await server.close(); });

const TODAY = '2026-10-15';
const OLD = '2026-10-10';
const G = 'group-1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const member = (id: string, name: string, total_xp: number, over: Row = {}): Row => ({
  id, name, group_id: G, total_xp, event_xp: 0, current_level: 1, total_km: 0, current_streak: 0, longest_streak: 0,
  created_at: '2026-01-01T08:00:00.000Z', ...over,
});
const stravaRun = (over: Row = {}): Row => ({
  id: 'run-1', user_id: 'user-1', source: 'strava', external_id: '1001', date: OLD, distance: 5, xp_gained: 5, streak_day: 1, ...over,
});

function use(tables: Partial<Record<string, Row[]>>) {
  const t: Record<string, Row[]> = {
    strava_tokens: [{ user_id: 'user-1', ...tokenCols('user-1', 'at', 'rt'), expires_at: 9999999999, connection_date: '2026-09-01' }],
    runs: [], event_entries: [], activity_log: [], user_boosts: [],
    ...(tables as Record<string, Row[]>),
  };
  // Medlemskapet i group_members är sanningen för titelkedjan (ADR 012); fixturen speglar pekaren users.group_id.
  t.group_members ??= (t.users ?? []).filter((u) => u.group_id).map((u) => ({ id: `m-${u.id}`, user_id: u.id, group_id: u.group_id, role: 'member', starts_on: null, left_at: null }));
  const db = createFakeDb(t, { autoIds: true, numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { t, db };
}
const rankRows = (t: Record<string, Row[]>) => t.activity_log.filter((r) => r.type === 'rank_passed');
const totalXp = (t: Record<string, Row[]>, id: string) => t.users.find((u) => u.id === id)!.total_xp as number;

function stubStrava(activities: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/athlete/activities')) return { ok: true, status: 200, json: async () => activities };
    // 500, inte 404: detaljanropet faller och importen använder sammanfattningen. Ett 404 betyder "aktiviteten är borta" och hoppas över.
    return { ok: false, status: 500, json: async () => ({}) };
  }));
}
const activityToday = (id: number) => ({
  id, type: 'Run', sport_type: 'Run', distance: 5000, moving_time: 1500, start_date_local: `${TODAY}T07:00:00Z`, trainer: false,
});
const sync = () => server.request('POST', '/api/strava/sync', { token: mintToken({ user_id: 'user-1', group_id: G }) });

// Anna (user-1) ligger bakom Bertil (user-2, 6 XP) vid dygnsskiftet; en runda idag på 5 km ger henne mer än så.
const annaBehindBertil = (annaRuns: Row[]) => ({
  users: [member('user-1', 'Anna', annaRuns.reduce((s, r) => s + (r.xp_gained as number), 0)), member('user-2', 'Bertil', 6)],
  runs: annaRuns,
});

describe('massvägar skriver ingen rank_passed', () => {
  it('historikimporten vid Strava-anslutning skriver ingen rank_passed', async () => {
    // Första importen: Anna har inga Strava-rundor än, så synken är importen vid anslutningen.
    stubStrava([activityToday(1001)]);
    const { t } = use(annaBehindBertil([]));

    const res = await sync();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 1 });
    expect(totalXp(t, 'user-1')).toBeGreaterThan(6); // Anna HAR gått förbi Bertil...
    expect(recordRankPassesForXp).not.toHaveBeenCalled(); // ...men importen är en massväg
    expect(rankRows(t)).toHaveLength(0);
  });

  it('massomräkningen (reprocess-all) skriver ingen rank_passed', async () => {
    // Admin-omräkningen av titlar går aldrig via calculateUserTotals och skriver inga XP-nyheter.
    const { t } = use({ users: [{ ...member('admin-1', 'Admin', 0), is_admin: true }, member('user-2', 'Bertil', 6)] });

    const res = await server.request('POST', '/api/titles/reprocess-all', { token: mintToken({ user_id: 'admin-1', group_id: G }) });

    expect(res.status).toBe(200);
    expect(processAllGroupsTitles).toHaveBeenCalledWith({ emitNews: false });
    expect(recordRankPassesForXp).not.toHaveBeenCalled();
    expect(rankRows(t)).toHaveLength(0);
  });

  it('massraderingen vid bortkoppling (removeStravaConnection) skriver ingen rank_passed', async () => {
    // Annas Strava-rundor raderas: total_xp ändras, så ett standardanrop hade anropat detektionen (för retract).
    const runs = [stravaRun({ id: 'a', external_id: '1', date: OLD, xp_gained: 10 }), stravaRun({ id: 'b', external_id: '2', date: TODAY, xp_gained: 10 })];
    const { t } = use({ users: [member('user-1', 'Anna', 20), member('user-2', 'Bertil', 6)], runs });

    await removeStravaConnection('user-1', { reason: 'user_disconnect' });

    expect(t.runs).toEqual([]);
    expect(totalXp(t, 'user-1')).toBe(0); // totalerna räknades om
    // Nya rader: aldrig. Detektionen får bara köras i retract_only-läget (en minskning retractar, se nästa test).
    expect(vi.mocked(recordRankPassesForXp).mock.calls.every((call) => call[3]?.mode === 'retract_only')).toBe(true);
    expect(rankRows(t)).toHaveLength(0);
  });

  it('massraderingen vid bortkoppling (removeStravaConnection) retractar dagens rank_passed-rader men skriver inga nya', async () => {
    // Anna (20 XP) passerade Bertil (15) idag; bortkopplingen raderar hennes Strava-rundor (hon får 0 XP) så att hon åter ligger under honom.
    // Dora har också 0 XP, och Anna ligger kvar före henne på namn: den raden stämmer fortfarande och ska stå kvar.
    const runs = [stravaRun({ id: 'a', external_id: '1', date: OLD, xp_gained: 10 }), stravaRun({ id: 'b', external_id: '2', date: TODAY, xp_gained: 10 })];
    const key = (passed: string, day: string) => activityKeys.rankPassed('xp', 'user-1', passed, day);
    const row = (id: number, dedupe_key: string): Row => ({ id, type: 'rank_passed', group_id: G, actor_user_id: 'user-1', dedupe_key });
    const { t } = use({
      users: [member('user-1', 'Anna', 20), member('user-2', 'Bertil', 15), member('user-3', 'Cecilia', 5), member('user-4', 'Dora', 0)],
      runs,
      activity_log: [
        row(1, key('user-2', TODAY)),      // Anna ligger åter bakom Bertil: retractas
        row(2, key('user-2', '2026-10-14')), // äldre dag: historia, rörs inte
        row(3, key('user-4', TODAY)),      // Anna (0) och Dora (0) har lika XP, Anna före på namn: raden stämmer fortfarande
      ],
    });

    await removeStravaConnection('user-1', { reason: 'user_disconnect' });

    expect(t.activity_log.map((r) => r.dedupe_key)).toEqual([key('user-2', '2026-10-14'), key('user-4', TODAY)]); // och inga nya rader
  });

  it('avauktoriseringen från Strava (removeStravaConnection, deauthorized) är samma massväg', async () => {
    const runs = [stravaRun({ id: 'a', external_id: '1', date: TODAY, xp_gained: 10 })];
    use({ users: [member('user-1', 'Anna', 10), member('user-2', 'Bertil', 6)], runs });
    await removeStravaConnection('user-1', { reason: 'deauthorized' });
    expect(vi.mocked(recordRankPassesForXp).mock.calls.every((call) => call[3]?.mode === 'retract_only')).toBe(true);
  });
});

describe('enskilda aktiviteter skriver rank_passed som vanligt', () => {
  it('en enskild aktivitet som skapas eller uppdateras via webhook eller polling skriver rank_passed som vanligt', async () => {
    // Polling: Anna har redan en importerad Strava-runda, så det här är en ny enskild aktivitet, inte importen vid anslutning.
    stubStrava([activityToday(2002)]);
    const polled = use(annaBehindBertil([stravaRun({ xp_gained: 5 })]));

    const res = await sync();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, newRuns: 1 });
    expect(totalXp(polled.t, 'user-1')).toBeGreaterThan(6);
    expect(recordRankPassesForXp).toHaveBeenCalledWith('user-1', G, 5);
    expect(rankRows(polled.t).map((r) => [r.actor_user_id, r.target_user_id])).toEqual([['user-1', 'user-2']]);

    // Webhook (create/update): arbetaren omräknar med RunStore-adaptern, som anropar calculateUserTotals utan massflaggan.
    vi.clearAllMocks();
    const hooked = use({
      users: [member('user-1', 'Anna', 5), member('user-2', 'Bertil', 6)],
      runs: [stravaRun({ xp_gained: 5 }), stravaRun({ id: 'run-2', external_id: '2002', date: TODAY, xp_gained: 5 })],
    });
    await createRecompute().recalculateTotals('user-1');

    expect(totalXp(hooked.t, 'user-1')).toBe(10);
    expect(recordRankPassesForXp).toHaveBeenCalledWith('user-1', G, 5);
    expect(rankRows(hooked.t).map((r) => [r.actor_user_id, r.target_user_id])).toEqual([['user-1', 'user-2']]);
  });
});
