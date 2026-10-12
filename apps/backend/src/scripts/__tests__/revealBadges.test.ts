/**
 * scripts/revealBadges.ts (RUN-156): dry-run som standard; --apply skriver en badge_earned-rad per user_badges-rad
 * via live-vägen (badgeNewsChanges + recordActivities) och nollställer seen_tier; idempotent via dedupe_key;
 * förkravet 036 kontrolleras före all skrivning. Körs mot fakeDb — shared-funktionerna är inte mockade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { activityKeys } from '@runquest/shared';
import {
  RevealPreconditionError,
  formatReport,
  parseArgs,
  planUserReveal,
  runRevealBadges,
  type RevealBadgesOptions,
} from '../revealBadges.js';
import { createFakeDb, type FakeDbOptions, type RecordedQuery, type Row } from '../../routes/__tests__/helpers/fakeDb.js';

const NOW = new Date('2026-10-12T08:00:00.000Z');
const OLD_ISO = '2026-10-11T10:00:00.000Z';
const GROUP_A = 'g-a';
const GROUP_B = 'g-b';

let errorSpy: ReturnType<typeof vi.spyOn>;
const originalUrl = process.env.SUPABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = 'https://abcdef.supabase.co';
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
});

const badge = (over: Row = {}): Row => ({
  user_id: 'anna', series: 'milestoner', tier: 2, seen_tier: 2, earned_at: OLD_ISO, source_run_id: null, updated_at: OLD_ISO, ...over,
});

/**
 * Anna (grupp A): milestoner 2 + speedster 3 (backfillen: seen_tier = tier). Bosse (grupp B): streak_keeper 1.
 * Carl: ingen grupp, early_bird 1. Dora: inga badges alls.
 */
function world(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    users: [
      { id: 'anna', name: 'Anna', email: 'anna@secret.example', group_id: GROUP_A },
      { id: 'bosse', name: 'Bosse', email: 'bosse@secret.example', group_id: GROUP_B },
      { id: 'carl', name: 'Carl', email: 'carl@secret.example', group_id: null },
      { id: 'dora', name: 'Dora', email: 'dora@secret.example', group_id: GROUP_A },
    ],
    user_badges: [
      badge({ series: 'milestoner', tier: 2, seen_tier: 2 }),
      badge({ series: 'speedster', tier: 3, seen_tier: 3 }),
      badge({ user_id: 'bosse', series: 'streak_keeper', tier: 1, seen_tier: 1 }),
      badge({ user_id: 'carl', series: 'early_bird', tier: 1, seen_tier: 1 }),
    ],
    activity_log: [],
    ...extra,
  };
}

type ProbeOutcome = { message: string; code?: string } | null;

/** Förkravstestinserten är den enda INSERT:en mot activity_log (live-skrivningen är en upsert). */
const isProbe = (q: RecordedQuery) => q.table === 'activity_log' && q.mutation === 'insert';

/** Standard: 036 finns, så testinserten stoppas av group-FK:n (23503). */
const FK_REJECT: ProbeOutcome = { message: 'insert violates foreign key constraint "activity_log_group_id_fkey"', code: '23503' };
const CHECK_REJECT: ProbeOutcome = { message: 'new row violates check constraint "activity_log_type_check"', code: '23514' };

function setup(tables: Record<string, Row[]> = world(), probe: ProbeOutcome = FK_REJECT, extra: FakeDbOptions['failWhen'] = () => null) {
  const options: FakeDbOptions = {
    numericIds: ['activity_log'],
    failWhen: (q) => (isProbe(q) ? probe : extra(q)),
  };
  const db = createFakeDb(tables, options);
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);
  return { db, tables };
}

const opts = (over: Partial<RevealBadgesOptions> = {}): RevealBadgesOptions => ({ apply: false, ...over });

const mutations = (db: ReturnType<typeof setup>['db']) => db.queries.filter((q) => q.mutation);
const newsOf = (tables: Record<string, Row[]>) => tables.activity_log.filter((r) => r.type === 'badge_earned');
const seenOf = (tables: Record<string, Row[]>, userId: string) =>
  Object.fromEntries(tables.user_badges.filter((b) => b.user_id === userId).map((b) => [b.series, b.seen_tier]));

describe('parseArgs', () => {
  it('default: dry-run, alla grupper', () => {
    expect(parseArgs([])).toEqual({ apply: false });
  });

  it('--apply och --group', () => {
    expect(parseArgs(['--apply', '--group=g1'])).toEqual({ apply: true, groupId: 'g1' });
  });

  it('tom grupp och okända argument stoppas', () => {
    expect(() => parseArgs(['--group='])).toThrow(/--group/);
    expect(() => parseArgs(['--silent'])).toThrow(/Unknown argument "--silent"/);
  });
});

describe('planUserReveal', () => {
  const rows = [
    { series: 'milestoner', tier: 2, seen_tier: 2 },
    { series: 'speedster', tier: 3, seen_tier: 0 },
  ];

  it('en live-draft per rad: landningsnivåns nyckel, previous_tier null, gruppen, is_backfill false', () => {
    const plan = planUserReveal('anna', GROUP_A, rows, new Set(), NOW.toISOString());
    expect(plan.drafts).toHaveLength(2);
    expect(plan.drafts[0]).toMatchObject({
      type: 'badge_earned', group_id: GROUP_A, actor_user_id: 'anna', target_user_id: null,
      payload: { series: 'milestoner', tier: 2, previous_tier: null },
      dedupe_key: activityKeys.badgeEarned('anna', 'milestoner', 2), occurred_at: NOW.toISOString(), is_backfill: false,
    });
    // Bara rader med seen_tier > 0 behöver nollställas.
    expect(plan.seenResets.map((r) => r.series)).toEqual(['milestoner']);
  });

  it('rader vars nyckel redan finns är avtäckta: ingen draft och ingen nollställning', () => {
    const plan = planUserReveal('anna', GROUP_A, rows, new Set([activityKeys.badgeEarned('anna', 'milestoner', 2)]), NOW.toISOString());
    expect(plan.alreadyRevealed.map((r) => r.series)).toEqual(['milestoner']);
    expect(plan.drafts.map((d) => d.dedupe_key)).toEqual([activityKeys.badgeEarned('anna', 'speedster', 3)]);
    expect(plan.seenResets).toEqual([]);
  });

  it('utan grupp: ingen news men raderna är pending (popupen visas)', () => {
    const plan = planUserReveal('carl', null, rows, new Set(), NOW.toISOString());
    expect(plan.drafts).toEqual([]);
    expect(plan.pending).toHaveLength(2);
    expect(plan.seenResets).toHaveLength(1);
  });
});

describe('T1 — dry-run', () => {
  it('skriver inget (inga mutationer, tabellerna oförändrade, ingen förkravsinsert)', async () => {
    const { db, tables } = setup();
    const before = JSON.stringify(tables);
    const report = await runRevealBadges(opts(), NOW);

    expect(mutations(db)).toEqual([]);
    expect(JSON.stringify(tables)).toBe(before);
    expect(report.precondition).toBeNull();
  });

  it('rapporterar per användare badges, news att skriva, seen_tier-nollställningar och användare utan grupp', async () => {
    setup();
    const report = await runRevealBadges(opts(), NOW);

    expect(report.totals).toMatchObject({
      users: 3, badges: 4, alreadyRevealed: 0, newsPlanned: 3, seenResetsPlanned: 4, newsWritten: 0, seenResetsWritten: 0,
    });
    const anna = report.users.find((u) => u.name === 'Anna')!;
    expect(anna).toMatchObject({ badges: 2, newsPlanned: 2, seenResetsPlanned: 2, groupId: GROUP_A, newsWritten: null });
    expect(report.users.find((u) => u.name === 'Carl')).toMatchObject({ newsPlanned: 0, seenResetsPlanned: 1, groupId: null });
    expect(report.withoutGroup).toEqual(['Carl']);
    expect(report.users.map((u) => u.name)).not.toContain('Dora'); // inga badges
  });

  it('rapporten visar målets host men aldrig e-post', async () => {
    setup();
    const text = formatReport(await runRevealBadges(opts(), NOW));
    expect(text).toContain('target database: abcdef.supabase.co');
    expect(text).toContain('DRY-RUN');
    expect(text).toContain('Carl');
    expect(text).not.toMatch(/secret\.example|password|token/i);
  });

  it('--group avgränsar till gruppens användare', async () => {
    setup();
    const report = await runRevealBadges(opts({ groupId: GROUP_B }), NOW);
    expect(report.users.map((u) => u.name)).toEqual(['Bosse']);
  });
});

describe('T2 — --apply', () => {
  it('en badge_earned-rad per user_badges-rad med live-nyckel, payload, grupp och is_backfill false', async () => {
    const { tables } = setup();
    const report = await runRevealBadges(opts({ apply: true }), NOW);

    const news = newsOf(tables);
    expect(news).toHaveLength(3); // Carl har ingen grupp
    expect(news.map((r) => r.dedupe_key).sort()).toEqual([
      activityKeys.badgeEarned('anna', 'milestoner', 2),
      activityKeys.badgeEarned('anna', 'speedster', 3),
      activityKeys.badgeEarned('bosse', 'streak_keeper', 1),
    ].sort());

    const annaMilestoner = news.find((r) => r.dedupe_key === activityKeys.badgeEarned('anna', 'milestoner', 2))!;
    expect(annaMilestoner).toMatchObject({
      type: 'badge_earned', group_id: GROUP_A, actor_user_id: 'anna', target_user_id: null,
      payload: { series: 'milestoner', tier: 2, previous_tier: null }, is_backfill: false, occurred_at: NOW.toISOString(),
    });
    expect(news.find((r) => r.actor_user_id === 'bosse')).toMatchObject({ group_id: GROUP_B, payload: { series: 'streak_keeper', tier: 1, previous_tier: null } });
    expect(news.every((r) => r.is_backfill === false)).toBe(true);

    expect(report.totals).toMatchObject({ newsWritten: 3, seenResetsWritten: 4 });
    expect(report.failed).toBe(0);
  });

  it('seen_tier = 0 på alla raderna (även användaren utan grupp); tier lämnas orörd', async () => {
    const { tables } = setup();
    await runRevealBadges(opts({ apply: true }), NOW);

    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 0, speedster: 0 });
    expect(seenOf(tables, 'bosse')).toEqual({ streak_keeper: 0 });
    expect(seenOf(tables, 'carl')).toEqual({ early_bird: 0 });
    expect(tables.user_badges.map((b) => b.tier).sort()).toEqual([1, 1, 2, 3]);
  });

  it('förkravsinserten lämnar inget kvar i activity_log och skriver inget annat än news-upserten och user_badges', async () => {
    const { db, tables } = setup();
    await runRevealBadges(opts({ apply: true }), NOW);

    expect(tables.activity_log.every((r) => r.type === 'badge_earned')).toBe(true);
    expect(tables.activity_log.some((r) => String(r.dedupe_key).startsWith('reveal-badges-probe:'))).toBe(false);
    const touched = new Set(mutations(db).map((q) => `${q.table}:${q.mutation}`));
    expect(touched).toEqual(new Set(['activity_log:insert', 'user_badges:update', 'activity_log:upsert']));
  });

  it('en rad som redan har news (live-earned) rörs inte: ingen dublett, seen_tier orörd', async () => {
    const live = { id: 1, type: 'badge_earned', group_id: GROUP_A, actor_user_id: 'anna', dedupe_key: activityKeys.badgeEarned('anna', 'milestoner', 2) };
    const { tables } = setup(world({ activity_log: [live] }));
    const report = await runRevealBadges(opts({ apply: true }), NOW);

    expect(newsOf(tables).filter((r) => r.dedupe_key === live.dedupe_key)).toHaveLength(1);
    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 2, speedster: 0 });
    expect(report.users.find((u) => u.name === 'Anna')).toMatchObject({ alreadyRevealed: 1, newsWritten: 1 });
  });
});

describe('T3 — idempotens och omkörning', () => {
  it('omkörning ger 0 nya news-rader och rör inte seen_tier hos en användare som hunnit se sin popup', async () => {
    const { tables } = setup();
    await runRevealBadges(opts({ apply: true }), NOW);
    const newsAfterFirst = JSON.stringify(newsOf(tables));

    // Anna ser sin popup: seen_tier = tier. Omkörningen får inte nollställa den igen.
    for (const b of tables.user_badges.filter((r) => r.user_id === 'anna')) b.seen_tier = b.tier;
    const second = await runRevealBadges(opts({ apply: true }), NOW);

    expect(JSON.stringify(newsOf(tables))).toBe(newsAfterFirst);
    expect(second.totals.newsPlanned).toBe(0);
    expect(second.totals.newsWritten).toBe(0);
    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 2, speedster: 3 });
    expect(seenOf(tables, 'bosse')).toEqual({ streak_keeper: 0 });
    expect(second.totals.alreadyRevealed).toBe(3);
  });

  it('delvis misslyckad körning (news-skrivningen faller) kan köras om och fyller i resten', async () => {
    let failNews = true;
    const { tables } = setup(world(), FK_REJECT, (q) => (failNews && q.table === 'activity_log' && q.mutation === 'upsert' ? { message: 'boom' } : null));

    const first = await runRevealBadges(opts({ apply: true }), NOW);
    expect(first.failed).toBe(2); // Anna och Bosse; Carl har ingen news att skriva
    expect(newsOf(tables)).toHaveLength(0);
    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 0, speedster: 0 }); // seen_tier först

    failNews = false;
    const second = await runRevealBadges(opts({ apply: true }), NOW);
    expect(second.failed).toBe(0);
    expect(newsOf(tables)).toHaveLength(3);
    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 0, speedster: 0 });
  });

  it('faller nollställningen av en rad skrivs ingen news för den raden, och omkörningen tar den', async () => {
    let failReset = true;
    const { tables } = setup(world(), FK_REJECT, (q) =>
      failReset && q.table === 'user_badges' && q.mutation === 'update' && q.filters.some((f) => f.column === 'series' && f.value === 'speedster')
        ? { message: 'boom' } : null);

    const first = await runRevealBadges(opts({ apply: true }), NOW);
    expect(first.users.find((u) => u.name === 'Anna')).toMatchObject({ newsWritten: 1, seenResetsWritten: 1 });
    expect(first.failed).toBe(1);
    expect(newsOf(tables).some((r) => r.dedupe_key === activityKeys.badgeEarned('anna', 'speedster', 3))).toBe(false);
    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 0, speedster: 3 });

    failReset = false;
    const second = await runRevealBadges(opts({ apply: true }), NOW);
    expect(second.failed).toBe(0);
    expect(seenOf(tables, 'anna')).toEqual({ milestoner: 0, speedster: 0 });
    expect(newsOf(tables).filter((r) => r.actor_user_id === 'anna')).toHaveLength(2);
  });

  it('läsfel stoppar körningen före skrivning', async () => {
    const { db } = setup(world(), FK_REJECT, (q) => (q.table === 'user_badges' ? { message: 'down' } : null));
    await expect(runRevealBadges(opts({ apply: true }), NOW)).rejects.toThrow(/Could not read user_badges/);
    expect(mutations(db).filter((q) => q.table !== 'activity_log' || q.mutation !== 'insert')).toEqual([]);
  });
});

describe('T4 — förkrav 036', () => {
  it('036 saknas (activity_log_type_check avvisar badge_earned): tydligt avbrott, inget skrivet', async () => {
    const { db, tables } = setup(world(), CHECK_REJECT);
    const before = JSON.stringify(tables);

    await expect(runRevealBadges(opts({ apply: true }), NOW)).rejects.toThrow(RevealPreconditionError);
    await expect(runRevealBadges(opts({ apply: true }), NOW)).rejects.toThrow(/Migration 036 is not applied/);

    expect(JSON.stringify(tables)).toBe(before);
    // Det enda som försöktes var testinserten (avvisad); varken news eller seen_tier.
    expect(mutations(db).every(isProbe)).toBe(true);
    expect(db.queries.some((q) => q.table === 'user_badges')).toBe(false);
  });

  it('känner igen avvisningen på constraintnamnet även utan felkod', async () => {
    setup(world(), { message: 'new row for relation "activity_log" violates check constraint "activity_log_type_check"' });
    await expect(runRevealBadges(opts({ apply: true }), NOW)).rejects.toThrow(/Migration 036 is not applied/);
  });

  it('ett oväntat fel kan inte verifieras: avbrott, inget skrivet', async () => {
    const { tables } = setup(world(), { message: 'connection reset', code: '08006' });
    const before = JSON.stringify(tables);
    await expect(runRevealBadges(opts({ apply: true }), NOW)).rejects.toThrow(/Could not verify migration 036/);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('036 finns: FK-avvisningen (23503) godkänner förkravet och rapporten säger det', async () => {
    setup(world(), FK_REJECT);
    const report = await runRevealBadges(opts({ apply: true }), NOW);
    expect(report.precondition).toMatch(/accepts badge_earned/);
    expect(formatReport(report)).toContain('migration 036: activity_log accepts badge_earned');
  });

  it('oväntat lyckad testinsert: testraden raderas direkt och förkravet godkänns', async () => {
    const { tables } = setup(world(), null);
    const report = await runRevealBadges(opts({ apply: true }), NOW);
    expect(report.precondition).toMatch(/removed again/);
    expect(tables.activity_log.some((r) => String(r.dedupe_key).startsWith('reveal-badges-probe:'))).toBe(false);
    expect(newsOf(tables)).toHaveLength(3);
  });

  it('dry-run kontrollerar inte förkravet (och kräver det inte)', async () => {
    const { db } = setup(world(), CHECK_REJECT);
    const report = await runRevealBadges(opts(), NOW);
    expect(report.totals.newsPlanned).toBe(3);
    expect(db.queries.filter(isProbe)).toEqual([]);
  });
});
