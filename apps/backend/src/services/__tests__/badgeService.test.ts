/**
 * services/badgeService.ts (ADR 009 beslut 2): evaluateBadges läser rundor sidvis, räknar med den riktiga
 * computeBadgeTiers, diffar med den riktiga diffBadgeTiers och skriver bara skillnaden till user_badges.
 * Kör mot fakeDb (filtrerande, tillämpar range/order/upsert/update/delete) — shared-funktionerna är inte mockade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { evaluateBadges, MAX_RUNS_PAGES } from '../badgeService.js';
import { createFakeDb, type Row, type FakeDbOptions } from '../../routes/__tests__/helpers/fakeDb.js';

const USER = 'u1';
const OTHER = 'u2';
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
    { runs: [], users: [{ id: USER, longest_streak: 0, displayed_badge_series: [] }], user_badges: [], ...tables },
    options,
  );
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return db;
}

/** Tabellernas aktuella innehåll nås via en ny from()-läsning; här en genväg som läser fakeDb direkt. */
async function badgesOf(db: ReturnType<typeof setup>, userId = USER): Promise<Row[]> {
  const { data } = await db.client.from('user_badges').select('*').eq('user_id', userId).order('series');
  return data as Row[];
}

const run = (over: Row = {}): Row => ({
  id: 'r1', user_id: USER, date: '2026-10-01', distance: 3, xp_gained: 10,
  start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false, source: 'manual',
  ...over,
});

const writes = (db: ReturnType<typeof setup>, table?: string) =>
  db.queries.filter((q) => q.mutation && (!table || q.table === table));

describe('evaluateBadges — läsning (T2, T3)', () => {
  it('1 200 rundor över två sidor: alla räknas och Earth Trotter-summan stämmer', async () => {
    // 1000 rundor à 0,9 km (900 km = tier 2) + 200 à 1 km på sida två: 1 100 km = tier 3 (>= 1000) bara om sida två räknas.
    const runs: Row[] = [];
    for (let i = 0; i < 1200; i++) {
      const day = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      runs.push(run({ id: `r${String(i).padStart(4, '0')}`, date: day, distance: i < 1000 ? 0.9 : 1 }));
    }
    const db = setup({ runs });

    await evaluateBadges(USER, { now: NOW });

    const earth = (await badgesOf(db)).find((b) => b.series === 'earth_trotter');
    expect(earth).toMatchObject({ tier: 3, seen_tier: 0 });
    const runPages = db.queries.filter((q) => q.table === 'runs' && !q.mutation).map((q) => q.range);
    expect(runPages).toEqual([[0, 999], [1000, 1999]]);
  });

  it('exakt 1 000 rundor: nästa sida ligger bortom slutet (PGRST103) och är slutet, inget fel', async () => {
    const runs: Row[] = [];
    for (let i = 0; i < 1000; i++) {
      const day = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      runs.push(run({ id: `r${i}`, date: day, distance: 1 }));
    }
    const db = setup({ runs });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'earth_trotter')).toMatchObject({ tier: 3 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('läser bara användarens egna rundor, sorterat på date och id', async () => {
    const db = setup({ runs: [run({ id: 'a', distance: 5 }), run({ id: 'b', user_id: OTHER, distance: 50 })] });

    await evaluateBadges(USER, { now: NOW });

    const q = db.queries.find((x) => x.table === 'runs')!;
    expect(q.filters).toContainEqual({ op: 'eq', column: 'user_id', value: USER });
    expect(q.select).toMatch(/\bid\b.*\bdate\b.*\bdistance\b.*\bstart_time\b.*\bmoving_time\b.*\btotal_elevation_gain\b.*\bis_treadmill\b.*\bsource\b/);
    const rows = await badgesOf(db);
    expect(rows.find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1 }); // 5 km, inte den andres 50 km
  });

  it('start_time skickas som rå sträng: fem klockan 05:00 ger Early Bird tier 1', async () => {
    const runs = [1, 2, 3, 4, 5].map((d) => run({ id: `e${d}`, date: `2026-10-0${d}`, start_time: `2026-10-0${d}T05:00:00Z` }));
    const db = setup({ runs });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'early_bird')).toMatchObject({ tier: 1 });
  });

  it('runs.source läses: fem Strava-rundor på hel km ger Precisionist tier 1, fem manuella ger ingen rad', async () => {
    const stravaRuns = [1, 2, 3, 4, 5].map((d) => run({ id: `s${d}`, date: `2026-10-0${d}`, distance: 4, source: 'strava' }));
    const strava = setup({ runs: stravaRuns });
    await evaluateBadges(USER, { now: NOW });
    expect((await badgesOf(strava)).find((b) => b.series === 'precisionist')).toMatchObject({ tier: 1 });

    const manualRuns = [1, 2, 3, 4, 5].map((d) => run({ id: `m${d}`, date: `2026-10-0${d}`, distance: 4, source: 'manual' }));
    const manual = setup({ runs: manualRuns });
    await evaluateBadges(USER, { now: NOW });
    expect((await badgesOf(manual)).find((b) => b.series === 'precisionist')).toBeUndefined();
  });

  it('en rad utan source (null) behandlas som manuell och räknas inte i Precisionist', async () => {
    const runs = [1, 2, 3, 4, 5].map((d) => run({ id: `n${d}`, date: `2026-10-0${d}`, distance: 4, source: null }));
    const db = setup({ runs });
    await evaluateBadges(USER, { now: NOW });
    expect((await badgesOf(db)).find((b) => b.series === 'precisionist')).toBeUndefined();
  });

  it('numeric-kolumner som strängar tolkas som tal (distance "5.00", höjd "500.0")', async () => {
    const db = setup({ runs: [run({ id: 'n1', distance: '5.00', total_elevation_gain: '500.0' })] });

    await evaluateBadges(USER, { now: NOW });

    const rows = await badgesOf(db);
    expect(rows.find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1, source_run_id: 'n1' });
    expect(rows.find((b) => b.series === 'climber')).toMatchObject({ tier: 1 });
  });

  it('is_treadmill reaches the badge measure: treadmill elevation does not count, null counts as outdoors', async () => {
    const treadmill = setup({ runs: [run({ id: 't1', total_elevation_gain: 600, is_treadmill: true })] });
    await evaluateBadges(USER, { now: NOW });
    expect((await badgesOf(treadmill)).find((b) => b.series === 'climber')).toBeUndefined();

    const legacy = setup({ runs: [run({ id: 't2', total_elevation_gain: 600, is_treadmill: null })] });
    await evaluateBadges(USER, { now: NOW });
    expect((await badgesOf(legacy)).find((b) => b.series === 'climber')).toMatchObject({ tier: 1 });
  });

  it('longestStreak i opts används och users.longest_streak läses inte', async () => {
    const db = setup({ runs: [run()] });

    await evaluateBadges(USER, { longestStreak: 7, now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'streak_keeper')).toMatchObject({ tier: 1 });
    expect(db.queries.some((q) => q.table === 'users' && q.select?.includes('longest_streak'))).toBe(false);
  });

  it('utan opts.longestStreak läses users.longest_streak', async () => {
    const db = setup({
      runs: [run()],
      users: [{ id: USER, longest_streak: 14, displayed_badge_series: [] }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'streak_keeper')).toMatchObject({ tier: 2 });
  });
});

describe('evaluateBadges — skrivning (T3)', () => {
  it('första rundan på 5 km: insert Milestoner tier 1, seen_tier 0', async () => {
    const db = setup({ runs: [run({ id: 'r1', distance: 5 })] });

    await evaluateBadges(USER, { now: NOW });

    expect(await badgesOf(db)).toEqual([
      {
        user_id: USER, series: 'milestoner', tier: 1, seen_tier: 0,
        earned_at: NOW_ISO, source_run_id: 'r1', updated_at: NOW_ISO,
      },
    ]);
  });

  it('en samtidig utvärdering hann skriva raden först: insertens upsert ignorerar dubbletten (seen_tier skrivs inte över)', async () => {
    const tables: Record<string, Row[]> = {
      runs: [run({ distance: 5 })],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: [] }],
      user_badges: [],
    };
    const competing = {
      user_id: USER, series: 'milestoner', tier: 1, seen_tier: 1,
      earned_at: '2026-01-01T00:00:00.000Z', source_run_id: 'x', updated_at: '2026-01-01T00:00:00.000Z',
    };
    const db = createFakeDb(tables, {
      // Raden dyker upp mellan vår läsning (tom) och vår skrivning.
      failWhen: (q) => {
        if (q.table === 'user_badges' && q.mutation === 'upsert') tables.user_badges = [{ ...competing }];
        return null;
      },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await evaluateBadges(USER, { now: NOW });

    expect(tables.user_badges).toEqual([competing]);
  });

  it('uppgradering: tier, earned_at, source_run_id och updated_at uppdateras, seen_tier lämnas', async () => {
    const db = setup({
      runs: [run({ id: 'big', distance: 10 })],
      user_badges: [{
        user_id: USER, series: 'milestoner', tier: 1, seen_tier: 1,
        earned_at: '2026-01-01T00:00:00.000Z', source_run_id: 'old', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db))[0]).toEqual({
      user_id: USER, series: 'milestoner', tier: 2, seen_tier: 1,
      earned_at: NOW_ISO, source_run_id: 'big', updated_at: NOW_ISO,
    });
  });

  it('nedgradering: tier och seen_tier i SAMMA update, earned_at orört', async () => {
    const db = setup({
      runs: [run({ id: 'r5', distance: 5 })],
      user_badges: [{
        user_id: USER, series: 'milestoner', tier: 3, seen_tier: 3,
        earned_at: '2026-01-01T00:00:00.000Z', source_run_id: 'gone', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db))[0]).toEqual({
      user_id: USER, series: 'milestoner', tier: 1, seen_tier: 1,
      earned_at: '2026-01-01T00:00:00.000Z', source_run_id: 'r5', updated_at: NOW_ISO,
    });
    const updates = writes(db, 'user_badges').filter((q) => q.mutation === 'update');
    expect(updates).toHaveLength(1);
  });

  it('nedgradering lämnar en lägre seen_tier som den är (least)', async () => {
    const db = setup({
      runs: [run({ distance: 10 })],
      user_badges: [{
        user_id: USER, series: 'milestoner', tier: 4, seen_tier: 1,
        earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db))[0]).toMatchObject({ tier: 2, seen_tier: 1 });
  });

  it('markSeen: ny rad får seen_tier = tier', async () => {
    const db = setup({ runs: [run({ distance: 10 })] });

    await evaluateBadges(USER, { now: NOW, markSeen: true });

    expect((await badgesOf(db))[0]).toMatchObject({ series: 'milestoner', tier: 2, seen_tier: 2 });
  });

  it('rör aldrig en annan användares rader', async () => {
    const other = {
      user_id: OTHER, series: 'milestoner', tier: 5, seen_tier: 2,
      earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
    };
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: [] }, { id: OTHER, longest_streak: 0, displayed_badge_series: ['milestoner'] }],
      user_badges: [{ ...other }],
    });

    await evaluateBadges(USER, { now: NOW });
    const evaluationQueries = [...db.queries]; // innan kontrolläsningen nedan

    expect(await badgesOf(db, OTHER)).toEqual([other]);
    // Samtliga läsningar av user_badges är filtrerade på användaren.
    for (const q of evaluationQueries.filter((x) => x.table === 'user_badges' && x.mutation !== 'upsert')) {
      expect(q.filters).toContainEqual({ op: 'eq', column: 'user_id', value: USER });
    }
  });
});

describe('evaluateBadges — idempotens (T4)', () => {
  it('omkörning utan ändring ger noll skrivningar', async () => {
    const db = setup({ runs: [run({ id: 'r1', distance: 12 }), run({ id: 'r2', date: '2026-10-02', distance: 6 })] });

    await evaluateBadges(USER, { now: NOW });
    const afterFirst = await badgesOf(db);
    const writesAfterFirst = writes(db).length;
    expect(writesAfterFirst).toBeGreaterThan(0);

    await evaluateBadges(USER, { now: new Date('2026-10-12T00:00:00.000Z') });

    expect(writes(db)).toHaveLength(writesAfterFirst); // inga nya skrivningar mot någon tabell
    expect(await badgesOf(db)).toEqual(afterFirst);
  });

  it('serier som inte ändrats ger ingen skrivning även när en annan ändras', async () => {
    const db = setup({
      runs: [run({ id: 'r1', distance: 12 })],
      user_badges: [{
        user_id: USER, series: 'milestoner', tier: 2, seen_tier: 2,
        earned_at: '2026-01-01T00:00:00.000Z', source_run_id: 'r1', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect(writes(db, 'user_badges')).toHaveLength(0);
  });
});

describe('evaluateBadges — showcase-rensning (T5)', () => {
  const stored = (series: string, tier = 1): Row => ({
    user_id: USER, series, tier, seen_tier: tier,
    earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
  });

  // Fem rundor på 2,5 km kl 05:00: Early Bird tier 1 och inget annat (ingen hel km, ingen runda >= 5 km, summa < 100 km).
  const earlyBirdRuns = (): Row[] =>
    [1, 2, 3, 4, 5].map((d) => run({ id: `e${d}`, date: `2026-10-0${d}`, distance: 2.5, start_time: `2026-10-0${d}T05:00:00Z` }));

  const showcaseOf = async (db: ReturnType<typeof setup>): Promise<string[]> => {
    const { data } = await db.client.from('users').select('*').eq('id', USER).single();
    return data.displayed_badge_series;
  };

  it('radering av rundan: raden raderas och serien försvinner ur displayed_badge_series (EN users-update)', async () => {
    const db = setup({
      runs: earlyBirdRuns(),
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner', 'climber', 'early_bird'] }],
      user_badges: [stored('milestoner'), stored('climber'), stored('early_bird')],
    });

    await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect((await badgesOf(db)).map((b) => b.series)).toEqual(['early_bird']);
    expect(await showcaseOf(db)).toEqual(['early_bird']);
    expect(writes(db, 'users')).toHaveLength(1);
    expect(writes(db, 'users')[0].mutation).toBe('update');
    expect(writes(db, 'users')[0].filters).toContainEqual({ op: 'eq', column: 'id', value: USER });
  });

  it('ingen users-update när visade badges inte innehåller den raderade serien', async () => {
    const db = setup({
      runs: earlyBirdRuns(),
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['early_bird'] }],
      user_badges: [stored('milestoner'), stored('early_bird')],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db)).map((b) => b.series)).toEqual(['early_bird']);
    expect(writes(db, 'users')).toHaveLength(0);
  });

  it('ingen users-update när inget ska rensas (och bara showcasen läses från users när longestStreak ges)', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner'] }],
      user_badges: [stored('milestoner')],
    });

    await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(writes(db, 'users')).toHaveLength(0);
    expect(db.queries.filter((q) => q.table === 'users').map((q) => q.select)).toEqual(['displayed_badge_series']);
  });

  it('självläkning: en serie i showcasen som inte finns i user_badges städas även utan radering den här körningen', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['climber', 'milestoner'] }],
      user_badges: [stored('milestoner')],
    });

    const result = await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(await showcaseOf(db)).toEqual(['milestoner']);
    expect(writes(db, 'users')).toHaveLength(1);
    expect(result).toMatchObject({ complete: true });
    expect(result?.written.deletes).toEqual([]);
  });

  it('delete OK men showcase-updaten faller: nästa körning rensar', async () => {
    let failShowcaseUpdate = true;
    const db = setup(
      {
        runs: [],
        users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner', 'early_bird'] }],
        user_badges: [stored('milestoner')],
      },
      { failWhen: (q) => (failShowcaseUpdate && q.table === 'users' && q.mutation === 'update' ? { message: 'boom' } : null) },
    );

    const first = await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(await badgesOf(db)).toEqual([]); // raden är borta ...
    expect(await showcaseOf(db)).toEqual(['milestoner', 'early_bird']); // ... men showcasen sitter kvar
    expect(first?.complete).toBe(false);
    expect(first?.written.deletes.map((d) => d.series)).toEqual(['milestoner']); // raderingen lyckades och rapporteras

    failShowcaseUpdate = false;
    const second = await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(await showcaseOf(db)).toEqual([]); // early_bird ägs inte heller
    expect(second).toMatchObject({ complete: true });
    expect(second?.written.deletes).toEqual([]); // inget att radera: ingen dubbel news
  });

  it('showcase-läsfel: sväljs och loggas, raderingen rapporteras ändå och complete är false', async () => {
    const db = setup(
      {
        runs: [],
        users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner'] }],
        user_badges: [stored('milestoner')],
      },
      { failWhen: (q) => (q.table === 'users' && !q.mutation ? { message: 'read failed' } : null) },
    );

    const result = await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(await badgesOf(db)).toEqual([]);
    expect(result?.complete).toBe(false);
    expect(result?.written.deletes.map((d) => d.series)).toEqual(['milestoner']);
    expect(errorSpy).toHaveBeenCalled();
    expect(writes(db, 'users')).toHaveLength(0);
  });

  it('en nedgradering (inte radering) lämnar showcasen orörd', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner'] }],
      user_badges: [stored('milestoner', 3)],
    });

    await evaluateBadges(USER, { now: NOW });

    expect(writes(db, 'users')).toHaveLength(0);
  });

  it('raderingen misslyckas: showcasen rensas inte (raden finns kvar)', async () => {
    const db = setup(
      {
        runs: [],
        users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner'] }],
        user_badges: [stored('milestoner')],
      },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'delete' ? { message: 'boom' } : null) },
    );

    await evaluateBadges(USER, { now: NOW });

    expect(writes(db, 'users')).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('evaluateBadges — felhantering (T6)', () => {
  const stored = (series: string, tier: number): Row => ({
    user_id: USER, series, tier, seen_tier: tier,
    earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
  });

  it('användare utan rundor och utan rader: inga rader, ingen krasch', async () => {
    const db = setup();

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(await badgesOf(db)).toEqual([]);
    expect(writes(db)).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('läsfel på runs: sväljs, loggas och inget skrivs (en tom läsning får inte radera badges)', async () => {
    const db = setup(
      { runs: [run({ distance: 5 })], user_badges: [stored('milestoner', 3)] },
      { errors: { runs: { message: 'db down' } } },
    );

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(writes(db)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('fel på andra sidan av rundorna: ingen utvärdering på halva datat, inget skrivs', async () => {
    const runs: Row[] = [];
    for (let i = 0; i < 1100; i++) {
      const day = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      runs.push(run({ id: `r${i}`, date: day, distance: 0.1 }));
    }
    const db = setup(
      { runs, user_badges: [stored('earth_trotter', 3)] },
      { failWhen: (q) => (q.table === 'runs' && q.range?.[0] === 1000 ? { message: 'timeout' } : null) },
    );

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(writes(db)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('läsfel på user_badges: sväljs, inget skrivs', async () => {
    const db = setup({ runs: [run({ distance: 5 })] }, { errors: { user_badges: { message: 'nope' } } });

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    expect(writes(db)).toHaveLength(0);
  });

  it('läsfel på users.longest_streak: sväljs, inget skrivs (en saknad streak får inte degradera Streak Keeper)', async () => {
    const db = setup(
      { runs: [run({ distance: 5 })], user_badges: [stored('streak_keeper', 3)] },
      { errors: { users: { message: 'nope' } } },
    );

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(writes(db)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('användaren finns inte: sväljs och inget skrivs', async () => {
    const db = setup({ runs: [run({ distance: 5 })], users: [] });

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(writes(db)).toHaveLength(0);
  });

  it('skrivfel på insert: sväljs och loggas', async () => {
    setup(
      { runs: [run({ distance: 5 })] },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'upsert' ? { message: 'write failed' } : null) },
    );

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('skrivfel på en update stoppar inte de övriga skrivningarna', async () => {
    const db = setup(
      {
        runs: [run({ distance: 12 }), run({ id: 'r2', date: '2026-10-02', distance: 120, xp_gained: 1 })],
        user_badges: [stored('milestoner', 1)],
      },
      { failWhen: (q) => (q.table === 'user_badges' && q.mutation === 'update' ? { message: 'write failed' } : null) },
    );

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    // Upgraden (milestoner) föll; insertarna (earth_trotter m.fl.) skrevs ändå.
    const rows = await badgesOf(db);
    expect(rows.find((b) => b.series === 'earth_trotter')).toMatchObject({ tier: 1 });
    expect(rows.find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1 });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('getSupabaseClient som kastar: sväljs och loggas', async () => {
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error('no client');
    });

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('en kastande query (inte bara { error }) sväljs också', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: () => {
        throw new Error('network');
      },
    } as any);

    await expect(evaluateBadges(USER, { now: NOW })).resolves.not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('evaluateBadges — returvärde', () => {
  const stored = (series: string, tier: number): Row => ({
    user_id: USER, series, tier, seen_tier: tier,
    earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
  });

  it('ger det som skrevs och complete: true när allt lyckades', async () => {
    setup({ runs: [run({ id: 'r1', distance: 5 })] });

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result?.complete).toBe(true);
    expect(result?.written.inserts.map((i) => i.series)).toEqual(['milestoner']);
    expect(result?.written.upgrades).toEqual([]);
  });

  it('ger null (inget skrivet) när utvärderingen avbröts före skrivning', async () => {
    setup({ runs: [] }, { errors: { runs: { message: 'down' } } });
    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();
  });

  it('partiell skrivning: insert faller men uppgraderingen lyckades — written har uppgraderingen, complete false', async () => {
    const db = setup(
      {
        runs: [run({ id: 'big', distance: 120 })], // milestoner tier 6 (upgrade), earth_trotter tier 1 (insert)
        user_badges: [stored('milestoner', 1)],
      },
      { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'insert failed' } : null) },
    );

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result?.complete).toBe(false);
    expect(result?.written.upgrades.map((u) => [u.series, u.previous_tier, u.tier])).toEqual([['milestoner', 1, 6]]);
    expect(result?.written.inserts).toEqual([]);
    expect((await badgesOf(db)).map((b) => [b.series, b.tier])).toEqual([['milestoner', 6]]);
  });

  it('partiell skrivning: uppgraderingen faller men insertarna lyckades — written har bara insertarna', async () => {
    setup(
      {
        runs: [run({ id: 'big', distance: 120 })],
        user_badges: [stored('milestoner', 1)],
      },
      { failWhen: (q) => (q.mutation === 'update' && q.table === 'user_badges' ? { message: 'update failed' } : null) },
    );

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result?.complete).toBe(false);
    expect(result?.written.upgrades).toEqual([]);
    expect(result?.written.inserts.map((i) => i.series)).toEqual(['earth_trotter']);
  });

  it('written innehåller bara poster som skrevs: omkörning efter ett fel ger den missade posten, inte de redan skrivna', async () => {
    let failUpdates = true;
    setup(
      { runs: [run({ id: 'big', distance: 120 })], user_badges: [stored('milestoner', 1)] },
      { failWhen: (q) => (failUpdates && q.mutation === 'update' && q.table === 'user_badges' ? { message: 'x' } : null) },
    );

    await evaluateBadges(USER, { now: NOW });
    failUpdates = false;
    const second = await evaluateBadges(USER, { now: NOW });

    expect(second?.complete).toBe(true);
    expect(second?.written.upgrades.map((u) => u.series)).toEqual(['milestoner']);
    expect(second?.written.inserts).toEqual([]); // earth_trotter skrevs redan första gången
  });
});

describe('evaluateBadges — användarisolering vid skrivning', () => {
  const row = (userId: string, series: string, tier: number): Row => ({
    user_id: userId, series, tier, seen_tier: tier,
    earned_at: '2026-01-01T00:00:00.000Z', source_run_id: null, updated_at: '2026-01-01T00:00:00.000Z',
  });

  it('upgrade, downgrade och delete för användaren rör aldrig en annan användares rad i SAMMA serie', async () => {
    // USER: milestoner 1 -> 6 (upgrade), earth_trotter 3 -> 1 (downgrade), climber 1 -> 0 (delete).
    const userRows = [row(USER, 'milestoner', 1), row(USER, 'earth_trotter', 3), row(USER, 'climber', 1)];
    const otherRows = [row(OTHER, 'milestoner', 2), row(OTHER, 'earth_trotter', 4), row(OTHER, 'climber', 3)];
    const otherSnapshot = otherRows.map((r) => ({ ...r }));
    const db = setup({
      runs: [run({ id: 'big', distance: 120 })],
      users: [
        { id: USER, longest_streak: 0, displayed_badge_series: ['climber'] },
        { id: OTHER, longest_streak: 0, displayed_badge_series: ['climber'] },
      ],
      user_badges: [...userRows, ...otherRows],
    });

    const result = await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(result?.written.upgrades).toHaveLength(1);
    expect(result?.written.downgrades).toHaveLength(1);
    expect(result?.written.deletes).toHaveLength(1);
    expect(await badgesOf(db, OTHER)).toEqual(otherSnapshot.sort((a, b) => a.series.localeCompare(b.series)));
    const { data: otherUser } = await db.client.from('users').select('*').eq('id', OTHER).single();
    expect(otherUser.displayed_badge_series).toEqual(['climber']);
    // Och användarens egna rader gick åt rätt håll.
    expect((await badgesOf(db)).map((b) => [b.series, b.tier])).toEqual([['earth_trotter', 1], ['milestoner', 6]]);
  });
});

describe('evaluateBadges — säkerhetsgräns i sid-loopen', () => {
  it('når loopen MAX_RUNS_PAGES: avbryter utan skrivning och loggar fel', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => run({ id: `p${i}`, distance: 1 }));
    const ranges: Array<[number, number]> = [];
    const mutations: string[] = [];
    const builder = (table: string): any => {
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        order: () => b,
        range: (from: number, to: number) => {
          ranges.push([from, to]);
          return Promise.resolve({ data: fullPage, error: null });
        },
        upsert: () => { mutations.push(`${table}.upsert`); return Promise.resolve({ error: null }); },
        update: () => { mutations.push(`${table}.update`); return b; },
        delete: () => { mutations.push(`${table}.delete`); return b; },
        single: () => Promise.resolve({ data: { longest_streak: 0, displayed_badge_series: [] }, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return b;
    };
    vi.mocked(getSupabaseClient).mockReturnValue({ from: builder } as any);

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result).toBeNull();
    expect(ranges).toHaveLength(MAX_RUNS_PAGES);
    expect(mutations).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toContain('(page_limit_reached)');
  });
});

describe('evaluateBadges — the code of a failed read reaches the log (BadgeReadError.code)', () => {
  const loggedLine = () => String(errorSpy.mock.calls[0]?.[0]);

  it('a failed read of the runs logs the database code, not the class name', async () => {
    setup({}, { failWhen: (q) => (q.table === 'runs' ? { message: 'row 987654 leaked', code: '57014' } : null) });

    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();

    expect(loggedLine()).toContain('(57014)');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('987654');
  });

  it('a failed read of users.longest_streak logs the database code', async () => {
    setup({}, { failWhen: (q) => (q.table === 'users' && !q.mutation ? { message: 'boom', code: '42501' } : null) });

    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();

    expect(loggedLine()).toContain('(42501)');
  });

  it('a user that does not exist logs the PGRST116 of .single()', async () => {
    setup({ users: [] });

    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();

    expect(loggedLine()).toContain('(PGRST116)');
  });

  it('a broken connection (supabase-js code "") logs the network cause', async () => {
    const networkError = { message: 'TypeError: fetch failed', details: 'Caused by: Error: read ECONNRESET (ECONNRESET)', hint: '', code: '' };
    setup({}, { failWhen: (q) => (q.table === 'runs' ? networkError : null) });

    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();

    expect(loggedLine()).toContain('(ECONNRESET)');
  });
});
