/**
 * services/badgeService.ts (ADR 009 beslut 2): evaluateBadges läser rundor sidvis, räknar med den riktiga
 * computeBadgeTiers, diffar med den riktiga diffBadgeTiers och skriver bara skillnaden till user_badges.
 * Kör mot fakeDb (filtrerande, tillämpar range/order/upsert/update/delete) — shared-funktionerna är inte mockade.
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
import { evaluateBadges } from '../badgeService.js';
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
  start_time: null, moving_time: null, total_elevation_gain: null, is_treadmill: false,
  ...over,
});

const writes = (db: ReturnType<typeof setup>, table?: string) =>
  db.queries.filter((q) => q.mutation && (!table || q.table === table));

describe('evaluateBadges — läsning (T2)', () => {
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
    expect(q.select).toMatch(/\bid\b.*\bdate\b.*\bdistance\b.*\bstart_time\b.*\bmoving_time\b.*\btotal_elevation_gain\b.*\bis_treadmill\b/);
    const rows = await badgesOf(db);
    expect(rows.find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1 }); // 5 km, inte den andres 50 km
  });

  it('start_time skickas som rå sträng: fem klockan 05:00 ger Early Bird tier 1', async () => {
    const runs = [1, 2, 3, 4, 5].map((d) => run({ id: `e${d}`, date: `2026-10-0${d}`, start_time: `2026-10-0${d}T05:00:00Z` }));
    const db = setup({ runs });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'early_bird')).toMatchObject({ tier: 1 });
  });

  it('numeric-kolumner som strängar tolkas som tal (distance "5.00", höjd "500.0")', async () => {
    const db = setup({ runs: [run({ id: 'n1', distance: '5.00', total_elevation_gain: '500.0' })] });

    await evaluateBadges(USER, { now: NOW });

    const rows = await badgesOf(db);
    expect(rows.find((b) => b.series === 'milestoner')).toMatchObject({ tier: 1, source_run_id: 'n1' });
    expect(rows.find((b) => b.series === 'climber')).toMatchObject({ tier: 1 });
  });

  it('longestStreak i opts används och users.longest_streak läses inte', async () => {
    const db = setup({ runs: [run()] });

    await evaluateBadges(USER, { longestStreak: 7, now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'streak_keeper')).toMatchObject({ tier: 2 });
    expect(db.queries.some((q) => q.table === 'users')).toBe(false);
  });

  it('utan opts.longestStreak läses users.longest_streak', async () => {
    const db = setup({
      runs: [run()],
      users: [{ id: USER, longest_streak: 14, displayed_badge_series: [] }],
    });

    await evaluateBadges(USER, { now: NOW });

    expect((await badgesOf(db)).find((b) => b.series === 'streak_keeper')).toMatchObject({ tier: 3 });
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

  it('radering av rundan: raden raderas och serien försvinner ur displayed_badge_series (EN users-update)', async () => {
    const db = setup({
      runs: [],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner', 'climber', 'early_bird'] }],
      user_badges: [stored('milestoner'), stored('climber')],
    });

    await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(await badgesOf(db)).toEqual([]);
    const { data } = await db.client.from('users').select('*').eq('id', USER).single();
    expect(data.displayed_badge_series).toEqual(['early_bird']);
    expect(writes(db, 'users')).toHaveLength(1);
    expect(writes(db, 'users')[0].mutation).toBe('update');
    expect(writes(db, 'users')[0].filters).toContainEqual({ op: 'eq', column: 'id', value: USER });
  });

  it('ingen users-update när visade badges inte innehåller den raderade serien', async () => {
    const db = setup({
      runs: [],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['early_bird'] }],
      user_badges: [stored('milestoner')],
    });

    await evaluateBadges(USER, { now: NOW });

    expect(await badgesOf(db)).toEqual([]);
    expect(writes(db, 'users')).toHaveLength(0);
  });

  it('ingen users-update (och ingen users-läsning av showcasen) när inget raderas', async () => {
    const db = setup({
      runs: [run({ distance: 5 })],
      users: [{ id: USER, longest_streak: 0, displayed_badge_series: ['milestoner'] }],
      user_badges: [stored('milestoner')],
    });

    await evaluateBadges(USER, { longestStreak: 0, now: NOW });

    expect(writes(db, 'users')).toHaveLength(0);
    expect(db.queries.some((q) => q.table === 'users')).toBe(false);
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
  it('ger den skrivna diffen (för news i RUN-123) när allt lyckades', async () => {
    setup({ runs: [run({ id: 'r1', distance: 5 })] });

    const result = await evaluateBadges(USER, { now: NOW });

    expect(result?.inserts.map((i) => i.series)).toEqual(['milestoner']);
    expect(result?.upgrades).toEqual([]);
  });

  it('ger null när utvärderingen avbröts eller en skrivning föll', async () => {
    setup({ runs: [] }, { errors: { runs: { message: 'down' } } });
    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();

    setup(
      { runs: [run({ distance: 5 })] },
      { failWhen: (q) => (q.mutation === 'upsert' ? { message: 'x' } : null) },
    );
    expect(await evaluateBadges(USER, { now: NOW })).toBeNull();
  });
});
