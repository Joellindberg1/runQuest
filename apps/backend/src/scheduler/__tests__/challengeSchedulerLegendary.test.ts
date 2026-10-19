/**
 * Legendary-autostarten följer samma startregel som en accept (ägarbeslut 2026-10-19): vid gruppens nästa midnatt, aldrig i
 * samma ögonblick, och med exakt duration_days kalenderdagar. Schemat körs var sjätte timme, så en utmaning får bara startas en
 * gång även om flera körningar hinner före midnatt. Ingen challenge_accepted skrivs (ADR 011 beslut 7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ crons: new Map<string, () => Promise<void>>() }));

vi.mock('node-cron', () => ({
  default: { schedule: (expr: string, cb: () => Promise<void>) => { h.crons.set(expr, cb); } },
}));
vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { getProgressForChallenge } from '../../services/challengeService.js';
import { startChallengeScheduler } from '../challengeScheduler.js';

const AUTO_MANAGE = '10 */6 * * *';
const tick = async () => { const cb = h.crons.get(AUTO_MANAGE); expect(cb).toBeDefined(); await cb!(); };

beforeEach(() => {
  vi.clearAllMocks();
  h.crons.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const SENT_FIVE_DAYS_AGO = '2026-06-29T10:00:00.000Z';

const world = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
  challenges: [{
    id: 'L1', status: 'pending', tier: 'legendary', metric: 'km', duration_days: 3,
    challenger_id: 'a', opponent_id: 'b', legendary_sent_at: SENT_FIVE_DAYS_AGO,
  }],
  activity_log: [],
  user_challenge_tokens: [],
  users: [],
  runs: [],
  ...over,
});

function use(tables: Record<string, Row[]>) {
  const db = createFakeDb(tables, { numericIds: ['activity_log'] });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  startChallengeScheduler();
  return db;
}

describe('auto-start av legendary', () => {
  it('startar vid gruppens nästa midnatt: kl. 23:59 Stockholm blir start_date nästa dag, med exakt duration_days dagar', async () => {
    const tables = world();
    use(tables);
    vi.setSystemTime(new Date('2026-07-04T21:59:00Z')); // 23:59 sommartid
    await tick();

    expect(tables.challenges[0]).toMatchObject({
      status: 'active',
      start_date: '2026-07-05',
      end_date: '2026-07-07', // 5, 6 och 7 juli: tre dagar
      determine_at: '2026-07-08T01:00:00.000Z', // 03:00 Stockholm dagen efter slutdagen
    });
  });

  it('kl. 00:10 Stockholm (schemat körs 00:10) startar den nästa midnatt, inte samma dag', async () => {
    const tables = world();
    use(tables);
    vi.setSystemTime(new Date('2026-07-03T22:10:00Z')); // 2026-07-04 00:10 sommartid
    await tick();

    expect(tables.challenges[0].start_date).toBe('2026-07-05');
  });

  it('rundor från dagen den autostartades räknas aldrig, rundor från startdagen till slutdagen räknas', async () => {
    const tables = world({
      runs: [
        { id: 'r1', user_id: 'a', date: '2026-07-04', distance: 10 }, // dagen då den autostartades
        { id: 'r2', user_id: 'a', date: '2026-07-05', distance: 3 },  // startdagen
        { id: 'r3', user_id: 'b', date: '2026-07-07', distance: 4 },  // slutdagen
        { id: 'r4', user_id: 'b', date: '2026-07-08', distance: 50 }, // efter slutdagen
      ],
    });
    use(tables);
    vi.setSystemTime(new Date('2026-07-04T10:10:00Z'));
    await tick();

    await expect(getProgressForChallenge('L1')).resolves.toEqual([
      { user_id: 'a', value: 3 },
      { user_id: 'b', value: 4 },
    ]);
  });

  it('skriver ingen challenge_accepted: autostarten är ingen accept', async () => {
    const tables = world();
    use(tables);
    vi.setSystemTime(new Date('2026-07-04T10:10:00Z'));
    await tick();

    expect(tables.challenges[0].status).toBe('active');
    expect(tables.activity_log).toEqual([]);
  });

  it('en andra körning sex timmar senare, före midnatt, startar den inte igen och ändrar ingenting', async () => {
    const tables = world();
    const db = use(tables);
    vi.setSystemTime(new Date('2026-07-04T10:10:00Z')); // 12:10 sommartid
    await tick();
    const afterFirst = { ...tables.challenges[0] };

    vi.setSystemTime(new Date('2026-07-04T16:10:00Z')); // 18:10, fortfarande före midnatt
    await tick();
    vi.setSystemTime(new Date('2026-07-04T22:10:00Z')); // 00:10 efter midnatt
    await tick();

    expect(tables.challenges[0]).toEqual(afterFirst);
    const starts = db.queries.filter((q) => q.table === 'challenges' && q.mutation === 'update');
    expect(starts).toHaveLength(1);
  });

  it('skrivningen är villkorad på status = pending, så en accept som hann före skrivs inte över', async () => {
    const tables = world();
    const db = use(tables);
    vi.setSystemTime(new Date('2026-07-04T10:10:00Z'));
    await tick();

    const update = db.queries.find((q) => q.table === 'challenges' && q.mutation === 'update');
    expect(update?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'id', value: 'L1' },
      { op: 'eq', column: 'status', value: 'pending' },
    ]));
  });

  it('en legendary som redan är aktiv (accepterad) rörs inte', async () => {
    const tables = world();
    Object.assign(tables.challenges[0], { status: 'active', start_date: '2026-07-04', end_date: '2026-07-06', determine_at: '2026-07-07T01:00:00.000Z' });
    use(tables);
    vi.setSystemTime(new Date('2026-07-04T10:10:00Z'));
    await tick();

    expect(tables.challenges[0]).toMatchObject({ start_date: '2026-07-04', end_date: '2026-07-06' });
  });
});
