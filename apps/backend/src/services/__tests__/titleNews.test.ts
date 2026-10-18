/**
 * Titelhändelser (ADR 008 beslut 6, ADR 012 beslut 5.3): snapshot av position 1–2 per grupp före/efter processGroupTitles,
 * ren diff → title_unlocked / title_taken / title_revoked. Endast framåt; emitNews:false för admin-underhåll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));

// Titelmotorerna/leaderboard-tjänsten behövs inte: processUserTitlesAfterRun ersätts i testen
// (den skriver user_titles; DB-triggern uppdaterar title_leaderboard — här simulerat direkt).
vi.mock('../titleLeaderboardService', () => ({ titleLeaderboardService: { refreshTitleLeaderboard: vi.fn() } }));

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { emitTitleNews, snapshotTitleHolders } from '../titleNews.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function use(tables: Record<string, Row[]>, options: Parameters<typeof createFakeDb>[1] = {}) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'], ...options });
  holder.client = db.client;
  return db;
}

const lb = (title_id: string, user_id: string, value: number, position = 1, group_id = 'g1'): Row => ({ group_id, title_id, user_id, value, position });
const ut = (title_id: string, user_id: string, value: number, group_id = 'g1'): Row => ({ group_id, title_id, user_id, value });
const holderOf = (title_id: string, user_id: string, value: number, group_id = 'g1') => ({ group_id, title_id, user_id, value });

function baseTables(): Record<string, Row[]> {
  return {
    activity_log: [],
    titles: [
      { id: 't1', name: 'The Marathoner', metric_key: 'total_km' },
      { id: 't2', name: 'The Early Bird', metric_key: 'early_run_count' },
    ],
    users: [
      { id: 'a', group_id: 'g1', total_km: 10, longest_streak: 2 },
      { id: 'b', group_id: 'g1', total_km: 20, longest_streak: 3 },
      { id: 'c', group_id: 'g2', total_km: 8, longest_streak: 1 },
      { id: 'd', group_id: 'g2', total_km: 9, longest_streak: 1 },
    ],
    group_members: [
      { id: 'ma', user_id: 'a', group_id: 'g1', role: 'member', starts_on: null, left_at: null },
      { id: 'mb', user_id: 'b', group_id: 'g1', role: 'member', starts_on: null, left_at: null },
      { id: 'mc', user_id: 'c', group_id: 'g2', role: 'member', starts_on: null, left_at: null },
      { id: 'md', user_id: 'd', group_id: 'g2', role: 'member', starts_on: null, left_at: null },
    ],
    runs: [],
    user_titles: [],
    title_leaderboard: [],
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('snapshotTitleHolders', () => {
  it('tar position 1 och 2 för gruppen: innehavaren bär tvåan, numeric normaliseras till tal', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12.5), lb('t1', 'b', 9, 2), { ...lb('t2', 'b', 3), value: '3.0000' }];
    use(tables);
    expect(await snapshotTitleHolders('g1')).toEqual([
      { group_id: 'g1', title_id: 't1', user_id: 'a', value: 12.5, runner_up: { user_id: 'b', value: 9 } },
      { group_id: 'g1', title_id: 't2', user_id: 'b', value: 3, runner_up: null },
    ]);
  });

  it('läser bara den omräknade gruppens rader och aldrig en annan grupps', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t1', 'b', 9, 2), lb('t1', 'd', 7, 1, 'g2'), lb('t1', 'c', 5, 2, 'g2')];
    use(tables);
    expect(await snapshotTitleHolders('g2')).toEqual([
      { group_id: 'g2', title_id: 't1', user_id: 'd', value: 7, runner_up: { user_id: 'c', value: 5 } },
    ]);
  });

  it('position 3 och lägre tas inte med', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t1', 'b', 9, 2), lb('t1', 'c', 8, 3)];
    use(tables);
    expect(await snapshotTitleHolders('g1')).toEqual([
      { group_id: 'g1', title_id: 't1', user_id: 'a', value: 12, runner_up: { user_id: 'b', value: 9 } },
    ]);
  });

  it('en rad på plats 2 utan plats 1 ger ingen innehavare', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'b', 9, 2)];
    use(tables);
    expect(await snapshotTitleHolders('g1')).toEqual([]);
  });

  it('gruppen kommer ur title_leaderboard.group_id, inget uppslag av användarnas grupp', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12)];
    const db = use(tables);
    await snapshotTitleHolders('g1');
    expect(db.queries.some((q) => q.table === 'users')).toBe(false);
  });

  it('tom ranking → tom lista', async () => {
    use(baseTables());
    expect(await snapshotTitleHolders('g1')).toEqual([]);
  });

  it('utan groupId → null och ingen läsning (ingen global bild)', async () => {
    const db = use(baseTables());
    expect(await snapshotTitleHolders('')).toBeNull();
    expect(await snapshotTitleHolders(undefined as unknown as string)).toBeNull();
    expect(db.queries).toHaveLength(0);
  });

  it('databasfel → null (diffen hoppas över), kastar inte', async () => {
    use(baseTables(), { errors: { title_leaderboard: { message: 'boom' } } });
    expect(await snapshotTitleHolders('g1')).toBeNull();
  });
});

describe('emitTitleNews', () => {
  it('ingen → någon: title_unlocked med titelnamn som ögonblicksbild', async () => {
    const tables = baseTables();
    use(tables);
    await emitTitleNews('g1', [], [holderOf('t1', 'a', 12)]);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_unlocked', group_id: 'g1', actor_user_id: 'a', target_user_id: null, is_backfill: false,
      occurred_at: NOW.toISOString(), dedupe_key: 'title_unlocked:t1:a:12:2026-10-05',
      payload: { title_id: 't1', title_name: 'The Marathoner', metric_key: 'total_km', value: 12 },
    });
  });

  it('A → B där A behåller sin rad: title_taken/overtaken (aktör B, target A)', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15)];
    use(tables);
    await emitTitleNews('g1', [holderOf('t1', 'a', 12)], [holderOf('t1', 'b', 15)]);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_taken', group_id: 'g1', actor_user_id: 'b', target_user_id: 'a', dedupe_key: 'title_taken:t1:b:a:15:2026-10-05',
      payload: { value: 15, previous_value: 12, reason: 'overtaken', title_name: 'The Marathoner' },
    });
  });

  it('A → B där A:s user_titles-rad är borta: reason "revoked"', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'b', 3)]; // A återkallad (issue #10)
    use(tables);
    await emitTitleNews('g1', [holderOf('t1', 'a', 12)], [holderOf('t1', 'b', 3)]);
    expect(tables.activity_log[0].payload).toMatchObject({ reason: 'revoked', previous_value: 12, value: 3 });
  });

  it('förra innehavarens rad i en ANNAN grupp räknas inte som att titeln behållits i den här: reason "revoked"', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'b', 3), ut('t1', 'a', 12, 'g2')];
    use(tables);
    await emitTitleNews('g1', [holderOf('t1', 'a', 12)], [holderOf('t1', 'b', 3)]);
    expect(tables.activity_log[0].payload).toMatchObject({ reason: 'revoked' });
  });

  it('någon → ingen: title_revoked (aktör = förra innehavaren), dagen i nyckeln är Stockholm-dagen', async () => {
    const tables = baseTables();
    use(tables);
    await emitTitleNews('g1', [holderOf('t2', 'b', 4)], []);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_revoked', group_id: 'g1', actor_user_id: 'b', dedupe_key: 'title_revoked:t2:b:2026-10-05',
      payload: { title_id: 't2', title_name: 'The Early Bird', metric_key: 'early_run_count' },
    });
  });

  it('samma innehavare med ändrat värde → ingen rad och inga extra queries', async () => {
    const tables = baseTables();
    const db = use(tables);
    await emitTitleNews('g1', [holderOf('t1', 'a', 12)], [holderOf('t1', 'a', 14)]);
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries).toHaveLength(0);
  });

  it('ändrad tvåa med samma innehavare → ingen rad (diffen går bara på position 1)', async () => {
    const tables = baseTables();
    const db = use(tables);
    await emitTitleNews(
      'g1',
      [{ ...holderOf('t1', 'a', 12), runner_up: { user_id: 'b', value: 9 } }],
      [{ ...holderOf('t1', 'a', 12), runner_up: { user_id: 'c', value: 11 } }],
    );
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries).toHaveLength(0);
  });

  it('samma byte upptäckt två gånger (samtidiga skrivningar) → exakt en rad', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15)];
    use(tables);
    const before = [holderOf('t1', 'a', 12)];
    const after = [holderOf('t1', 'b', 15)];
    await emitTitleNews('g1', before, after);
    await emitTitleNews('g1', before, after);
    expect(tables.activity_log).toHaveLength(1);
  });

  it('legitim upprepning en ANNAN dag (titeln tappas och vinns tillbaka med samma värde) loggas igen', async () => {
    const tables = baseTables();
    use(tables);
    const after = [holderOf('t1', 'a', 12)];
    await emitTitleNews('g1', [], after);                       // 2026-10-05
    vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
    await emitTitleNews('g1', [], after);                       // samma value, två dagar senare
    expect(tables.activity_log.map((r) => r.dedupe_key)).toEqual([
      'title_unlocked:t1:a:12:2026-10-05', 'title_unlocked:t1:a:12:2026-10-07',
    ]);
  });

  it('en hållare som tillhör en annan grupp än den omräknade ger ingen rad', async () => {
    const tables = baseTables();
    use(tables);
    await emitTitleNews('g1', [], [holderOf('t1', 'c', 8, 'g2')]);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('ändringar i en annan grupp än den omräknade loggas inte, ändringen i den egna gör det', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15), ut('t1', 'c', 8, 'g2'), ut('t1', 'd', 9, 'g2')];
    use(tables);
    await emitTitleNews(
      'g1',
      [holderOf('t1', 'a', 12), holderOf('t1', 'c', 8, 'g2')],
      [holderOf('t1', 'b', 15), holderOf('t1', 'd', 9, 'g2')],
    );
    expect(tables.activity_log.map((r) => [r.type, r.group_id, r.actor_user_id])).toEqual([['title_taken', 'g1', 'b']]);
  });

  it('utan groupId loggas ingenting', async () => {
    const tables = baseTables();
    const db = use(tables);
    await emitTitleNews('', [], [holderOf('t1', 'a', 12, '')]);
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries).toHaveLength(0);
  });

  it('ett databasfel i uppslagen sväljs', async () => {
    use(baseTables(), { errors: { titles: { message: 'boom' } } });
    await expect(emitTitleNews('g1', [], [holderOf('t1', 'a', 1)])).resolves.toBeUndefined();
  });
});

describe('EnhancedTitleService.processGroupTitles — snapshot-orkestrering', () => {
  /** Ersätter titelbearbetningen: skriver user_titles + title_leaderboard som DB-triggern skulle göra. */
  function simulate(service: EnhancedTitleService, mutate: () => void) {
    return vi.spyOn(service, 'processUserTitlesAfterRun').mockImplementation(async (member: { userId: string }) => {
      if (member.userId === 'a' || member.userId === 'c') mutate(); // en gång per bearbetning räcker
    });
  }

  it('titelbyte under bearbetningen → title_taken loggas, och bara en gång även vid omkörning', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 9)];
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t1', 'b', 9, 2)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, () => {
      tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15)];
      tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2)];
    });

    await service.processGroupTitles('g1');
    expect(tables.activity_log.map((r) => r.type)).toEqual(['title_taken']);

    // omkörning: leaderboarden är oförändrad → inget nytt; och även om samma byte upptäcks igen → dedupe_key
    await service.processGroupTitles('g1');
    expect(tables.activity_log).toHaveLength(1);
  });

  it('en grupp: samma rad (typ, aktörer, payload, dedupe_key) som före gruppsatt snapshot', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 9)];
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t1', 'b', 9, 2)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, () => {
      tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15)];
      tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2)];
    });
    await service.processGroupTitles('g1');
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_taken', group_id: 'g1', actor_user_id: 'b', target_user_id: 'a', is_backfill: false,
      occurred_at: NOW.toISOString(), dedupe_key: 'title_taken:t1:b:a:15:2026-10-05',
      payload: {
        title_id: 't1', title_name: 'The Marathoner', metric_key: 'total_km', value: 15, previous_value: 12, reason: 'overtaken',
      },
    });
    expect(Object.keys(tables.activity_log[0].payload as object).sort()).toEqual(
      ['metric_key', 'previous_value', 'reason', 'title_id', 'title_name', 'value'],
    );
  });

  it('inga ändringar → inga rader (ingen historieflod vid första deploy)', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t2', 'b', 4)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, () => {});
    await service.processGroupTitles('g1');
    expect(tables.activity_log).toHaveLength(0);
  });

  it('första innehavaren av en titel → title_unlocked', async () => {
    const tables = baseTables();
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, () => {
      tables.user_titles = [ut('t1', 'a', 7)];
      tables.title_leaderboard = [lb('t1', 'a', 7)];
    });
    await service.processGroupTitles('g1');
    expect(tables.activity_log.map((r) => [r.type, r.actor_user_id])).toEqual([['title_unlocked', 'a']]);
  });

  it('återkallad titel utan efterträdare → title_revoked', async () => {
    const tables = baseTables();
    tables.user_titles = [ut('t1', 'a', 7)];
    tables.title_leaderboard = [lb('t1', 'a', 7)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, () => { tables.user_titles = []; tables.title_leaderboard = []; });
    await service.processGroupTitles('g1');
    expect(tables.activity_log.map((r) => [r.type, r.actor_user_id])).toEqual([['title_revoked', 'a']]);
  });

  it('emitNews:false (admin /titles/reprocess-all) → ingen rad och ingen snapshot-query', async () => {
    const tables = baseTables();
    const db = use(tables);
    const service = new EnhancedTitleService();
    simulate(service, () => {
      tables.user_titles = [ut('t1', 'a', 7)];
      tables.title_leaderboard = [lb('t1', 'a', 7)];
    });
    await service.processAllGroupsTitles({ emitNews: false });
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries.some((q) => q.table === 'title_leaderboard')).toBe(false);
  });

  it('en trasig logg fäller inte titelbearbetningen', async () => {
    const tables = baseTables();
    use(tables, { errors: { activity_log: { message: 'relation does not exist' } } });
    const service = new EnhancedTitleService();
    const spy = simulate(service, () => {
      tables.user_titles = [ut('t1', 'a', 7)];
      tables.title_leaderboard = [lb('t1', 'a', 7)];
    });
    await expect(service.processGroupTitles('g1')).resolves.toEqual({ total: 2, processed: 2, failed: 0 });
    expect(spy).toHaveBeenCalled();
  });

  it('titelbearbetningens egna fel påverkas inte: ett fel vid snapshot ger bara ingen logg', async () => {
    const tables = baseTables();
    use(tables, { errors: { title_leaderboard: { message: 'boom' } } });
    const service = new EnhancedTitleService();
    const spy = simulate(service, () => {});
    await expect(service.processGroupTitles('g1')).resolves.toEqual({ total: 2, processed: 2, failed: 0 });
    expect(spy).toHaveBeenCalledTimes(2); // båda gruppmedlemmarna bearbetades
    expect(tables.activity_log).toHaveLength(0);
  });

  describe('två grupper', () => {
    function twoGroups() {
      const tables = baseTables();
      tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 9), ut('t1', 'c', 5, 'g2'), ut('t1', 'd', 4, 'g2')];
      tables.title_leaderboard = [lb('t1', 'a', 12), lb('t1', 'b', 9, 2), lb('t1', 'c', 5, 1, 'g2'), lb('t1', 'd', 4, 2, 'g2')];
      return tables;
    }

    it('innehavarbyte i grupp 1 ger title_taken bara i grupp 1', async () => {
      const tables = twoGroups();
      use(tables);
      const service = new EnhancedTitleService();
      simulate(service, () => {
        tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15), ut('t1', 'c', 5, 'g2'), ut('t1', 'd', 4, 'g2')];
        tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2), lb('t1', 'c', 5, 1, 'g2'), lb('t1', 'd', 4, 2, 'g2')];
      });
      await service.processGroupTitles('g1');
      expect(tables.activity_log.map((r) => [r.type, r.group_id, r.actor_user_id, r.target_user_id])).toEqual([['title_taken', 'g1', 'b', 'a']]);
    });

    it('ingen nyhet i grupp B när grupp A ändras', async () => {
      // grupp 2 räknas om medan grupp 1:s lista ändras av en annan körning: grupp 2:s bild ser det aldrig
      const tables = twoGroups();
      use(tables);
      const service = new EnhancedTitleService();
      simulate(service, () => {
        tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2), lb('t1', 'c', 5, 1, 'g2'), lb('t1', 'd', 4, 2, 'g2')];
      });
      await service.processGroupTitles('g2');
      expect(tables.activity_log).toHaveLength(0);
    });

    it('omräkning av alla grupper: varje grupps byte loggas i sin egen grupp', async () => {
      const tables = twoGroups();
      use(tables);
      const service = new EnhancedTitleService();
      vi.spyOn(service, 'processUserTitlesAfterRun').mockImplementation(async (member: { userId: string }) => {
        if (member.userId === 'a') {
          tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15), ut('t1', 'c', 5, 'g2'), ut('t1', 'd', 4, 'g2')];
          tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2), lb('t1', 'c', 5, 1, 'g2'), lb('t1', 'd', 4, 2, 'g2')];
        }
        if (member.userId === 'c') {
          tables.user_titles = [ut('t1', 'a', 12), ut('t1', 'b', 15), ut('t1', 'c', 5, 'g2'), ut('t1', 'd', 6, 'g2')];
          tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2), lb('t1', 'd', 6, 1, 'g2'), lb('t1', 'c', 5, 2, 'g2')];
        }
      });
      await service.processAllGroupsTitles();
      expect(tables.activity_log.map((r) => [r.type, r.group_id, r.actor_user_id, r.target_user_id])).toEqual([
        ['title_taken', 'g1', 'b', 'a'],
        ['title_taken', 'g2', 'd', 'c'],
      ]);
    });

    it('omräkning av alla grupper med emitNews:false ger inga nyheter i någon grupp', async () => {
      const tables = twoGroups();
      use(tables);
      const service = new EnhancedTitleService();
      simulate(service, () => {
        tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2), lb('t1', 'd', 6, 1, 'g2'), lb('t1', 'c', 5, 2, 'g2')];
      });
      await service.processAllGroupsTitles({ emitNews: false });
      expect(tables.activity_log).toHaveLength(0);
    });
  });
});
