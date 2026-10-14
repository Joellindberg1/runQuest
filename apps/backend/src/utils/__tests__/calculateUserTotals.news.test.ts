/**
 * Pack News-sidoeffekter i calculateUserTotals (ADR 008 beslut 5, ADR 005):
 * level_up och run_milestone loggas EFTER lyckad users-update, jämfört mot FÖREGÅENDE värden
 * (läses i samma select som event_xp), med gruppen ur users.group_id. Beräkningen rörs inte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({
  // 0 → 1, 50 → 2, 100 → 3, 200 → 4
  getLevelFromXP: vi.fn(async (xp: number) => (xp >= 200 ? 4 : xp >= 100 ? 3 : xp >= 50 ? 2 : 1)),
}));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
vi.mock('../../services/badgeService.js', () => ({ evaluateBadges: vi.fn(async () => null) })); // badges testas i calculateUserTotals.badges*.test.ts
const processAllUsersTitles = vi.fn(async () => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = processAllUsersTitles; },
}));

// Den riktiga observatören, men som spion: testerna styr bara när den ska kasta eller läsa vad den fick.
vi.mock('../../services/rankNews.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/rankNews.js')>();
  return { ...actual, recordRankPassesForXp: vi.fn(actual.recordRankPassesForXp) };
});

import { getSupabaseClient } from '../../config/database.js';
import { recordRankPassesForXp } from '../../services/rankNews.js';
import { calculateUserTotals } from '../calculateUserTotals.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function use(tables: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], ...options });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

const run = (id: string, date: string, distance: number, xp: number): Row => ({ id, user_id: 'u1', date, distance, xp_gained: xp });

function tables(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    activity_log: [],
    users: [{ id: 'u1', group_id: 'g1', event_xp: 0, current_level: 1, total_km: 90, total_xp: 0, current_streak: 0, longest_streak: 0 }],
    runs: [run('r1', '2020-01-01', 95, 60), run('r2', '2020-01-03', 10, 45)], // 105 km, 105 XP → nivå 3, passerade 100 km
    ...over,
  } as Record<string, Row[]>;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('calculateUserTotals → activity_log', () => {
  it('level-up över flera nivåer och milstolpe loggas, gruppen ur users.group_id', async () => {
    const t = tables();
    use(t);
    await calculateUserTotals('u1'); // Strava-vägen: gruppen kommer ur users.group_id

    expect(t.users[0]).toMatchObject({ total_xp: 105, total_km: 105, current_level: 3 });
    expect(t.activity_log.map((r) => [r.type, r.payload, r.group_id, r.actor_user_id])).toEqual([
      ['level_up', { level: 2 }, 'g1', 'u1'],
      ['level_up', { level: 3 }, 'g1', 'u1'],
      ['run_milestone', { kind: 'total_km', threshold: 100 }, 'g1', 'u1'],
    ]);
    expect(t.activity_log.every((r) => r.is_backfill === false)).toBe(true);
  });

  it('omräkning utan förändring ger inga nya rader (föregående == nytt)', async () => {
    const t = tables();
    use(t);
    await calculateUserTotals('u1');
    const count = t.activity_log.length;
    await calculateUserTotals('u1');
    expect(t.activity_log).toHaveLength(count);
  });

  it('regression (raderad runda) och återtagande ger ingen andra rad — nycklarna är "första gången"', async () => {
    const t = tables();
    use(t);
    await calculateUserTotals('u1'); // nivå 3, 105 km
    const keysAfterFirst = t.activity_log.map((r) => r.dedupe_key).sort();

    t.runs = [run('r1', '2020-01-01', 95, 60)]; // radera r2 → nivå 2, 95 km
    await calculateUserTotals('u1');
    expect(t.users[0].current_level).toBe(2);
    expect(t.activity_log).toHaveLength(keysAfterFirst.length); // sjunkande nivå/km loggar inget

    t.runs = [run('r1', '2020-01-01', 95, 60), run('r2b', '2020-01-04', 12, 45)]; // tillbaka över 100 km och nivå 3
    await calculateUserTotals('u1');
    expect(t.activity_log.map((r) => r.dedupe_key).sort()).toEqual(keysAfterFirst); // fortfarande en rad per nyckel
  });

  it('inga rader för redan passerade nivåer/milstolpar första gången (prev hämtas ur users)', async () => {
    const t = tables();
    t.users[0].current_level = 3;
    t.users[0].total_km = 105;
    use(t);
    await calculateUserTotals('u1');
    expect(t.activity_log).toHaveLength(0);
  });

  it('användare utan grupp loggas inte', async () => {
    const t = tables();
    t.users[0].group_id = null;
    use(t);
    await calculateUserTotals('u1');
    expect(t.activity_log).toHaveLength(0);
    expect(t.users[0].current_level).toBe(3); // beräkningen är opåverkad
  });

  it('misslyckad users-update → ingen loggrad (loggen följer EFTER lyckad skrivning)', async () => {
    const t = tables();
    use(t, { failWhen: (q) => (q.table === 'users' && q.select === null ? { message: 'update failed' } : null) });
    await calculateUserTotals('u1');
    expect(t.activity_log).toHaveLength(0);
  });

  it('en trasig logg fäller inte beräkningen: totaler sparas och titlar bearbetas ändå', async () => {
    const t = tables();
    use(t, { errors: { activity_log: { message: 'relation "activity_log" does not exist' } } });
    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();
    expect(t.users[0]).toMatchObject({ total_xp: 105, current_level: 3 });
    expect(processAllUsersTitles).toHaveBeenCalledWith('g1');
  });

  it('users.total_km (numeric(8,2)) jämförs avrundat: 99.996 km lagras som 100.00 och räknas som passerad nästa gång', async () => {
    const t = tables({ runs: [run('r1', '2020-01-01', 99.996, 10)] });
    t.users[0].total_km = 50;
    use(t);
    await calculateUserTotals('u1');
    expect(t.activity_log.filter((r) => r.type === 'run_milestone').map((r) => r.payload.threshold)).toEqual([100]);
  });
});

// ─── rank_passed (xp): observatören efter totalskrivningen ───────────────────────────────────────

describe('calculateUserTotals → recordRankPassesForXp', () => {
  const TODAY = '2026-10-15';
  const todayRun = (id: string, xp: number): Row => ({ id, user_id: 'u1', date: TODAY, distance: 55, xp_gained: xp }); // 2 × 55 km: passerar 100 km

  // Anna (u1) går från 0 till 105 XP idag och tar sig förbi Bertil (u2, 100 XP) som låg före vid dygnsskiftet.
  function passTables(): Record<string, Row[]> {
    const t = tables({ runs: [todayRun('r1', 60), todayRun('r2', 45)] });
    t.users[0] = { ...t.users[0], name: 'Anna', total_xp: 0, created_at: '2026-01-01T08:00:00.000Z' };
    t.users.push({ id: 'u2', name: 'Bertil', group_id: 'g1', total_xp: 100, event_xp: 0, current_level: 3, total_km: 0, created_at: '2026-01-01T08:00:00.000Z' });
    t.event_entries = [];
    return t;
  }
  const rankRows = (t: Record<string, Row[]>) => t.activity_log.filter((r) => r.type === 'rank_passed');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('sparar totaler och loggar nivå även när recordRankPassesForXp kastar', async () => {
    const t = passTables();
    use(t);
    vi.mocked(recordRankPassesForXp).mockRejectedValueOnce(new Error('rank news down'));

    await expect(calculateUserTotals('u1')).resolves.toBeUndefined();

    expect(t.users[0]).toMatchObject({ total_xp: 105, current_level: 3 });
    expect(t.activity_log.filter((r) => r.type === 'level_up').map((r) => r.payload.level)).toEqual([2, 3]);
    expect(processAllUsersTitles).toHaveBeenCalledWith('g1'); // kedjan fortsätter förbi observatören
  });

  it('rank-detektionen anropas efter totalskrivningen och med föregående total_xp', async () => {
    const t = passTables();
    use(t);
    const seen: Array<{ args: unknown[]; storedXp: number; loggedTypes: string[] }> = [];
    vi.mocked(recordRankPassesForXp).mockImplementationOnce(async (...args) => {
      seen.push({ args, storedXp: t.users[0].total_xp, loggedTypes: t.activity_log.map((r) => r.type) });
    });

    await calculateUserTotals('u1');

    expect(seen).toHaveLength(1);
    expect(seen[0].args).toEqual(['u1', 'g1', 0]); // föregående total_xp ur samma select som current_level/total_km/group_id
    expect(seen[0].storedXp).toBe(105); // totalerna var redan sparade
    expect(seen[0].loggedTypes).toContain('run_milestone'); // och level_up/run_milestone redan skrivna
  });

  it('en XP-vinst skriver rank_passed och kostar högst tre extra läsningar', async () => {
    const withNews = passTables();
    const a = use(withNews);
    await calculateUserTotals('u1');

    const without = passTables();
    const b = use(without);
    await calculateUserTotals('u1', { emitRankNews: false });

    expect(rankRows(withNews).map((r) => [r.actor_user_id, r.target_user_id])).toEqual([['u1', 'u2']]);
    const reads = (db: typeof a) => db.queries.filter((q) => q.mutation === undefined).length;
    expect(reads(a) - reads(b)).toBeLessThanOrEqual(3);
    expect(reads(a) - reads(b)).toBeGreaterThan(0);
  });

  it('emitRankNews false skriver inget och gör inga extra queries', async () => {
    const t = passTables();
    const db = use(t);

    await calculateUserTotals('u1', { emitRankNews: false });

    expect(recordRankPassesForXp).not.toHaveBeenCalled();
    expect(rankRows(t)).toHaveLength(0);
    expect(t.users[0].total_xp).toBe(105); // beräkningen är opåverkad
    expect(db.queries.some((q) => q.table === 'event_entries')).toBe(false);
    expect(db.queries.some((q) => q.table === 'users' && q.filters.some((f) => f.column === 'group_id'))).toBe(false);
  });

  it('emitRankNews false retractar ändå dagens rader vid en minskning, men skriver inga nya', async () => {
    const t = passTables();
    t.users[0].total_xp = 130; // lagrat 130, nytt 105: en minskning
    const db = use(t);

    await calculateUserTotals('u1', { emitRankNews: false });

    expect(recordRankPassesForXp).toHaveBeenCalledTimes(1);
    expect(recordRankPassesForXp).toHaveBeenCalledWith('u1', 'g1', 130, { mode: 'retract_only' });
    expect(rankRows(t)).toHaveLength(0);
    expect(db.queries.filter((q) => q.mutation === undefined && q.table === 'event_entries')).toHaveLength(1); // läsningen för retract
  });

  it('ingen XP-vinst ger inga extra queries', async () => {
    const t = passTables();
    t.users[0].total_xp = 105; // lagrat värde == nytt värde
    const db = use(t);

    await calculateUserTotals('u1');

    expect(recordRankPassesForXp).not.toHaveBeenCalled();
    expect(db.queries.some((q) => q.table === 'event_entries')).toBe(false);
    expect(db.queries.some((q) => q.table === 'users' && q.filters.some((f) => f.column === 'group_id'))).toBe(false);
  });

  it('en användare utan grupp anropar inte detektionen', async () => {
    const t = passTables();
    t.users[0].group_id = null;
    use(t);
    await calculateUserTotals('u1');
    expect(recordRankPassesForXp).not.toHaveBeenCalled();
  });

  it('en minskning anropar detektionen (för retract) med föregående total_xp', async () => {
    const t = passTables();
    t.users[0].total_xp = 130; // rundan raderades: lagrat 130, nytt 105
    use(t);
    await calculateUserTotals('u1');
    expect(recordRankPassesForXp).toHaveBeenCalledWith('u1', 'g1', 130);
  });
});
