/**
 * Titelhändelser (ADR 008 beslut 6): snapshot av innehavarna före/efter processAllUsersTitles,
 * ren diff → title_unlocked / title_taken / title_revoked. Endast framåt; emitNews:false för admin-underhåll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  testDatabaseConnection: vi.fn(),
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

const lb = (title_id: string, user_id: string, value: number, position = 1): Row => ({ title_id, user_id, value, position });

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
      { id: 'x', group_id: null, total_km: 5, longest_streak: 1 },
    ],
    runs: [],
    user_titles: [],
    title_leaderboard: [],
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('snapshotTitleHolders', () => {
  it('läser bara position 1 och normaliserar numeric till tal', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12.5), lb('t1', 'b', 9, 2), { ...lb('t2', 'b', 3), value: '3.0000' }];
    use(tables);
    expect(await snapshotTitleHolders()).toEqual([
      { title_id: 't1', user_id: 'a', value: 12.5 },
      { title_id: 't2', user_id: 'b', value: 3 },
    ]);
  });

  it('databasfel → null (diffen hoppas över), kastar inte', async () => {
    use(baseTables(), { errors: { title_leaderboard: { message: 'boom' } } });
    expect(await snapshotTitleHolders()).toBeNull();
  });
});

describe('emitTitleNews', () => {
  it('ingen → någon: title_unlocked med titelnamn som ögonblicksbild', async () => {
    const tables = baseTables();
    use(tables);
    await emitTitleNews([], [{ title_id: 't1', user_id: 'a', value: 12 }]);
    expect(tables.activity_log).toHaveLength(1);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_unlocked', group_id: 'g1', actor_user_id: 'a', target_user_id: null, is_backfill: false,
      occurred_at: NOW.toISOString(), dedupe_key: 'title_unlocked:t1:a:12',
      payload: { title_id: 't1', title_name: 'The Marathoner', metric_key: 'total_km', value: 12 },
    });
  });

  it('A → B där A behåller sin rad: title_taken/overtaken (aktör B, target A)', async () => {
    const tables = baseTables();
    tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 12 }, { user_id: 'b', title_id: 't1', value: 15 }];
    use(tables);
    await emitTitleNews([{ title_id: 't1', user_id: 'a', value: 12 }], [{ title_id: 't1', user_id: 'b', value: 15 }]);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_taken', actor_user_id: 'b', target_user_id: 'a', dedupe_key: 'title_taken:t1:b:a:15',
      payload: { value: 15, previous_value: 12, reason: 'overtaken', title_name: 'The Marathoner' },
    });
  });

  it('A → B där A:s user_titles-rad är borta: reason "revoked"', async () => {
    const tables = baseTables();
    tables.user_titles = [{ user_id: 'b', title_id: 't1', value: 3 }]; // A återkallad (issue #10)
    use(tables);
    await emitTitleNews([{ title_id: 't1', user_id: 'a', value: 12 }], [{ title_id: 't1', user_id: 'b', value: 3 }]);
    expect(tables.activity_log[0].payload).toMatchObject({ reason: 'revoked', previous_value: 12, value: 3 });
  });

  it('någon → ingen: title_revoked (aktör = förra innehavaren), dagen i nyckeln är Stockholm-dagen', async () => {
    const tables = baseTables();
    use(tables);
    await emitTitleNews([{ title_id: 't2', user_id: 'b', value: 4 }], []);
    expect(tables.activity_log[0]).toMatchObject({
      type: 'title_revoked', group_id: 'g1', actor_user_id: 'b', dedupe_key: 'title_revoked:t2:b:2026-10-05',
      payload: { title_id: 't2', title_name: 'The Early Bird', metric_key: 'early_run_count' },
    });
  });

  it('samma innehavare med ändrat värde → ingen rad och inga extra queries', async () => {
    const tables = baseTables();
    const db = use(tables);
    await emitTitleNews([{ title_id: 't1', user_id: 'a', value: 12 }], [{ title_id: 't1', user_id: 'a', value: 14 }]);
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries).toHaveLength(0);
  });

  it('samma byte upptäckt två gånger (samtidiga skrivningar) → exakt en rad', async () => {
    const tables = baseTables();
    tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 12 }, { user_id: 'b', title_id: 't1', value: 15 }];
    use(tables);
    const before = [{ title_id: 't1', user_id: 'a', value: 12 }];
    const after = [{ title_id: 't1', user_id: 'b', value: 15 }];
    await emitTitleNews(before, after);
    await emitTitleNews(before, after);
    expect(tables.activity_log).toHaveLength(1);
  });

  it('innehavare utan grupp hoppas över (ingen gruppavgränsad plats i loggen)', async () => {
    const tables = baseTables();
    use(tables);
    await emitTitleNews([], [{ title_id: 't1', user_id: 'x', value: 1 }]);
    expect(tables.activity_log).toHaveLength(0);
  });

  it('ett databasfel i uppslagen sväljs', async () => {
    use(baseTables(), { errors: { titles: { message: 'boom' } } });
    await expect(emitTitleNews([], [{ title_id: 't1', user_id: 'a', value: 1 }])).resolves.toBeUndefined();
  });
});

describe('EnhancedTitleService.processAllUsersTitles — snapshot-orkestrering', () => {
  /** Ersätter titelbearbetningen: skriver user_titles + title_leaderboard som DB-triggern skulle göra. */
  function simulate(service: EnhancedTitleService, tables: Record<string, Row[]>, mutate: () => void) {
    return vi.spyOn(service, 'processUserTitlesAfterRun').mockImplementation(async (userId: string) => {
      if (userId === 'a') mutate(); // en gång per bearbetning räcker
      void tables;
    });
  }

  it('titelbyte under bearbetningen → title_taken loggas, och bara en gång även vid omkörning', async () => {
    const tables = baseTables();
    tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 12 }, { user_id: 'b', title_id: 't1', value: 9 }];
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t1', 'b', 9, 2)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, tables, () => {
      tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 12 }, { user_id: 'b', title_id: 't1', value: 15 }];
      tables.title_leaderboard = [lb('t1', 'b', 15), lb('t1', 'a', 12, 2)];
    });

    await service.processAllUsersTitles('g1');
    expect(tables.activity_log.map((r) => r.type)).toEqual(['title_taken']);

    // omkörning: leaderboarden är oförändrad → inget nytt; och även om samma byte upptäcks igen → dedupe_key
    await service.processAllUsersTitles('g1');
    expect(tables.activity_log).toHaveLength(1);
  });

  it('inga ändringar → inga rader (ingen historieflod vid första deploy)', async () => {
    const tables = baseTables();
    tables.title_leaderboard = [lb('t1', 'a', 12), lb('t2', 'b', 4)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, tables, () => {});
    await service.processAllUsersTitles('g1');
    expect(tables.activity_log).toHaveLength(0);
  });

  it('första innehavaren av en titel → title_unlocked', async () => {
    const tables = baseTables();
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, tables, () => {
      tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 7 }];
      tables.title_leaderboard = [lb('t1', 'a', 7)];
    });
    await service.processAllUsersTitles('g1');
    expect(tables.activity_log.map((r) => [r.type, r.actor_user_id])).toEqual([['title_unlocked', 'a']]);
  });

  it('återkallad titel utan efterträdare → title_revoked', async () => {
    const tables = baseTables();
    tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 7 }];
    tables.title_leaderboard = [lb('t1', 'a', 7)];
    use(tables);
    const service = new EnhancedTitleService();
    simulate(service, tables, () => { tables.user_titles = []; tables.title_leaderboard = []; });
    await service.processAllUsersTitles('g1');
    expect(tables.activity_log.map((r) => [r.type, r.actor_user_id])).toEqual([['title_revoked', 'a']]);
  });

  it('emitNews:false (admin /titles/reprocess-all) → ingen rad och ingen snapshot-query', async () => {
    const tables = baseTables();
    const db = use(tables);
    const service = new EnhancedTitleService();
    simulate(service, tables, () => {
      tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 7 }];
      tables.title_leaderboard = [lb('t1', 'a', 7)];
    });
    await service.processAllUsersTitles(undefined, { emitNews: false });
    expect(tables.activity_log).toHaveLength(0);
    expect(db.queries.some((q) => q.table === 'title_leaderboard')).toBe(false);
  });

  it('en trasig logg fäller inte titelbearbetningen', async () => {
    const tables = baseTables();
    use(tables, { errors: { activity_log: { message: 'relation does not exist' } } });
    const service = new EnhancedTitleService();
    const spy = simulate(service, tables, () => {
      tables.user_titles = [{ user_id: 'a', title_id: 't1', value: 7 }];
      tables.title_leaderboard = [lb('t1', 'a', 7)];
    });
    await expect(service.processAllUsersTitles('g1')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it('titelbearbetningens egna fel påverkas inte: ett fel vid snapshot ger bara ingen logg', async () => {
    const tables = baseTables();
    use(tables, { errors: { title_leaderboard: { message: 'boom' } } });
    const service = new EnhancedTitleService();
    const spy = simulate(service, tables, () => {});
    await expect(service.processAllUsersTitles('g1')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2); // båda gruppmedlemmarna bearbetades
    expect(tables.activity_log).toHaveLength(0);
  });
});
