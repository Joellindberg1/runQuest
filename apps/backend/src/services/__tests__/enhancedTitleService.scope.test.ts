/**
 * Titelomräkningen är gruppsatt och fail-closed (ADR 012 beslut 4). processGroupTitles(groupId) räknar om de AKTIVA medlemmarna i
 * group_members (aldrig users.group_id) inom varje medlems fönster, skriver user_titles med group_id och bygger bara den gruppens
 * ranking. Det finns inget läge som blandar gruppers användare och inget för grupplösa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { titleEngineRegistry } from '../../titleEngines/index.js';
import type { TitleEngine } from '../../titleEngines/types.js';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const SPY_KEY = '__scopeSpy';
const NOW = new Date('2026-10-18T10:00:00Z');

interface SpyCall { dates: string[]; totalKm: number; longestStreak: number }
const spyCalls: SpyCall[] = [];
const spyEngine: TitleEngine = {
  metricKey: SPY_KEY,
  calculate(runs, stats) {
    spyCalls.push({ dates: runs.map((r) => r.date), totalKm: stats.totalKm, longestStreak: stats.longestStreak });
    return 1;
  },
};

const member = (id: string, userId: string, groupId: string, extra: Row = {}): Row => ({ id, user_id: userId, group_id: groupId, role: 'member', starts_on: null, left_at: null, ...extra });

function tables(): Record<string, Row[]> {
  return {
    groups: [{ id: 'g1' }, { id: 'g2' }],
    users: [
      { id: 'u1', group_id: 'g1', total_km: 10, longest_streak: 1 },
      { id: 'u2', group_id: 'g1', total_km: 20, longest_streak: 2 },
      { id: 'u3', group_id: 'g2', total_km: 30, longest_streak: 3 },
      { id: 'u4', group_id: null, total_km: 40, longest_streak: 4 },
      { id: 'u5', group_id: 'g1', total_km: 50, longest_streak: 5 }, // pekaren säger g1 men medlemskap saknas (drift)
      { id: 'u6', group_id: null, total_km: 60, longest_streak: 6 }, // har lämnat g1
    ],
    group_members: [
      member('m1', 'u1', 'g1'),
      member('m2', 'u2', 'g1'),
      member('m3', 'u3', 'g2'),
      member('m6', 'u6', 'g1', { left_at: '2026-10-01T00:00:00Z' }),
    ],
    runs: [
      { id: 'r1', user_id: 'u1', date: '2026-09-01', distance: 5 },
      { id: 'r2', user_id: 'u2', date: '2026-09-02', distance: 6 },
      { id: 'r3', user_id: 'u3', date: '2026-09-03', distance: 7 },
    ],
    titles: [{ id: 't-spy', name: 'Spy', description: '', unlock_requirement: 0, metric_key: SPY_KEY }],
    user_titles: [],
    title_leaderboard: [],
    activity_log: [],
  };
}

/** `seen`: user_titles (user:titel) som fanns när anropet gjordes, för att visa att ombyggnaden kom efter alla skrivningar. */
interface RpcCall { name: string; args: any; seen: string[] }

function setup(data: Record<string, Row[]> = tables()) {
  const rpcCalls: RpcCall[] = [];
  const rpc = (name: string) => (args: any) => { rpcCalls.push({ name, args, seen: data.user_titles.map((r) => `${r.user_id}:${r.title_id}`).sort() }); return { data: null }; };
  const db = createFakeDb(data, {
    autoIds: true,
    numericIds: ['activity_log'],
    rpc: {
      update_group_title_leaderboard: rpc('update_group_title_leaderboard'),
      update_group_title_leaderboards: rpc('update_group_title_leaderboards'),
      rebuild_one_title: rpc('rebuild_one_title'),
      rebuild_all_groups: rpc('rebuild_all_groups'),
    },
  });
  holder.client = db.client;
  return { data, db, rpcCalls, service: new EnhancedTitleService() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  spyCalls.length = 0;
  titleEngineRegistry.set(SPY_KEY, spyEngine);
});
afterEach(() => {
  titleEngineRegistry.delete(SPY_KEY);
  vi.useRealTimers();
});

describe('processGroupTitles — fail-closed omfång', () => {
  it.each([[''], [undefined], [null]])('groupId %j kastar och rör ingenting', async (groupId) => {
    const { db, service } = setup();
    await expect(service.processGroupTitles(groupId as unknown as string)).rejects.toThrow(/groupId/);
    expect(db.queries).toHaveLength(0);
  });

  it('en grupp utan aktiva medlemmar räknar inget och bygger ingen ranking', async () => {
    const { db, service, rpcCalls } = setup();
    await expect(service.processGroupTitles('g-empty', { emitNews: false })).resolves.toEqual({ total: 0, processed: 0, failed: 0 });
    expect(db.queries.filter((q) => q.table === 'runs')).toHaveLength(0);
    expect(rpcCalls).toEqual([]);
  });

  it('ett fel vid läsningen av medlemmarna kastar med databasens kod, aldrig dess text', async () => {
    const { service } = setup();
    const failing = createFakeDb(tables(), { failWhen: (q) => (q.table === 'group_members' ? { message: 'LEAKMARKER jane@example.com', code: '57014' } : null) });
    holder.client = failing.client;
    const failure = await service.processGroupTitles('g1', { emitNews: false }).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Group members fetch failed');
    expect((failure as { code?: string }).code).toBe('57014');
    expect(JSON.stringify(failure)).not.toContain('LEAKMARKER');
    expect(failing.queries.map((q) => q.table)).toEqual(['group_members']); // inga användare eller rundor lästes
  });
});

describe('processGroupTitles — vem som räknas', () => {
  it('räknar de aktiva medlemmarna i gruppen: inte andra grupper, inte grupplösa, inte den som lämnat och inte den vars pekare avviker', async () => {
    const { db, service } = setup();
    const processed = vi.spyOn(service, 'processUserTitlesAfterRun');

    await expect(service.processGroupTitles('g1', { emitNews: false })).resolves.toEqual({ total: 2, processed: 2, failed: 0 });

    expect(processed.mock.calls.map((c) => c[0].userId).sort()).toEqual(['u1', 'u2']);
    const membersRead = db.queries.find((q) => q.table === 'group_members')!;
    expect(membersRead.filters).toContainEqual({ op: 'eq', column: 'group_id', value: 'g1' });
    expect(membersRead.filters).toContainEqual({ op: 'is', column: 'left_at', value: null });
    const runReads = db.queries.filter((q) => q.table === 'runs').flatMap((q) => q.filters.map((f) => f.value));
    expect(runReads.sort()).toEqual(['u1', 'u2']);
  });

  it('medlemskapet läses ur group_members, inte ur users.group_id (users läses bara för de lagrade totalerna)', async () => {
    const { db, service } = setup();
    await service.processGroupTitles('g1', { emitNews: false });
    const usersRead = db.queries.find((q) => q.table === 'users')!;
    expect(usersRead.filters.some((f) => f.column === 'group_id')).toBe(false);
    expect(usersRead.filters).toContainEqual({ op: 'in', column: 'id', value: ['u1', 'u2'] });
  });

  it('en användare vars körning faller räknas som misslyckad och stoppar inte de övriga', async () => {
    const { service } = setup();
    vi.spyOn(service, 'processUserTitlesAfterRun').mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === 'u1') throw new Error('boom');
    });
    await expect(service.processGroupTitles('g1', { emitNews: false })).resolves.toEqual({ total: 2, processed: 1, failed: 1 });
  });
});

describe('grupp A:s skrivning bygger inte om grupp B', () => {
  it('skriver user_titles med group_id för A, rör inte B:s rader eller B:s ranking, och läser inga av B:s rundor', async () => {
    const data = tables();
    data.user_titles = [{ id: 'ut-b', user_id: 'u3', group_id: 'g2', title_id: 't-spy', value: 99, earned_at: '2026-01-01T00:00:00Z' }];
    const { db, service, rpcCalls } = setup(data);

    await service.processGroupTitles('g1', { emitNews: false });

    expect(data.user_titles.filter((r) => r.group_id === 'g1').map((r) => [r.user_id, r.title_id, r.value]).sort()).toEqual([['u1', 't-spy', 1], ['u2', 't-spy', 1]]);
    expect(data.user_titles.find((r) => r.id === 'ut-b')).toEqual({ id: 'ut-b', user_id: 'u3', group_id: 'g2', title_id: 't-spy', value: 99, earned_at: '2026-01-01T00:00:00Z' });
    expect(rpcCalls.map((c) => [c.name, c.args])).toEqual([['update_group_title_leaderboards', { p_group_id: 'g1' }]]);
    expect(db.queries.filter((q) => q.table === 'runs').flatMap((q) => q.filters.map((f) => f.value))).not.toContain('u3');
  });

  it('rankingen byggs om EN gång per gruppomräkning (hela gruppen), efter att alla medlemmar skrivits — inte per medlem eller per titel', async () => {
    const { service, rpcCalls } = setup();
    await service.processGroupTitles('g1', { emitNews: false });
    expect(rpcCalls.map((c) => [c.name, c.args])).toEqual([['update_group_title_leaderboards', { p_group_id: 'g1' }]]);
    expect(rpcCalls[0].seen).toEqual(['u1:t-spy', 'u2:t-spy']); // båda medlemmarnas rader fanns redan
  });

  it('ombyggnaden körs även när några medlemmar misslyckades, så att de som lyckades syns i rankingen', async () => {
    const { service, rpcCalls } = setup();
    vi.spyOn(service, 'processUserTitlesAfterRun').mockRejectedValue(new Error('boom'));
    await expect(service.processGroupTitles('g1', { emitNews: false })).resolves.toEqual({ total: 2, processed: 0, failed: 2 });
    expect(rpcCalls.map((c) => c.name)).toEqual(['update_group_title_leaderboards']);
  });

  it('processAllGroupsTitles bygger varje grupp en gång med gruppens id, aldrig alla grupper på en gång', async () => {
    const { service, rpcCalls } = setup();
    await service.processAllGroupsTitles({ emitNews: false });
    expect(rpcCalls.map((c) => [c.name, c.args])).toEqual([
      ['update_group_title_leaderboards', { p_group_id: 'g1' }],
      ['update_group_title_leaderboards', { p_group_id: 'g2' }],
    ]);
  });

  it('användare som finns i två grupper över tid håller sina titelrader per grupp: samma användare, olika grupp, två rader', async () => {
    const data = tables();
    data.user_titles = [{ id: 'ut-old', user_id: 'u1', group_id: 'g-old', title_id: 't-spy', value: 5, earned_at: '2026-01-01T00:00:00Z' }];
    const { service } = setup(data);

    await service.processGroupTitles('g1', { emitNews: false });

    expect(data.user_titles.filter((r) => r.user_id === 'u1').map((r) => [r.group_id, r.value]).sort()).toEqual([['g-old', 5], ['g1', 1]]);
  });
});

describe('fönstret (titleWindow)', () => {
  function windowed(): Record<string, Row[]> {
    const data = tables();
    data.group_members = [
      member('m1', 'u1', 'g1', { starts_on: '2026-09-10' }), // gick med 10 september
      member('m2', 'u2', 'g1'), // första gruppen: hela historiken
    ];
    data.runs = [
      { id: 'r1', user_id: 'u1', date: '2026-09-08', distance: 10 },
      { id: 'r2', user_id: 'u1', date: '2026-09-09', distance: 10 },
      { id: 'r3', user_id: 'u1', date: '2026-09-10', distance: 3 },
      { id: 'r4', user_id: 'u1', date: '2026-09-11', distance: 4 },
      { id: 'r5', user_id: 'u2', date: '2026-09-08', distance: 10 },
      { id: 'r6', user_id: 'u2', date: '2026-09-09', distance: 10 },
    ];
    return data;
  }

  it('rundor före joindagen filtreras bort; km och streak räknas ur fönstret; medlemmen utan startdag får allt och de lagrade totalerna', async () => {
    const { service } = setup(windowed());
    await service.processGroupTitles('g1', { emitNews: false });

    const byFirstDate = new Map(spyCalls.map((c) => [c.dates.join(','), c]));
    expect(byFirstDate.get('2026-09-10,2026-09-11')).toEqual({ dates: ['2026-09-10', '2026-09-11'], totalKm: 7, longestStreak: 2 });
    expect(byFirstDate.get('2026-09-08,2026-09-09')).toEqual({ dates: ['2026-09-08', '2026-09-09'], totalKm: 20, longestStreak: 2 }); // u2: users.total_km och users.longest_streak
  });

  it('startdagen själv räknas (date >= starts_on) och dagen före gör det inte', async () => {
    const { service } = setup(windowed());
    await service.processGroupTitles('g1', { emitNews: false });
    const u1 = spyCalls.find((c) => c.dates.includes('2026-09-11'))!;
    expect(u1.dates).toContain('2026-09-10');
    expect(u1.dates).not.toContain('2026-09-09');
  });

  it('en riktig motor (totalKm) får fönstrets km, inte users.total_km', async () => {
    const data = windowed();
    data.titles = [{ id: 't-km', name: 'Distance King', description: '', unlock_requirement: 1, metric_key: 'totalKm' }];
    const { service } = setup(data);

    await service.processGroupTitles('g1', { emitNews: false });

    const values = Object.fromEntries(data.user_titles.map((r) => [r.user_id, r.value]));
    expect(values).toEqual({ u1: 7, u2: 20 }); // u1: 3 + 4 ur fönstret (lagrat 10 ignoreras); u2: lagrat users.total_km
  });
});

describe('startdag null ger samma värden som dagens omräkning', () => {
  it('för varje motor i registret: samma user_titles-värden som motorerna ger på ALLA rundor och de lagrade totalerna', async () => {
    const data = tables();
    const keys = [...titleEngineRegistry.keys()].filter((key) => key !== SPY_KEY);
    data.titles = keys.map((key, i) => ({ id: `t${i}`, name: key, description: '', unlock_requirement: -1e9, metric_key: key }));
    data.group_members = [member('m1', 'u1', 'g1'), member('m2', 'u2', 'g1')];
    data.users = [
      { id: 'u1', group_id: 'g1', total_km: 75.5, longest_streak: 4 },
      { id: 'u2', group_id: 'g1', total_km: 0, longest_streak: 0 },
    ];
    data.runs = [
      { id: 'r1', user_id: 'u1', date: '2026-01-10', distance: 5.2, start_time: '2026-01-10T05:30:00Z', total_elevation_gain: 40, pace_std_dev: 12, moving_time: 1500, run_weather: { temperature_c: -12, wind_speed_ms: 16, wind_gusts_ms: 21 } },
      { id: 'r2', user_id: 'u1', date: '2026-01-11', distance: 21.3, start_time: '2026-01-11T11:00:00Z', total_elevation_gain: 120, pace_std_dev: 20, moving_time: 6600, run_weather: null },
      { id: 'r3', user_id: 'u1', date: '2026-01-12', distance: 8, start_time: '2026-01-12T22:30:00Z', total_elevation_gain: 10, pace_std_dev: 8, moving_time: 2400 },
      { id: 'r4', user_id: 'u1', date: '2026-01-13', distance: 10, start_time: '2026-01-13T09:00:00Z', total_elevation_gain: 55, pace_std_dev: 9, moving_time: 3000 },
      { id: 'r5', user_id: 'u1', date: '2026-06-30', distance: 42.4, start_time: '2026-06-30T07:00:00Z', total_elevation_gain: 300, pace_std_dev: 15, moving_time: 14400 },
      { id: 'r6', user_id: 'u1', date: '2026-07-01', distance: 4.9, start_time: null, total_elevation_gain: null, pace_std_dev: null, moving_time: 1200 },
    ];
    const { service } = setup(data);

    await service.processGroupTitles('g1', { emitNews: false });

    // Referensen är exakt det processAllUsersTitles matade motorerna med före ändringen: alla rundor (med distance_km-alias),
    // users.total_km och users.longest_streak, och ett "nu" för körningen.
    const ctx = { now: NOW };
    for (const user of data.users) {
      const runs = data.runs.filter((r) => r.user_id === user.id).map((r) => ({ ...r, distance_km: r.distance }));
      const legacy = service.calculateUserValues(runs, user.total_km || 0, user.longest_streak || 0, ctx);
      const expected = keys.filter((key) => Number.isFinite(legacy[key]) && legacy[key] >= -1e9).map((key) => [key, legacy[key]]).sort();
      const actual = data.user_titles
        .filter((r) => r.user_id === user.id)
        .map((r) => [data.titles.find((t) => t.id === r.title_id)!.metric_key, r.value])
        .sort();
      expect(actual).toEqual(expected);
    }
    // Och att jämförelsen faktiskt innehåller värden (inte två tomma listor).
    expect(data.user_titles.filter((r) => r.user_id === 'u1').length).toBeGreaterThan(15);
  });
});

describe('processAllGroupsTitles', () => {
  it('räknar varje grupp med aktiva medlemmar, en i taget i id-ordning, och summerar', async () => {
    const { service } = setup();
    const order: string[] = [];
    vi.spyOn(service, 'processGroupTitles').mockImplementation(async (groupId: string) => {
      order.push(`start:${groupId}`);
      await Promise.resolve();
      order.push(`end:${groupId}`);
      return { total: 2, processed: 1, failed: 1 };
    });

    const result = await service.processAllGroupsTitles({ emitNews: false });

    expect(order).toEqual(['start:g1', 'end:g1', 'start:g2', 'end:g2']); // g-utan-medlemmar och lämnade medlemskap ger ingen grupp
    expect(result).toEqual({ total: 4, processed: 2, failed: 2 });
  });

  it('skickar emitNews vidare (standard true) till varje grupp', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'processGroupTitles').mockResolvedValue({ total: 0, processed: 0, failed: 0 });
    await service.processAllGroupsTitles();
    expect(spy.mock.calls).toEqual([['g1', { emitNews: true }], ['g2', { emitNews: true }]]);
    spy.mockClear();
    await service.processAllGroupsTitles({ emitNews: false });
    expect(spy.mock.calls).toEqual([['g1', { emitNews: false }], ['g2', { emitNews: false }]]);
  });

  it('en grupp som inte går att läsa stoppar inte de andra, men gör anropet misslyckat med koden', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'processGroupTitles').mockImplementation(async (groupId: string) => {
      if (groupId === 'g1') throw Object.assign(new Error('Group members fetch failed'), { code: '57014' });
      return { total: 1, processed: 1, failed: 0 };
    });

    const failure = await service.processAllGroupsTitles({ emitNews: false }).catch((e: Error) => e);

    expect(spy).toHaveBeenCalledTimes(2);
    expect((failure as Error).message).toBe('Title recalculation failed for 1 of 2 group(s)');
    expect((failure as { code?: string }).code).toBe('57014');
  });

  it('inga grupper med aktiva medlemmar ger tomt resultat', async () => {
    const data = tables();
    data.group_members = [];
    const { service } = setup(data);
    await expect(service.processAllGroupsTitles({ emitNews: false })).resolves.toEqual({ total: 0, processed: 0, failed: 0 });
  });
});
