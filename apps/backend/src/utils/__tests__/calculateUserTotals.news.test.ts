/**
 * Pack News-sidoeffekter i calculateUserTotals (ADR 008 beslut 5, ADR 005):
 * level_up och run_milestone loggas EFTER lyckad users-update, jämfört mot FÖREGÅENDE värden
 * (läses i samma select som event_xp), med gruppen ur users.group_id. Beräkningen rörs inte.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../services/levelService.js', () => ({
  // 0 → 1, 50 → 2, 100 → 3, 200 → 4
  getLevelFromXP: vi.fn(async (xp: number) => (xp >= 200 ? 4 : xp >= 100 ? 3 : xp >= 50 ? 2 : 1)),
}));
vi.mock('../../services/challengeService.js', () => ({ reconcileTokensForLevel: vi.fn(async () => undefined) }));
const processAllUsersTitles = vi.fn(async () => undefined);
vi.mock('../../services/enhancedTitleService.js', () => ({
  EnhancedTitleService: class { processAllUsersTitles = processAllUsersTitles; },
}));

import { getSupabaseClient } from '../../config/database.js';
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
    await calculateUserTotals('u1'); // OBS: inget groupId-argument (som Strava-importen)

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
    await expect(calculateUserTotals('u1', 'g1')).resolves.toBeUndefined();
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
