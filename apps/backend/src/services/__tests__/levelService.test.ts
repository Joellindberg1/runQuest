/**
 * services/levelService.ts (RUN-137): ett DB-fel vid första läsningen ger fallback-värden,
 * men tjänsten får inte fastna på dem — nytt försök görs när TTL gått ut.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { FALLBACK_LEVEL_REQUIREMENTS } from '@runquest/shared';

const DB_ROWS = [
  { level: 1, xp_required: 0 },
  { level: 2, xp_required: 10 },
  { level: 3, xp_required: 20 },
];

type DbResult = { data: typeof DB_ROWS | null; error: { message: string } | null };

const ok: DbResult = { data: DB_ROWS, error: null };
const failing: DbResult = { data: null, error: { message: 'connection reset' } };

/** Returnerar en supabase-lik klient vars level_requirements-läsning ger resultaten i tur och ordning. */
function mockReads(...results: DbResult[]) {
  const order = vi.fn();
  const queue = [...results];
  order.mockImplementation(async () => queue.shift() ?? results[results.length - 1]);
  const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ order })) })) };
  vi.mocked(getSupabaseClient).mockReturnValue(client as any);
  return order;
}

async function freshService() {
  vi.resetModules();
  return (await import('../levelService.js')).levelService;
}

describe('levelService – retry efter fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('REPRO: DB-fel först, DB ok efter TTL -> DB-värdena används, inte fallback', async () => {
    mockReads(failing, ok);
    const service = await freshService();

    expect(await service.getAllLevelRequirements()).toEqual(FALLBACK_LEVEL_REQUIREMENTS);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(await service.getAllLevelRequirements()).toEqual(DB_ROWS);
  });

  it('fallback hålls kvar och DB läses inte om innan TTL gått ut', async () => {
    const read = mockReads(failing, ok);
    const service = await freshService();

    await service.getAllLevelRequirements();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);

    expect(await service.getAllLevelRequirements()).toEqual(FALLBACK_LEVEL_REQUIREMENTS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('misslyckas även retryn får fallback ett nytt TTL-fönster innan nästa försök', async () => {
    const read = mockReads(failing, failing, ok);
    const service = await freshService();

    await service.getAllLevelRequirements();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(await service.getAllLevelRequirements()).toEqual(FALLBACK_LEVEL_REQUIREMENTS);
    expect(read).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    await service.getAllLevelRequirements();
    expect(read).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(await service.getAllLevelRequirements()).toEqual(DB_ROWS);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('om getSupabaseClient kastar används fallback och nytt försök görs efter TTL', async () => {
    const service = await freshService();
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error('not configured');
    });
    expect(await service.getAllLevelRequirements()).toEqual(FALLBACK_LEVEL_REQUIREMENTS);

    mockReads(ok);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(await service.getAllLevelRequirements()).toEqual(DB_ROWS);
  });

  it('lyckad läsning cachas: inget nytt DB-anrop, ens långt efter TTL', async () => {
    const read = mockReads(ok, failing);
    const service = await freshService();

    expect(await service.getAllLevelRequirements()).toEqual(DB_ROWS);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(await service.getAllLevelRequirements()).toEqual(DB_ROWS);
    expect(await service.getLevelFromXP(15)).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
