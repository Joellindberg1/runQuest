/**
 * scripts/backfillBadges.ts (ADR 009 beslut 10, RUN-124): dry-run som standard, --apply skriver via
 * evaluateBadges skrivväg med seen_tier = tier, --silent normaliserar även befintliga rader.
 * Körs mot fakeDb (filtrerande, tillämpar range/order/upsert/update/delete) — shared-funktionerna är inte mockade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { BADGE_SERIES, computeBadgeTiers, type BadgeRun } from '@runquest/shared';
import {
  describeNextTier,
  formatReport,
  parseArgs,
  planUserBackfill,
  runBackfillBadges,
  type BackfillBadgesOptions,
} from '../backfillBadges.js';
import { createFakeDb, type FakeDbOptions, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const OLD_ISO = '2026-01-01T00:00:00.000Z';
const GROUP_A = 'g-a';
const GROUP_B = 'g-b';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

const run = (over: Row = {}): Row => ({
  id: 'r1', user_id: 'anna', date: '2026-09-01', distance: 3, xp_gained: 10,
  start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual',
  ...over,
});

const badge = (over: Row = {}): Row => ({
  user_id: 'anna', series: 'milestoner', tier: 1, seen_tier: 0,
  earned_at: OLD_ISO, source_run_id: null, updated_at: OLD_ISO,
  ...over,
});

/**
 * Anna (grupp A): 12 km + 5 km på 25:00, svit 7 → milestoner 2 (Uncommon), speedster 2 (Uncommon), streak_keeper 1.
 * Bosse (grupp B): 6 km, svit 3 → milestoner 1 (Common), ingen streak_keeper (kräver 7 dagar).
 */
function world(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    users: [
      { id: 'anna', name: 'Anna', email: 'anna@secret.example', group_id: GROUP_A, longest_streak: 7, displayed_badge_series: [] },
      { id: 'bosse', name: 'Bosse', email: 'bosse@secret.example', group_id: GROUP_B, longest_streak: 3, displayed_badge_series: [] },
    ],
    runs: [
      run({ id: 'r1', distance: 12, date: '2026-09-01' }),
      run({ id: 'r2', distance: 5, date: '2026-09-02', moving_time: 1500 }),
      run({ id: 'r3', user_id: 'bosse', distance: 6, date: '2026-09-03' }),
    ],
    user_badges: [],
    activity_log: [],
    ...extra,
  };
}

function setup(tables: Record<string, Row[]> = world(), options: FakeDbOptions = {}) {
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { db, tables };
}

const opts = (over: Partial<BackfillBadgesOptions> = {}): BackfillBadgesOptions => ({
  apply: false, silent: false, series: null, ...over,
});

const mutations = (db: ReturnType<typeof setup>['db'], table?: string) =>
  db.queries.filter((q) => q.mutation && (!table || q.table === table));

const badgesOf = (tables: Record<string, Row[]>, userId: string) =>
  tables.user_badges.filter((b) => b.user_id === userId).sort((a, b) => a.series.localeCompare(b.series));

describe('parseArgs', () => {
  it('default: dry-run, alla serier, alla grupper', () => {
    expect(parseArgs([])).toEqual({ apply: false, silent: false, series: null });
  });

  it('--apply, --silent, --series och --group', () => {
    expect(parseArgs(['--apply', '--silent', '--series=early_bird, night_owl', '--group=g1'])).toEqual({
      apply: true, silent: true, series: ['early_bird', 'night_owl'], groupId: 'g1',
    });
  });

  it('okänd serie, tom serielista, tom grupp och okända argument stoppas', () => {
    expect(() => parseArgs(['--series=nope'])).toThrow(/Unknown series "nope"/);
    expect(() => parseArgs(['--series='])).toThrow(/--series/);
    expect(() => parseArgs(['--group='])).toThrow(/--group/);
    expect(() => parseArgs(['--force'])).toThrow(/Unknown argument "--force"/);
  });
});

describe('describeNextTier', () => {
  const series = (key: string) => BADGE_SERIES.find((s) => s.key === key)!;
  const runs: BadgeRun[] = [
    { id: 'a', date: '2026-09-01', distance_km: 12, start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual' },
    { id: 'b', date: '2026-09-02', distance_km: 5, start_time: null, moving_time: 1500, total_elevation_gain: null, is_treadmill: false, source: 'manual' },
  ];

  it('mått och tröskel i naturlig enhet mot nästa tiers egen regel', () => {
    const next = describeNextTier(series('milestoner'), 2, runs, { longest_streak: 0 });
    expect(next).toMatchObject({ tier: 3, tierName: 'Rare', measured: '12 km', threshold: '21.1 km' });
    expect(next!.percent).toBe(57);
  });

  it('Speedster (under tröskel): bästa tid som m:ss mot "under m:00"', () => {
    const next = describeNextTier(series('speedster'), 2, runs, { longest_streak: 0 });
    expect(next).toMatchObject({ tier: 3, tierName: 'Rare', measured: '25:00', threshold: 'under 25:00' });
  });

  it('Speedster utan kvalificerad runda: "no qualifying run"', () => {
    const next = describeNextTier(series('speedster'), 0, [runs[0]], { longest_streak: 0 });
    expect(next).toMatchObject({ tier: 1, measured: 'no qualifying run', threshold: 'under 35:00' });
  });

  it('serie på högsta nivån: null', () => {
    expect(describeNextTier(series('streak_keeper'), 6, runs, { longest_streak: 200 })).toBeNull();
  });

  it('Early Bird: samma fönster i alla nivåer, så 100 starter 06:30 är 100 / 200 mot tier 5', () => {
    const early = Array.from({ length: 100 }, (_, i): BadgeRun => ({
      id: `e${i}`, date: '2026-01-01', distance_km: 3, start_time: '2026-01-01T06:30:00Z',
      moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual',
    }));
    const next = describeNextTier(series('early_bird'), 4, early, { longest_streak: 0 });
    expect(next).toMatchObject({ tier: 5, tierName: 'Epic', measured: '100 runs', threshold: '200 runs', percent: 50 });
  });

  it('Precisionist räknar bara Strava: 3 av 5 Strava-rundor på hel km ger 3 / 5, manuella ger 0 / 5', () => {
    const exact = (source: 'manual' | 'strava', i: number): BadgeRun => ({
      id: `x${source}${i}`, date: '2026-01-01', distance_km: 5, start_time: null,
      moving_time: null, total_elevation_gain: null, is_treadmill: false, source,
    });
    const strava = [0, 1, 2].map((i) => exact('strava', i));
    const manual = [0, 1, 2, 3, 4, 5].map((i) => exact('manual', i));
    const next = describeNextTier(series('precisionist'), 0, [...strava, ...manual], { longest_streak: 0 });
    expect(next).toMatchObject({ tier: 1, measured: '3 runs', threshold: '5 runs', percent: 60 });
  });
});

describe('planUserBackfill', () => {
  const computed = { milestoner: { tier: 3, source_run_id: 'big' }, speedster: { tier: 0 } };
  const row = (over: Row) => ({ series: 'milestoner', tier: 1, seen_tier: 0, earned_at: OLD_ISO, source_run_id: null, ...over }) as any;

  it('diffen använder markSeen: ny och uppgraderad rad får seen_tier = tier', () => {
    const plan = planUserBackfill([row({})], { ...computed, climber: { tier: 2 } }, { silent: false, now: NOW });
    expect(plan.diff.upgrades[0]).toMatchObject({ series: 'milestoner', tier: 3, seen_tier: 3 });
    expect(plan.diff.inserts[0]).toMatchObject({ series: 'climber', tier: 2, seen_tier: 2 });
    expect(plan.normalizations).toEqual([]);
    expect(plan.pendingPopups).toBe(0);
  });

  it('utan --silent: oförändrad rad med seen_tier < tier ger ingen normalisering men räknas som väntande popup', () => {
    const plan = planUserBackfill([row({ tier: 3, seen_tier: 1 })], computed, { silent: false, now: NOW });
    expect(plan.diff.upgrades).toEqual([]);
    expect(plan.normalizations).toEqual([]);
    expect(plan.pendingPopups).toBe(1);
  });

  it('--silent: oförändrad rad normaliseras till seen_tier = tier', () => {
    const plan = planUserBackfill([row({ tier: 3, seen_tier: 1 })], computed, { silent: true, now: NOW });
    expect(plan.normalizations).toEqual([{ series: 'milestoner', tier: 3, previous_seen_tier: 1 }]);
  });

  it('--silent: nedgraderad rad där least(seen, tier) fortfarande är < tier normaliseras, raderad rad inte', () => {
    const plan = planUserBackfill(
      [row({ tier: 5, seen_tier: 1 }), row({ series: 'speedster', tier: 2, seen_tier: 0 })],
      computed,
      { silent: true, now: NOW },
    );
    expect(plan.diff.downgrades).toHaveLength(1);
    expect(plan.diff.deletes).toEqual([{ series: 'speedster', previous_tier: 2 }]);
    expect(plan.normalizations).toEqual([{ series: 'milestoner', tier: 3, previous_seen_tier: 1 }]);
  });

  it('rader för serier som beräkningen inte omfattar (utanför --series) lämnas ifred', () => {
    const plan = planUserBackfill([row({ series: 'early_bird', tier: 2, seen_tier: 0 })], computed, { silent: true, now: NOW });
    expect(plan.normalizations).toEqual([]);
    expect(plan.pendingPopups).toBe(0);
  });
});

describe('dry-run (T1)', () => {
  it('skriver inget: inga insert/update/delete/upsert mot någon tabell', async () => {
    const { db, tables } = setup();
    const before = JSON.stringify(tables);

    const report = await runBackfillBadges(opts(), NOW);

    expect(mutations(db)).toEqual([]);
    expect(JSON.stringify(tables)).toBe(before);
    expect(report.failed).toBe(0);
  });

  it('dry-run med --silent skriver heller inget (förhandsvisar normaliseringen)', async () => {
    const { db } = setup(world({ user_badges: [badge({ series: 'milestoner', tier: 2, seen_tier: 0 })] }));

    const report = await runBackfillBadges(opts({ silent: true }), NOW);

    expect(mutations(db)).toEqual([]);
    expect(report.users.find((u) => u.name === 'Anna')!.plan.normalizations).toBe(1);
  });

  it('rapporten innehåller tier per användare och serie samt tiernamn', async () => {
    setup();

    const report = await runBackfillBadges(opts(), NOW);
    const text = formatReport(report);

    const anna = report.users.find((u) => u.name === 'Anna')!;
    expect(anna.tiers).toMatchObject({ milestoner: 2, speedster: 2, streak_keeper: 1, earth_trotter: 0 });
    expect(text).toMatch(/DRY-RUN \(nothing is written\)/);
    expect(text).toMatch(/Anna\s+Uncommon \(2\)\s+-\s+-\s+Common \(1\)/); // Milestoner, Earth Trotter, Climber, Streak Keeper
    expect(text).toMatch(/Bosse\s+Common \(1\)/);
    for (const s of BADGE_SERIES) expect(text).toContain(s.name);
  });

  it('rapporten visar hur nära nästa nivå (mått och tröskel) och vad som skulle skrivas', async () => {
    setup();

    const text = formatReport(await runBackfillBadges(opts(), NOW));

    expect(text).toMatch(/Milestoner: Uncommon \(2\) → Rare: 12 km \/ 21\.1 km \(57%\)/);
    expect(text).toMatch(/Speedster: Uncommon \(2\) → Rare: 25:00 \/ under 25:00/);
    expect(text).toMatch(/Anna: 3 insert\(s\), 0 upgrade\(s\), 0 downgrade\(s\), 0 delete\(s\)/);
    expect(text).toMatch(/would be written/);
  });

  it('rapporten har en tierfördelning per serie (användare per tier)', async () => {
    setup();

    const report = await runBackfillBadges(opts(), NOW);

    expect(report.distribution.milestoner).toEqual({ 0: 0, 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
    expect(report.distribution.earth_trotter[0]).toBe(2);
    expect(formatReport(report)).toMatch(/Tier distribution/);
  });

  it('inga e-postadresser, lösenord eller tokens i rapporten; användarnamn är OK', async () => {
    setup();

    const text = formatReport(await runBackfillBadges(opts(), NOW));

    expect(text).not.toMatch(/secret\.example|@/);
    expect(text).toContain('Anna');
  });

  it('läser aldrig e-post, lösenordshash eller tokens (select på users har bara id, name, group_id, longest_streak)', async () => {
    const { db } = setup();

    await runBackfillBadges(opts(), NOW);

    const selects = db.queries.filter((q) => q.table === 'users' && !q.mutation).map((q) => q.select);
    for (const s of selects) expect(s).not.toMatch(/email|password|token|strava/i);
  });

  it('visar måldatabasens host (aldrig nycklar)', async () => {
    setup();
    const prev = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://abc.supabase.co';
    try {
      const report = await runBackfillBadges(opts(), NOW);
      expect(report.target).toBe('abc.supabase.co');
      expect(formatReport(report)).toMatch(/target database: abc\.supabase\.co/);
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prev;
    }
  });
});

describe('--apply (T2)', () => {
  it('skriver seen_tier = tier och inga activity_log-rader', async () => {
    const { db, tables } = setup();

    const report = await runBackfillBadges(opts({ apply: true }), NOW);

    const anna = badgesOf(tables, 'anna');
    expect(anna.map((b) => [b.series, b.tier, b.seen_tier])).toEqual([
      ['milestoner', 2, 2],
      ['speedster', 2, 2],
      ['streak_keeper', 1, 1],
    ]);
    expect(badgesOf(tables, 'bosse').map((b) => [b.series, b.tier, b.seen_tier])).toEqual([
      ['milestoner', 1, 1],
    ]);
    expect(tables.activity_log).toEqual([]);
    expect(db.queries.filter((q) => q.table === 'activity_log')).toEqual([]);
    expect(formatReport(report)).toMatch(/APPLY/);
    expect(report.failed).toBe(0);
  });

  it('skriver bara user_badges och users.displayed_badge_series — inga andra tabeller', async () => {
    const { db } = setup();

    await runBackfillBadges(opts({ apply: true }), NOW);

    const tablesWritten = new Set(mutations(db).map((q) => q.table));
    expect([...tablesWritten].sort()).toEqual(['user_badges', 'users']);
  });

  it('uppgradering av befintlig rad: seen_tier följer tier (ingen popup)', async () => {
    const { tables } = setup(world({
      user_badges: [badge({ series: 'milestoner', tier: 1, seen_tier: 1, user_id: 'anna' })],
    }));

    await runBackfillBadges(opts({ apply: true }), NOW);

    expect(badgesOf(tables, 'anna').find((b) => b.series === 'milestoner')).toMatchObject({ tier: 2, seen_tier: 2 });
  });

  it('omkörning --apply → noll skrivningar', async () => {
    const { db, tables } = setup();
    await runBackfillBadges(opts({ apply: true }), NOW);
    const afterFirst = JSON.stringify(tables);
    const writesBefore = mutations(db).length;

    const second = await runBackfillBadges(opts({ apply: true }), NOW);

    expect(mutations(db).length).toBe(writesBefore);
    expect(JSON.stringify(tables)).toBe(afterFirst);
    expect(second.totals.written).toBe(0);
    expect(formatReport(second)).toMatch(/Nothing to write/);
  });

  it('återkallade badges raderas och showcasen städas (samma skrivväg som evaluateBadges)', async () => {
    const { tables } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'earth_trotter', tier: 2, seen_tier: 2 })],
    }));
    tables.users[0].displayed_badge_series = ['earth_trotter'];

    await runBackfillBadges(opts({ apply: true }), NOW);

    expect(badgesOf(tables, 'anna').some((b) => b.series === 'earth_trotter')).toBe(false);
    // Earth Trotter städas bort; de tre nya serierna tar de lediga platserna.
    expect(tables.users[0].displayed_badge_series).not.toContain('earth_trotter');
  });

  it('utan --silent lämnas befintliga oförändrade rader med seen_tier < tier, och rapporten varnar för popups', async () => {
    const { tables } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 0 })],
    }));

    const report = await runBackfillBadges(opts({ apply: true }), NOW);

    expect(badgesOf(tables, 'anna').find((b) => b.series === 'milestoner')).toMatchObject({ tier: 2, seen_tier: 0 });
    expect(report.totals.pendingPopups).toBe(1);
    expect(formatReport(report)).toMatch(/1 existing row\(s\) have seen_tier < tier[\s\S]*--silent/);
  });
});

describe('--silent (T3)', () => {
  it('sätter seen_tier = tier även på befintliga oförändrade rader', async () => {
    const { tables } = setup(world({
      user_badges: [
        badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 0 }),
        badge({ user_id: 'bosse', series: 'milestoner', tier: 1, seen_tier: 0 }),
      ],
    }));

    const report = await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(badgesOf(tables, 'anna').find((b) => b.series === 'milestoner')).toMatchObject({ tier: 2, seen_tier: 2, updated_at: NOW_ISO });
    expect(badgesOf(tables, 'bosse').find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1, seen_tier: 1 });
    expect(report.totals.normalized).toBe(2);
    expect(report.totals.pendingPopups).toBe(0);
  });

  it('rör inte tier, earned_at eller source_run_id vid normalisering', async () => {
    const { tables } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 1, source_run_id: 'r1' })],
    }));

    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(badgesOf(tables, 'anna').find((b) => b.series === 'milestoner')).toMatchObject({
      tier: 2, seen_tier: 2, earned_at: OLD_ISO, source_run_id: 'r1',
    });
  });

  it('normaliseringen är en update med tier-vakt (en samtidig nedgradering bryter aldrig CHECK seen_tier <= tier)', async () => {
    const { db } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 0 })],
    }));

    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    const norm = mutations(db, 'user_badges').find((q) => q.mutation === 'update')!;
    expect(norm.filters).toContainEqual({ op: 'eq', column: 'user_id', value: 'anna' });
    expect(norm.filters).toContainEqual({ op: 'eq', column: 'series', value: 'milestoner' });
    expect(norm.filters).toContainEqual({ op: 'eq', column: 'tier', value: 2 });
  });

  it('omkörning --apply --silent → noll skrivningar', async () => {
    const { db } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 0 })],
    }));
    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);
    const writesBefore = mutations(db).length;

    const second = await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(mutations(db).length).toBe(writesBefore);
    expect(second.totals.written + second.totals.normalized).toBe(0);
  });

  it('nedgradering + --silent: raden hamnar på seen_tier = tier', async () => {
    const { tables } = setup(world({
      user_badges: [badge({ user_id: 'bosse', series: 'milestoner', tier: 3, seen_tier: 1 })],
    }));

    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(badgesOf(tables, 'bosse').find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1, seen_tier: 1 });
  });

  it('inga activity_log-rader med --silent heller', async () => {
    const { db } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 0 })],
    }));

    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(db.queries.filter((q) => q.table === 'activity_log')).toEqual([]);
  });
});

describe('visningen fylls av nya serier (samma skrivväg som evaluateBadges)', () => {
  const showcaseOf = (tables: Record<string, Row[]>, userId: string): string[] =>
    tables.users.find((u) => u.id === userId)!.displayed_badge_series;

  it('--apply fyller lediga platser med de nya serierna i serieordning, utan activity_log-rader', async () => {
    const { db, tables } = setup();

    await runBackfillBadges(opts({ apply: true }), NOW);

    expect(showcaseOf(tables, 'anna')).toEqual(['milestoner', 'streak_keeper', 'speedster']);
    expect(showcaseOf(tables, 'bosse')).toEqual(['milestoner']);
    expect(db.queries.filter((q) => q.table === 'activity_log')).toEqual([]);
    expect(tables.activity_log).toEqual([]);
  });

  it('--apply --silent fyller också, och fyller bara med nya serier (en befintlig rad som aldrig visats rörs inte)', async () => {
    const { db, tables } = setup(world({
      user_badges: [badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 0 })],
    }));

    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(showcaseOf(tables, 'anna')).toEqual(['streak_keeper', 'speedster']);
    expect(db.queries.filter((q) => q.table === 'activity_log')).toEqual([]);
  });

  it('en full visning ändras inte när en ny serie kommer', async () => {
    const full = ['milestoner', 'streak_keeper', 'speedster'];
    const { db, tables } = setup(world({
      user_badges: [
        badge({ user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 2 }),
        badge({ user_id: 'anna', series: 'streak_keeper', tier: 1, seen_tier: 1 }),
        badge({ user_id: 'anna', series: 'speedster', tier: 2, seen_tier: 2 }),
      ],
    }));
    tables.users[0].displayed_badge_series = [...full];
    tables.runs.push(run({ id: 'r4', date: '2026-09-04', distance: 3, total_elevation_gain: 600 })); // Climber 1 är ny

    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(badgesOf(tables, 'anna').map((b) => b.series)).toContain('climber');
    expect(showcaseOf(tables, 'anna')).toEqual(full);
    expect(mutations(db, 'users').filter((q) => q.filters.some((f) => f.column === 'id' && f.value === 'anna'))).toEqual([]);
  });

  it('en serie som användaren tagit bort ur visningen läggs inte tillbaka vid omkörning', async () => {
    const { db, tables } = setup();
    await runBackfillBadges(opts({ apply: true, silent: true }), NOW);
    expect(showcaseOf(tables, 'anna')).toEqual(['milestoner', 'streak_keeper', 'speedster']);

    // Anna tar bort Milestoner ur visningen.
    tables.users[0].displayed_badge_series = ['streak_keeper', 'speedster'];
    const writesBefore = mutations(db).length;

    const rerun = await runBackfillBadges(opts({ apply: true, silent: true }), NOW);

    expect(showcaseOf(tables, 'anna')).toEqual(['streak_keeper', 'speedster']);
    expect(mutations(db).length).toBe(writesBefore);
    expect(rerun.totals.written).toBe(0);
  });

  it('dry-run fyller ingenting', async () => {
    const { tables } = setup();

    await runBackfillBadges(opts(), NOW);

    expect(showcaseOf(tables, 'anna')).toEqual([]);
  });
});

describe('--series, --group och stora användare (T4)', () => {
  it('--series=<a,b> begränsar: bara de serierna räknas, rapporteras och skrivs', async () => {
    const { tables, db } = setup(world({
      // Raden skulle raderas av en full körning (Anna har 17 km) men ligger utanför --series
      user_badges: [badge({ user_id: 'anna', series: 'earth_trotter', tier: 2, seen_tier: 0 })],
    }));

    const report = await runBackfillBadges(opts({ apply: true, silent: true, series: ['milestoner', 'streak_keeper'] }), NOW);

    expect(badgesOf(tables, 'anna').map((b) => b.series)).toEqual(['earth_trotter', 'milestoner', 'streak_keeper']);
    // Utanför scope: orörd, inte ens normaliserad
    expect(badgesOf(tables, 'anna').find((b) => b.series === 'earth_trotter')).toMatchObject({ tier: 2, seen_tier: 0 });
    expect(Object.keys(report.users[0].tiers).sort()).toEqual(['milestoner', 'streak_keeper']);
    expect(report.series).toEqual(['milestoner', 'streak_keeper']);
    expect(mutations(db, 'user_badges').every((q) => q.mutation !== 'delete')).toBe(true);
    const text = formatReport(report);
    expect(text).not.toContain('Speedster');
    expect(text).toMatch(/series: milestoner, streak_keeper/);
  });

  it('--group=<id> begränsar: andra gruppers användare läses och skrivs inte', async () => {
    const { tables, db } = setup();

    const report = await runBackfillBadges(opts({ apply: true, groupId: GROUP_A }), NOW);

    expect(report.users.map((u) => u.name)).toEqual(['Anna']);
    expect(badgesOf(tables, 'bosse')).toEqual([]);
    expect(badgesOf(tables, 'anna').length).toBeGreaterThan(0);
    const usersQuery = db.queries.find((q) => q.table === 'users' && !q.mutation)!;
    expect(usersQuery.filters).toContainEqual({ op: 'eq', column: 'group_id', value: GROUP_A });
    expect(db.queries.filter((q) => q.table === 'runs').every((q) => q.filters.some((f) => f.column === 'user_id' && f.value === 'anna'))).toBe(true);
  });

  it('användare med 1 200 rundor räknas fullt ut (båda sidorna), även i dry-run', async () => {
    const runs: Row[] = [];
    for (let i = 0; i < 1200; i++) {
      const day = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      // 1000 × 0,9 km (900 km, tier 2) + 200 × 1 km på sida två => 1 100 km = tier 3 bara om sida två räknas
      runs.push(run({ id: `r${String(i).padStart(4, '0')}`, date: day, distance: i < 1000 ? 0.9 : 1 }));
    }
    const { db } = setup(world({ runs }));

    const report = await runBackfillBadges(opts({ groupId: GROUP_A }), NOW);

    const anna = report.users[0];
    expect(anna.runCount).toBe(1200);
    expect(anna.tiers.earth_trotter).toBe(3);
    const pages = db.queries.filter((q) => q.table === 'runs').map((q) => q.range);
    expect(pages).toEqual([[0, 999], [1000, 1999]]);
  });

  it('användare med 1 200 rundor skrivs fullt ut vid --apply', async () => {
    const runs: Row[] = [];
    for (let i = 0; i < 1200; i++) {
      const day = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      runs.push(run({ id: `r${String(i).padStart(4, '0')}`, date: day, distance: i < 1000 ? 0.9 : 1 }));
    }
    const { tables } = setup(world({ runs }));

    await runBackfillBadges(opts({ apply: true, groupId: GROUP_A }), NOW);

    expect(badgesOf(tables, 'anna').find((b) => b.series === 'earth_trotter')).toMatchObject({ tier: 3, seen_tier: 3 });
  });

  it('resultatet stämmer med computeBadgeTiers för samma indata', async () => {
    setup();
    const report = await runBackfillBadges(opts(), NOW);
    const expected = computeBadgeTiers(
      [
        { id: 'r1', date: '2026-09-01', distance_km: 12, start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual' },
        { id: 'r2', date: '2026-09-02', distance_km: 5, start_time: null, moving_time: 1500, total_elevation_gain: null, is_treadmill: false, source: 'manual' },
      ],
      { longest_streak: 7 },
    );
    const anna = report.users.find((u) => u.name === 'Anna')!;
    for (const [key, result] of Object.entries(expected)) expect(anna.tiers[key]).toBe(result.tier);
  });
});

describe('fel', () => {
  it('läsfel för en användare: ingen skrivning för henne, övriga körs, rapporten pekar ut felet', async () => {
    const { tables } = setup(world(), {
      failWhen: (q) =>
        q.table === 'runs' && !q.mutation && q.filters.some((f) => f.column === 'user_id' && f.value === 'anna')
          ? { message: 'boom' }
          : null,
    });

    const report = await runBackfillBadges(opts({ apply: true }), NOW);

    expect(badgesOf(tables, 'anna')).toEqual([]);
    expect(badgesOf(tables, 'bosse').length).toBeGreaterThan(0);
    expect(report.failed).toBe(1);
    expect(report.users.find((u) => u.name === 'Anna')!.error).toMatch(/runs/);
    expect(formatReport(report)).toMatch(/FAILED[\s\S]*Anna/);
  });

  it('en skrivning som faller markerar användaren som misslyckad (exit-kod 1 i CLI:t)', async () => {
    const { tables } = setup(world(), {
      failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'upsert' ? { message: 'write failed' } : null),
    });

    const report = await runBackfillBadges(opts({ apply: true }), NOW);

    expect(tables.user_badges).toEqual([]);
    expect(report.failed).toBe(2);
  });

  it('läsfel på users avbryter hela körningen', async () => {
    setup(world(), { errors: { users: { message: 'down' } } });

    await expect(runBackfillBadges(opts(), NOW)).rejects.toThrow(/users/);
  });

  it('ingen användare i scope: tom rapport utan fel', async () => {
    setup(world());

    const report = await runBackfillBadges(opts({ groupId: 'finns-inte' }), NOW);

    expect(report.users).toEqual([]);
    expect(formatReport(report)).toMatch(/0 user\(s\)/);
  });
});
