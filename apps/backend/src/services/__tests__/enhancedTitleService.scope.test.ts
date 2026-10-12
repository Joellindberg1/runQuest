/**
 * RUN-104: processAllUsersTitles är gruppavgränsad och fail-closed. Utan groupId krävs ett uttryckligt
 * allGroups:true — annars kastas innan någon användare läses (Strava-importen räknade tidigare om
 * ALLA gruppers användare eftersom groupId saknades).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { get client() { return holder.client; } },
  getSupabaseClient: vi.fn(() => holder.client),
}));
vi.mock('../titleLeaderboardService', () => ({ titleLeaderboardService: { refreshTitleLeaderboard: vi.fn() } }));

import { EnhancedTitleService } from '../enhancedTitleService.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

function tables(): Record<string, Row[]> {
  return {
    users: [
      { id: 'u1', group_id: 'g1', total_km: 10, longest_streak: 1 },
      { id: 'u2', group_id: 'g1', total_km: 20, longest_streak: 2 },
      { id: 'u3', group_id: 'g2', total_km: 30, longest_streak: 3 },
      { id: 'u4', group_id: null, total_km: 40, longest_streak: 4 },
    ],
    runs: [],
    titles: [],
    user_titles: [],
    title_leaderboard: [],
    activity_log: [],
  };
}

function setup() {
  const db = createFakeDb(tables(), { numericIds: ['activity_log'] });
  holder.client = db.client;
  const service = new EnhancedTitleService();
  const processed = vi.spyOn(service, 'processUserTitlesAfterRun').mockResolvedValue(undefined);
  const processedIds = () => processed.mock.calls.map((c) => c[0]).sort();
  return { db, service, processed, processedIds };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('processAllUsersTitles — fail-closed omfång', () => {
  it('utan groupId och utan allGroups kastar och rör ingen användare', async () => {
    const { db, service, processed } = setup();
    await expect(service.processAllUsersTitles()).rejects.toThrow(/groupId|allGroups/);
    await expect(service.processAllUsersTitles(undefined, { emitNews: false })).rejects.toThrow(/groupId|allGroups/);
    expect(processed).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(0); // inte ens users lästes
  });

  it('tom groupId behandlas som saknad (kastar)', async () => {
    const { service, processed, db } = setup();
    await expect(service.processAllUsersTitles('')).rejects.toThrow();
    expect(processed).not.toHaveBeenCalled();
    expect(db.queries).toHaveLength(0);
  });

  it('allGroups: false utan groupId kastar', async () => {
    const { service, processed } = setup();
    await expect(service.processAllUsersTitles(undefined, { allGroups: false })).rejects.toThrow();
    expect(processed).not.toHaveBeenCalled();
  });

  it('allGroups: true räknar om alla grupper (även användare utan grupp), utan group_id-filter', async () => {
    const { db, service, processedIds } = setup();
    await service.processAllUsersTitles(undefined, { allGroups: true, emitNews: false });
    expect(processedIds()).toEqual(['u1', 'u2', 'u3', 'u4']);
    const usersRead = db.queries.find((q) => q.table === 'users')!;
    expect(usersRead.filters.some((f) => f.column === 'group_id')).toBe(false);
  });
});

describe('processAllUsersTitles — gruppavgränsning', () => {
  it("processAllUsersTitles('g1') räknar bara om g1: u1,u2 räknas, u3 (g2) och u4 (null) rörs inte", async () => {
    const { db, service, processed, processedIds } = setup();
    await service.processAllUsersTitles('g1');
    expect(processedIds()).toEqual(['u1', 'u2']);
    expect(processed.mock.calls.map((c) => c[0])).not.toContain('u3');
    expect(processed.mock.calls.map((c) => c[0])).not.toContain('u4');

    const usersRead = db.queries.find((q) => q.table === 'users')!;
    expect(usersRead.filters).toContainEqual({ op: 'eq', column: 'group_id', value: 'g1' });
    // inga rundor lästes för användare utanför gruppen
    const runReads = db.queries.filter((q) => q.table === 'runs').flatMap((q) => q.filters.map((f) => f.value));
    expect(runReads.sort()).toEqual(['u1', 'u2']);
  });

  it('groupId vinner över allGroups: true (aldrig bredare än den uttryckliga gruppen)', async () => {
    const { service, processedIds } = setup();
    await service.processAllUsersTitles('g2', { allGroups: true });
    expect(processedIds()).toEqual(['u3']);
  });
});
