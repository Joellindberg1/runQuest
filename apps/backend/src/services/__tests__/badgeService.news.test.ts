/**
 * services/badgeService.ts — Pack News för badges (ADR 009 beslut 5, RUN-123): evaluateBadges skriver
 * badge_earned efter lyckad user_badges-skrivning och retractar raderna för förlorade tiers. Bygger på
 * `written` (det som FAKTISKT skrevs). Kör mot fakeDb; shared-funktionerna är inte mockade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { applyBadgeDiff, evaluateBadges } from '../badgeService.js';
import { activityKeys, diffBadgeTiers, type BadgeDiff } from '@runquest/shared';
import { createFakeDb, type Row, type FakeDbOptions } from '../../routes/__tests__/helpers/fakeDb.js';

const USER = 'u1';
const GROUP = 'g1';
const NOW = new Date('2026-10-11T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

function setup(tables: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  const db = createFakeDb(
    {
      runs: [],
      users: [{ id: USER, group_id: GROUP, longest_streak: 0, displayed_badge_series: [] }],
      user_badges: [],
      activity_log: [],
      ...tables,
    },
    { numericIds: ['activity_log'], ...options },
  );
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

async function newsOf(db: ReturnType<typeof setup>): Promise<Row[]> {
  const { data } = await db.client.from('activity_log').select('*').order('id');
  return data as Row[];
}

async function badgesOf(db: ReturnType<typeof setup>): Promise<Row[]> {
  const { data } = await db.client.from('user_badges').select('*').eq('user_id', USER).order('series');
  return data as Row[];
}

/** Skrivningar mot activity_log (upsert/delete). */
const newsWrites = (db: ReturnType<typeof setup>) =>
  db.queries.filter((q) => q.mutation && q.table === 'activity_log');

const run = (over: Row = {}): Row => ({
  id: 'r1', user_id: USER, date: '2026-10-01', distance: 3, xp_gained: 10,
  start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual',
  ...over,
});

const stored = (series: string, tier: number): Row => ({
  user_id: USER, series, tier, seen_tier: tier,
  earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
});

/** En befintlig badge_earned-rad som den ser ut när evaluateBadges tidigare skrivit den. */
const newsRow = (series: string, tier: number, previous: number | null = null): Row => ({
  group_id: GROUP, type: 'badge_earned', actor_user_id: USER, target_user_id: null,
  payload: { series, tier, previous_tier: previous }, payload_version: 1,
  dedupe_key: activityKeys.badgeEarned(USER, series, tier), is_backfill: false, occurred_at: '2026-01-01T00:00:00.000Z',
});

const keysOf = (rows: Row[]) => rows.map((r) => r.dedupe_key).sort();

describe('evaluateBadges — badge_earned (RUN-123 T2)', () => {
  it('första gången: exakt en badge_earned med previous_tier null, rätt grupp, aktör och tid', async () => {
    const db = setup({ runs: [run({ distance: 5 })] });

    await evaluateBadges(USER, { now: NOW });

    const news = await newsOf(db);
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({
      type: 'badge_earned', group_id: GROUP, actor_user_id: USER, target_user_id: null,
      payload: { series: 'milestoner', tier: 1, previous_tier: null }, payload_version: 1,
      dedupe_key: activityKeys.badgeEarned(USER, 'milestoner', 1), is_backfill: false, occurred_at: NOW_ISO,
    });
  });

  it('uppgradering 1→3: en rad för tier 3 med previous_tier 1', async () => {
    const db = setup({
      runs: [run({ id: 'big', distance: 22 })],
      user_badges: [stored('milestoner', 1)],
      activity_log: [newsRow('milestoner', 1)],
    });

    await evaluateBadges(USER, { now: NOW });

    const news = await newsOf(db);
    expect(news).toHaveLength(2);
    expect(news.find((r) => r.payload.tier === 3)).toMatchObject({
      type: 'badge_earned', payload: { series: 'milestoner', tier: 3, previous_tier: 1 },
    });
    expect(news.find((r) => r.payload.tier === 1)).toBeDefined();
  });

  it('omkörning utan ändring: ingen ny rad och ingen skrivning mot activity_log', async () => {
    const db = setup({ runs: [run({ distance: 5 })] });
    await evaluateBadges(USER, { now: NOW });
    const before = await newsOf(db);
    const queriesBefore = newsWrites(db).length;

    await evaluateBadges(USER, { now: NOW });

    expect(await newsOf(db)).toEqual(before);
    expect(newsWrites(db)).toHaveLength(queriesBefore);
  });

  it('två samtidiga utvärderingar ger ingen dubblett (dedupe_key)', async () => {
    const db = setup({ runs: [run({ distance: 5 })] });

    await Promise.all([evaluateBadges(USER, { now: NOW }), evaluateBadges(USER, { now: NOW })]);

    expect(await newsOf(db)).toHaveLength(1);
  });

  it('nedgradering 3→1: raderna för tier 3 och 2 retractas, tier 1 står kvar', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      user_badges: [stored('milestoner', 3)],
      activity_log: [newsRow('milestoner', 1), newsRow('milestoner', 2, 1), newsRow('milestoner', 3, 2)],
    });

    await evaluateBadges(USER, { now: NOW });

    expect(keysOf(await newsOf(db))).toEqual([activityKeys.badgeEarned(USER, 'milestoner', 1)]);
    expect((await badgesOf(db))[0]).toMatchObject({ series: 'milestoner', tier: 1 });
  });

  it('radering: alla rader för serien retractas, andra serier och andra användare rörs inte', async () => {
    const otherUsersRow = { ...newsRow('milestoner', 1), actor_user_id: 'u2', dedupe_key: activityKeys.badgeEarned('u2', 'milestoner', 1) };
    const db = setup({
      runs: [],
      user_badges: [stored('milestoner', 3)],
      activity_log: [
        newsRow('milestoner', 1), newsRow('milestoner', 2, 1), newsRow('milestoner', 3, 2),
        newsRow('early_bird', 1), otherUsersRow,
      ],
    });

    await evaluateBadges(USER, { now: NOW });

    expect(await badgesOf(db)).toEqual([]);
    expect(keysOf(await newsOf(db))).toEqual(
      [activityKeys.badgeEarned(USER, 'early_bird', 1), activityKeys.badgeEarned('u2', 'milestoner', 1)].sort(),
    );
  });

  it('återtagande efter retract: tier 3 nås igen och får en NY rad', async () => {
    const db = setup({
      runs: [run({ id: 'big', distance: 22 })],
      user_badges: [stored('milestoner', 3)],
      activity_log: [newsRow('milestoner', 1), newsRow('milestoner', 2, 1), newsRow('milestoner', 3, 2)],
    });
    // Rundan raderas → nedgradering till 0 (radering) → alla rader bort.
    await db.client.from('runs').delete().eq('id', 'big');
    await evaluateBadges(USER, { now: NOW });
    expect(await newsOf(db)).toEqual([]);

    // En ny 22 km-runda → insert på tier 3 → ny rad med previous_tier null.
    const later = new Date('2026-10-12T08:00:00.000Z');
    await db.client.from('runs').upsert({ ...run({ id: 'big2', distance: 22, date: '2026-10-12' }) }, { onConflict: 'id' });
    await evaluateBadges(USER, { now: later });

    const news = await newsOf(db);
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({
      payload: { series: 'milestoner', tier: 3, previous_tier: null }, occurred_at: later.toISOString(),
    });
  });

  it('markSeen: user_badges skrivs men inga news-rader och inga skrivningar mot activity_log', async () => {
    const db = setup({ runs: [run({ distance: 5 })] });

    await evaluateBadges(USER, { now: NOW, markSeen: true });

    expect(await badgesOf(db)).toHaveLength(1);
    expect(await newsOf(db)).toEqual([]);
    expect(newsWrites(db)).toHaveLength(0);
  });

  it('markSeen retractar inte heller (backfill/--silent rör aldrig loggen)', async () => {
    const db = setup({
      runs: [],
      user_badges: [stored('milestoner', 2)],
      activity_log: [newsRow('milestoner', 1), newsRow('milestoner', 2, 1)],
    });

    await evaluateBadges(USER, { now: NOW, markSeen: true });

    expect(await badgesOf(db)).toEqual([]);
    expect(await newsOf(db)).toHaveLength(2);
    expect(newsWrites(db)).toHaveLength(0);
  });

  it('fel i activity_log sväljs: user_badges står kvar, resultatet är intakt och felet loggas', async () => {
    const db = setup(
      { runs: [run({ distance: 5 })] },
      { failWhen: (q) => (q.table === 'activity_log' && q.mutation ? { message: 'check violation' } : null) },
    );

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result?.complete).toBe(true);
    expect(result?.written.inserts).toHaveLength(1);
    expect(await badgesOf(db)).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('retract-fel sväljs: user_badges-nedgraderingen står kvar', async () => {
    const db = setup(
      {
        runs: [run({ distance: 5 })],
        user_badges: [stored('milestoner', 3)],
        activity_log: [newsRow('milestoner', 3, 2)],
      },
      { failWhen: (q) => (q.table === 'activity_log' && q.mutation === 'delete' ? { message: 'boom' } : null) },
    );

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toBeNull();

    expect((await badgesOf(db))[0]).toMatchObject({ tier: 1 });
  });

  it('en kastande activity_log-query sväljs', async () => {
    const db = setup({ runs: [run({ distance: 5 })] });
    const real = db.client.from.bind(db.client);
    vi.mocked(getSupabaseClient).mockReturnValue({
      ...db.client,
      from: (table: string) => {
        if (table === 'activity_log') throw new Error('network down');
        return real(table);
      },
    } as any);

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toBeNull();

    expect(await badgesOf(db)).toHaveLength(1);
  });

  it('utan grupp: inga news-rader och ingen skrivning mot activity_log', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [{ id: USER, group_id: null, longest_streak: 0, displayed_badge_series: [] }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect(await badgesOf(db)).toHaveLength(1);
    expect(await newsOf(db)).toEqual([]);
    expect(newsWrites(db)).toHaveLength(0);
  });

  it('gruppen läses ur användarens egen rad, inte en annan användares', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [
        { id: 'u2', group_id: 'g2', longest_streak: 0, displayed_badge_series: [] },
        { id: USER, group_id: 'g7', longest_streak: 0, displayed_badge_series: [] },
      ],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await newsOf(db))[0]).toMatchObject({ group_id: 'g7' });
  });

  it('läsfel på users.group_id: sväljs, user_badges står kvar, ingen news', async () => {
    const db = setup(
      { runs: [run({ distance: 5 })] },
      { failWhen: (q) => (q.table === 'users' && q.select === 'group_id' ? { message: 'read failed' } : null) },
    );

    await expect(evaluateBadges(USER, { now: NOW, longestStreak: 0 })).resolves.not.toBeNull();

    expect(await badgesOf(db)).toHaveLength(1);
    expect(await newsOf(db)).toEqual([]);
  });

  it('partiell skrivning: insert faller men uppgraderingen lyckades — bara uppgraderingen ger news', async () => {
    // 120 km på en runda: milestoner 1→6 (upgrade) och earth_trotter tier 1 (insert).
    const db = setup(
      {
        runs: [run({ id: 'big', distance: 120 })],
        user_badges: [stored('milestoner', 1)],
        activity_log: [newsRow('milestoner', 1)],
      },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'upsert' ? { message: 'insert failed' } : null) },
    );

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result?.complete).toBe(false);
    const fresh = (await newsOf(db)).filter((r) => r.payload.tier !== 1 || r.payload.series !== 'milestoner');
    expect(fresh.map((r) => [r.payload.series, r.payload.tier, r.payload.previous_tier])).toEqual([['milestoner', 6, 1]]);
  });

  it('partiell skrivning: uppgraderingen faller men insertarna lyckades — bara inserten ger news', async () => {
    const db = setup(
      { runs: [run({ id: 'big', distance: 120 })], user_badges: [stored('milestoner', 1)], activity_log: [newsRow('milestoner', 1)] },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'update' ? { message: 'update failed' } : null) },
    );

    await evaluateBadges(USER, { now: NOW });

    const fresh = (await newsOf(db)).filter((r) => r.payload.series !== 'milestoner');
    expect(fresh.map((r) => [r.payload.series, r.payload.tier, r.payload.previous_tier])).toEqual([['earth_trotter', 1, null]]);
    expect((await newsOf(db)).filter((r) => r.payload.series === 'milestoner')).toHaveLength(1);
  });

  it('nedgraderingen faller: raderna retractas inte (badgen har fortfarande sin tier)', async () => {
    const db = setup(
      {
        runs: [run({ distance: 5 })],
        user_badges: [stored('milestoner', 3)],
        activity_log: [newsRow('milestoner', 1), newsRow('milestoner', 2, 1), newsRow('milestoner', 3, 2)],
      },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'update' ? { message: 'update failed' } : null) },
    );

    await evaluateBadges(USER, { now: NOW });

    expect(await newsOf(db)).toHaveLength(3);
  });

  it('raderingen faller: raderna retractas inte', async () => {
    const db = setup(
      {
        runs: [],
        user_badges: [stored('milestoner', 2)],
        activity_log: [newsRow('milestoner', 1), newsRow('milestoner', 2, 1)],
      },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'delete' ? { message: 'delete failed' } : null) },
    );

    await evaluateBadges(USER, { now: NOW });

    expect(await newsOf(db)).toHaveLength(2);
  });

  it('avbruten utvärdering (läsfel): ingen news skrivs eller retractas', async () => {
    const db = setup(
      { runs: [run({ distance: 5 })], activity_log: [newsRow('milestoner', 2)] },
      { errors: { runs: { message: 'down' } } },
    );

    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();

    expect(newsWrites(db)).toHaveLength(0);
  });
});

describe('applyBadgeDiff (backfill-vägen) skriver aldrig news', () => {
  it('inserts, upgrades och deletes via applyBadgeDiff ger inga skrivningar mot activity_log', async () => {
    const db = setup({
      user_badges: [stored('milestoner', 3), stored('early_bird', 1)],
      activity_log: [newsRow('milestoner', 3, 2), newsRow('early_bird', 1)],
    });
    const diff: BadgeDiff = diffBadgeTiers(
      [
        { series: 'milestoner', tier: 3, seen_tier: 3, earned_at: NOW_ISO, source_run_id: null },
        { series: 'early_bird', tier: 1, seen_tier: 1, earned_at: NOW_ISO, source_run_id: null },
      ],
      { milestoner: { tier: 1 }, early_bird: { tier: 0 }, earth_trotter: { tier: 2 } },
      { now: NOW, markSeen: true },
    );
    expect(diff.inserts.length + diff.downgrades.length + diff.deletes.length).toBeGreaterThan(0);

    const result = await applyBadgeDiff(USER, [], diff);

    expect(result.written.inserts).toHaveLength(1);
    expect(newsWrites(db)).toHaveLength(0);
    expect(await newsOf(db)).toHaveLength(2);
  });
});
