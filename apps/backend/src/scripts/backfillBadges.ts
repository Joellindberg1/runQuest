/**
 * backfillBadges.ts — retroaktiv utvärdering av badges för alla användare (ADR 009 beslut 10, RUN-124).
 *
 * Räknar computeBadgeTiers ur varje användares rundor, diffar mot user_badges (diffBadgeTiers) och skriver
 * skillnaden via SAMMA skrivväg som evaluateBadges (applyBadgeDiff i badgeService) — men alltid med
 * markSeen: nya och uppgraderade rader får seen_tier = tier, så ingen popup-flod uppstår. Skriptet skriver
 * ALDRIG activity_log-rader (ingen news för historiska badges, ADR 009 beslut 5) och rör inga andra tabeller
 * än user_badges (+ users.displayed_badge_series när en återkallad serie städas ur showcasen).
 *
 * Körs:  npm run backfill:badges --workspace=@runquest/backend -- [--apply] [--silent] [--series=a,b] [--group=<id>]
 *   (default)   DRY-RUN: matris användare × serie (tiernamn), tierfördelning per serie, hur nära nästa nivå
 *               (mått och tröskel) och vad som skulle skrivas (inserts/upgrades/downgrades/deletes). Skriver inget.
 *   --apply     skriver diffen med seen_tier = tier. Omkörning är idempotent (noll skrivningar).
 *   --silent    (med --apply) normaliserar dessutom BEFINTLIGA rader med seen_tier < tier till seen_tier = tier,
 *               så att redan skrivna rader (deploy före backfill, preview mot prod-DB) inte ger popups.
 *               Utan --apply visas bara en förhandsvisning av normaliseringen.
 *   --series    bara dessa serier (nycklar ur BADGE_SERIES, kommaseparerade); övriga rader rörs inte alls
 *   --group     bara en grupp (users.group_id)
 *
 * Mot produktion (Railway-CLI:n injicerar miljön — ingen lokal .env; kör från repo-roten):
 *   railway run --service runQuest-backend -- npm run backfill:badges --workspace=@runquest/backend
 *   railway run --service runQuest-backend -- npm run backfill:badges --workspace=@runquest/backend -- --apply [--silent]
 * Dry-run är fritt; --apply mot produktion kräver ägargodkännande med dry-run-rapporten som underlag
 * (docs/permissions.md). Skriptet skriver ut måldatabasens host före körningen och i rapporten.
 *
 * Körordning:
 *   1. Migration 035 (user_badges + users.displayed_badge_series) måste vara applicerad. Migration 036
 *      (badge_earned i activity_log) behövs inte av backfillen — den skriver ingen news.
 *   2. Kör helst FÖRE deployen av backend med badge-skrivvägen (ADR 009 beslut 10): då finns rader med
 *      seen_tier = tier när live-utvärderingen tar över. Körs den EFTER deployen — eller har en preview mot
 *      prod-DB redan skrivit rader med seen_tier < tier — använd --apply --silent. Rapporten varnar med
 *      "existing row(s) have seen_tier < tier" när en körning utan --silent lämnar sådana rader.
 *   3. Kör om (dry-run → --apply) EFTER allt som ändrar runs utan att räkna om badges: admin-routen
 *      POST /strava/backfill-extended och skripten backfill:treadmill och convert:wind-ms uppdaterar rundor
 *      men anropar inte evaluateBadges.
 *   4. Kör om (dry-run → --apply --silent) efter varje tröskeländring i packages/shared/src/badges.ts
 *      (ADR 009: trösklarna är startvärden som justeras efter dry-run). Nedgraderingar och raderingar
 *      tillämpas; observera att skriptet inte retractar redan skrivna badge_earned-news (det gör bara den
 *      löpande utvärderingen).
 *
 * Fel: en användare vars läsning eller skrivning faller hoppas över (inget skrivs för läsfel), övriga körs
 * vidare, rapporten listar de misslyckade och skriptet avslutar med exit-kod 1. Rapporten innehåller
 * användarnamn (för Lead i terminalen) men aldrig e-post, lösenord eller tokens — de läses aldrig.
 */
import { pathToFileURL } from 'node:url';
import { getSupabaseClient } from '../config/database.js';
import { applyBadgeDiff, readExistingBadges, readRuns } from '../services/badgeService.js';
import { supabaseHost } from './backfillActivityLog.js';
import {
  BADGE_METRICS,
  BADGE_SERIES,
  MAX_TIER,
  TIER_NAMES,
  computeSeriesTiers,
  diffBadgeTiers,
  requirementText,
  type BadgeDiff,
  type BadgeRun,
  type BadgeSeriesDef,
  type BadgeStats,
  type BadgeTierResult,
  type ExistingBadgeRow,
} from '@runquest/shared';

const USERS_PAGE_SIZE = 1000;
const NO_RUNS_NOTE = 'no qualifying run';

export interface BackfillBadgesOptions {
  apply: boolean;
  silent: boolean;
  /** null = alla serier. */
  series: string[] | null;
  groupId?: string;
}

// ─── Rena funktioner (testas utan databas) ───────────────────────────────────

const SERIES_KEYS = BADGE_SERIES.map((s) => s.key as string);

export function parseArgs(argv: string[]): BackfillBadgesOptions {
  const options: BackfillBadgesOptions = { apply: false, silent: false, series: null };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--silent') options.silent = true;
    else if (arg.startsWith('--series=')) {
      const keys = arg.slice('--series='.length).split(',').map((k) => k.trim()).filter(Boolean);
      if (keys.length === 0) throw new Error(`--series needs at least one series key (${SERIES_KEYS.join(', ')})`);
      for (const key of keys) {
        if (!SERIES_KEYS.includes(key)) throw new Error(`Unknown series "${key}". Known: ${SERIES_KEYS.join(', ')}`);
      }
      options.series = [...new Set(keys)];
    } else if (arg.startsWith('--group=')) {
      const group = arg.slice('--group='.length).trim();
      if (!group) throw new Error('--group needs a group id');
      options.groupId = group;
    } else {
      throw new Error(`Unknown argument "${arg}". Usage: [--apply] [--silent] [--series=a,b] [--group=<id>]`);
    }
  }
  return options;
}

export interface NextTierInfo {
  /** Nästa tier (1..MAX_TIER). */
  tier: number;
  tierName: string;
  /** Nuvarande mått med enhet, t.ex. "12 km", "25:00", "no qualifying run". */
  measured: string;
  /** Tröskeln med enhet, t.ex. "21.1 km" eller "under 25:00". */
  threshold: string;
  /** Hur långt mot tröskeln, 0–100; null för "under"-regler (bästa tid har ingen naturlig procent). */
  percent: number | null;
  requirement: string;
}

const METRIC_UNITS: Record<string, string> = {
  longest_run_km: 'km',
  total_distance_km: 'km',
  total_elevation_m: 'm',
  longest_streak_days: 'days',
  exact_classic_distances: 'distances',
};

const formatNumber = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * Hur nära serien är nästa tier, mätt mot NÄSTA tiers egen regel (reglerna är per tier och kan byta mått,
 * t.ex. Early Bird tier 5). null när serien redan står på högsta nivån.
 */
export function describeNextTier(
  series: BadgeSeriesDef,
  currentTier: number,
  runs: readonly BadgeRun[],
  stats: BadgeStats
): NextTierInfo | null {
  if (currentTier >= MAX_TIER) return null;
  const nextTier = currentTier + 1;
  const rule = series.tiers[nextTier - 1];
  const metric = (BADGE_METRICS as Record<string, (typeof BADGE_METRICS)[keyof typeof BADGE_METRICS]>)[rule.metric];
  const measurement = metric.measure(runs, stats);
  const value = measurement && Number.isFinite(measurement.value) ? measurement.value : null;
  const unit = METRIC_UNITS[rule.metric] ?? 'runs';
  const base = { tier: nextTier, tierName: TIER_NAMES[nextTier - 1], requirement: requirementText(series, nextTier) };

  if (rule.direction === 'below') {
    return {
      ...base,
      measured: value === null ? NO_RUNS_NOTE : formatClock(value),
      threshold: `under ${formatClock(rule.threshold * metric.scale)}`,
      percent: null,
    };
  }
  const natural = value === null ? 0 : value / metric.scale;
  return {
    ...base,
    measured: `${formatNumber(natural)} ${unit}`,
    threshold: `${formatNumber(rule.threshold)} ${unit}`,
    percent: Math.max(0, Math.min(100, Math.round((natural / rule.threshold) * 100))),
  };
}

/** En befintlig rad vars seen_tier ska sättas till tier (--silent). */
export interface SeenNormalization {
  series: string;
  tier: number;
  previous_seen_tier: number;
}

export interface UserPlan {
  /** Det som skrivs till user_badges (samma diff som evaluateBadges, med markSeen). */
  diff: BadgeDiff;
  /** Bara med --silent: befintliga rader som ändå står kvar med seen_tier < tier efter diffen. */
  normalizations: SeenNormalization[];
  /** Utan --silent: rader som efter diffen står kvar med seen_tier < tier, dvs ger popup. */
  pendingPopups: number;
}

/**
 * Skrivplanen för en användare. Bara serier som finns i `computed` rörs (--series avgränsar alltså både
 * diffen och normaliseringen). markSeen är alltid på: en backfill ska aldrig ge popups.
 */
export function planUserBackfill(
  existing: readonly ExistingBadgeRow[],
  computed: Readonly<Record<string, BadgeTierResult>>,
  opts: { silent: boolean; now: Date }
): UserPlan {
  const diff = diffBadgeTiers(existing, computed, { now: opts.now, markSeen: true });
  const upgrades = new Map(diff.upgrades.map((u) => [u.series, u]));
  const downgrades = new Map(diff.downgrades.map((d) => [d.series, d]));
  const deleted = new Set(diff.deletes.map((d) => d.series));

  const behind: SeenNormalization[] = [];
  for (const row of existing) {
    if (!(row.series in computed) || deleted.has(row.series)) continue;
    const finalTier = upgrades.get(row.series)?.tier ?? downgrades.get(row.series)?.tier ?? row.tier;
    const finalSeen = upgrades.get(row.series)?.seen_tier ?? downgrades.get(row.series)?.seen_tier ?? row.seen_tier;
    if (finalSeen < finalTier) behind.push({ series: row.series, tier: finalTier, previous_seen_tier: finalSeen });
  }
  return opts.silent
    ? { diff, normalizations: behind, pendingPopups: 0 }
    : { diff, normalizations: [], pendingPopups: behind.length };
}

// ─── Rapportens datamodell ───────────────────────────────────────────────────

export interface PlanCounts {
  inserts: number;
  upgrades: number;
  downgrades: number;
  deletes: number;
  normalizations: number;
}

const emptyCounts = (): PlanCounts => ({ inserts: 0, upgrades: 0, downgrades: 0, deletes: 0, normalizations: 0 });
const sumCounts = (c: PlanCounts): number => c.inserts + c.upgrades + c.downgrades + c.deletes + c.normalizations;

export interface PlannedChange {
  kind: 'insert' | 'upgrade' | 'downgrade' | 'delete' | 'normalize';
  series: string;
  /** Tier efter ändringen (för delete: tiern som togs bort). */
  tier: number;
  previousTier: number | null;
}

export interface UserBadgeReport {
  userId: string;
  name: string;
  runCount: number;
  /** Beräknad tier per serie i scope. Tom om användaren misslyckades. */
  tiers: Record<string, number>;
  /** Nästa nivå per serie i scope; null = högsta nivån. */
  next: Record<string, NextTierInfo | null>;
  plan: PlanCounts;
  changes: PlannedChange[];
  /** Det som faktiskt skrevs (bara med --apply). */
  written: PlanCounts | null;
  pendingPopups: number;
  error: string | null;
}

export interface BackfillBadgesReport {
  options: BackfillBadgesOptions;
  target: string;
  /** Serierna i scope, i BADGE_SERIES-ordning. */
  series: string[];
  users: UserBadgeReport[];
  /** Användare per tier (0..MAX_TIER) per serie, bara lyckade användare. */
  distribution: Record<string, Record<number, number>>;
  totals: { planned: PlanCounts; written: number; normalized: number; pendingPopups: number };
  failed: number;
}

// ─── Läsning och skrivning ───────────────────────────────────────────────────

type Client = ReturnType<typeof getSupabaseClient>;

interface UserRow {
  id: string;
  name: string;
  longest_streak: number | string | null;
}

/** Bara id, namn, grupp och streak — aldrig e-post, lösenordshash eller Strava-tokens. */
async function readUsers(supabase: Client, groupId: string | undefined): Promise<UserRow[]> {
  const users: UserRow[] = [];
  for (let from = 0; ; from += USERS_PAGE_SIZE) {
    let query = supabase.from('users').select('id, name, group_id, longest_streak').order('id', { ascending: true });
    if (groupId) query = query.eq('group_id', groupId);
    const { data, error } = await query.range(from, from + USERS_PAGE_SIZE - 1);
    if (error?.code === 'PGRST103' && from > 0) return users; // sidan ligger bortom sista raden
    if (error) throw new Error(`Could not read users: ${error.message}`);
    users.push(...((data ?? []) as UserRow[]));
    if (!data || data.length < USERS_PAGE_SIZE) return users;
  }
}

/**
 * --silent: sätter seen_tier = tier på rader som står kvar bakom. Tier-vakten (.eq('tier')) gör att en
 * samtidig nedgradering aldrig bryter CHECK seen_tier <= tier; en rad vars tier ändrats träffas inte.
 * Ger antal faktiskt uppdaterade rader och om något fel uppstod.
 */
async function normalizeSeen(
  supabase: Client,
  userId: string,
  normalizations: readonly SeenNormalization[],
  now: Date
): Promise<{ done: number; ok: boolean }> {
  let done = 0;
  let ok = true;
  for (const n of normalizations) {
    const { data, error } = await supabase
      .from('user_badges')
      .update({ seen_tier: n.tier, updated_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('series', n.series)
      .eq('tier', n.tier)
      .lt('seen_tier', n.tier)
      .select('series');
    if (error) {
      ok = false;
      continue;
    }
    done += (data ?? []).length;
  }
  return { done, ok };
}

const countsOf = (diff: BadgeDiff, normalizations: number): PlanCounts => ({
  inserts: diff.inserts.length,
  upgrades: diff.upgrades.length,
  downgrades: diff.downgrades.length,
  deletes: diff.deletes.length,
  normalizations,
});

function changesOf(diff: BadgeDiff, normalizations: readonly SeenNormalization[]): PlannedChange[] {
  return [
    ...diff.inserts.map((i): PlannedChange => ({ kind: 'insert', series: i.series, tier: i.tier, previousTier: null })),
    ...diff.upgrades.map((u): PlannedChange => ({ kind: 'upgrade', series: u.series, tier: u.tier, previousTier: u.previous_tier })),
    ...diff.downgrades.map((d): PlannedChange => ({ kind: 'downgrade', series: d.series, tier: d.tier, previousTier: d.previous_tier })),
    ...diff.deletes.map((d): PlannedChange => ({ kind: 'delete', series: d.series, tier: d.previous_tier, previousTier: d.previous_tier })),
    ...normalizations.map((n): PlannedChange => ({ kind: 'normalize', series: n.series, tier: n.tier, previousTier: null })),
  ];
}

async function processUser(
  supabase: Client,
  user: UserRow,
  seriesDefs: readonly BadgeSeriesDef[],
  options: BackfillBadgesOptions,
  now: Date
): Promise<UserBadgeReport> {
  const report: UserBadgeReport = {
    userId: user.id, name: user.name, runCount: 0, tiers: {}, next: {},
    plan: emptyCounts(), changes: [], written: null, pendingPopups: 0, error: null,
  };
  try {
    // Läsfel kastar (till skillnad från evaluateBadges, som sväljer dem): en användare vars indata inte är
    // komplett får aldrig planeras eller skrivas — en delvis läsning ser ut som att rundor försvunnit.
    const [runs, existing] = await Promise.all([readRuns(user.id), readExistingBadges(user.id)]);
    const streak = Number(user.longest_streak ?? 0);
    const stats: BadgeStats = { longest_streak: Number.isFinite(streak) ? streak : 0 };
    const computed = computeSeriesTiers(seriesDefs, BADGE_METRICS, runs, stats);

    const plan = planUserBackfill(existing, computed, { silent: options.silent, now });
    report.runCount = runs.length;
    for (const series of seriesDefs) {
      report.tiers[series.key] = computed[series.key].tier;
      report.next[series.key] = describeNextTier(series, computed[series.key].tier, runs, stats);
    }
    report.plan = countsOf(plan.diff, plan.normalizations.length);
    report.changes = changesOf(plan.diff, plan.normalizations);
    report.pendingPopups = plan.pendingPopups;

    if (options.apply) {
      const result = await applyBadgeDiff(user.id, existing, plan.diff);
      const normalized = await normalizeSeen(supabase, user.id, plan.normalizations, now);
      report.written = countsOf(result.written, normalized.done);
      if (!result.complete || !normalized.ok) report.error = 'some writes failed (see log above); re-run to retry';
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  return report;
}

export async function runBackfillBadges(options: BackfillBadgesOptions, now: Date = new Date()): Promise<BackfillBadgesReport> {
  const supabase = getSupabaseClient();
  const seriesDefs = BADGE_SERIES.filter((s) => !options.series || options.series.includes(s.key));
  const users = await readUsers(supabase, options.groupId);

  const reports: UserBadgeReport[] = [];
  for (const user of users) reports.push(await processUser(supabase, user, seriesDefs, options, now));
  reports.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));

  const distribution: Record<string, Record<number, number>> = {};
  for (const s of seriesDefs) {
    distribution[s.key] = Object.fromEntries(Array.from({ length: MAX_TIER + 1 }, (_, t) => [t, 0]));
  }
  const planned = emptyCounts();
  let written = 0;
  let normalized = 0;
  let pendingPopups = 0;
  for (const r of reports) {
    // Misslyckade användare saknar tiers och bidrar inte till fördelningen eller summorna.
    if (r.error && Object.keys(r.tiers).length === 0) continue;
    for (const [key, tier] of Object.entries(r.tiers)) distribution[key][tier] += 1;
    for (const k of Object.keys(planned) as Array<keyof PlanCounts>) planned[k] += r.plan[k];
    if (r.written) {
      written += r.written.inserts + r.written.upgrades + r.written.downgrades + r.written.deletes;
      normalized += r.written.normalizations;
    }
    pendingPopups += r.pendingPopups;
  }

  return {
    options,
    target: supabaseHost(),
    series: seriesDefs.map((s) => s.key),
    users: reports,
    distribution,
    totals: { planned, written, normalized, pendingPopups },
    failed: reports.filter((r) => r.error).length,
  };
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

const tierLabel = (tier: number): string => (tier >= 1 ? `${TIER_NAMES[tier - 1]} (${tier})` : '-');

/** Kolumner av olika bredd, två mellanslag emellan; sista kolumnen paddas inte. */
function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join('  ').trimEnd());
}

const describeCounts = (c: PlanCounts): string =>
  `${c.inserts} insert(s), ${c.upgrades} upgrade(s), ${c.downgrades} downgrade(s), ${c.deletes} delete(s)` +
  (c.normalizations > 0 ? `, ${c.normalizations} seen_tier normalization(s)` : '');

const changeLine = (c: PlannedChange): string => {
  const name = BADGE_SERIES.find((s) => s.key === c.series)?.name ?? c.series;
  switch (c.kind) {
    case 'insert': return `    + ${name}: ${tierLabel(c.tier)}`;
    case 'upgrade': return `    ↑ ${name}: ${tierLabel(c.previousTier!)} → ${tierLabel(c.tier)}`;
    case 'downgrade': return `    ↓ ${name}: ${tierLabel(c.previousTier!)} → ${tierLabel(c.tier)}`;
    case 'delete': return `    - ${name}: ${tierLabel(c.tier)} removed`;
    case 'normalize': return `    = ${name}: seen_tier → ${c.tier}`;
  }
};

export function formatReport(report: BackfillBadgesReport): string {
  const { options } = report;
  const seriesDefs = BADGE_SERIES.filter((s) => report.series.includes(s.key));
  const ok = report.users.filter((u) => !u.error || Object.keys(u.tiers).length > 0);
  const failed = report.users.filter((u) => u.error);
  const mode = options.apply
    ? `APPLY${options.silent ? ' --silent' : ''}`
    : `DRY-RUN (nothing is written)${options.silent ? ', --silent preview' : ''}`;

  const lines = [
    `badges backfill — ${mode}`,
    `target database: ${report.target}`,
    `scope: ${options.groupId ? `group ${options.groupId}` : 'all groups'}, ` +
      `series: ${options.series ? report.series.join(', ') : `all (${report.series.length})`}, ${report.users.length} user(s)`,
    '',
  ];

  if (ok.length > 0) {
    lines.push('Tiers per user and series', ...table([
      ['user', ...seriesDefs.map((s) => s.name)],
      ...ok.map((u) => [u.name, ...seriesDefs.map((s) => tierLabel(u.tiers[s.key] ?? 0))]),
    ]));

    lines.push('', 'Tier distribution (users per tier)', ...table([
      ['series', ...Array.from({ length: MAX_TIER + 1 }, (_, t) => (t === 0 ? 'none' : TIER_NAMES[t - 1]))],
      ...seriesDefs.map((s) => [s.name, ...Array.from({ length: MAX_TIER + 1 }, (_, t) => String(report.distribution[s.key][t]))]),
    ]));

    lines.push('', 'Next tier (measure / threshold)');
    for (const u of ok) {
      lines.push(`${u.name} (${u.runCount} run(s))`);
      for (const s of seriesDefs) {
        const next = u.next[s.key];
        const current = tierLabel(u.tiers[s.key] ?? 0);
        lines.push(next
          ? `  ${s.name}: ${current} → ${next.tierName}: ${next.measured} / ${next.threshold}${next.percent === null ? '' : ` (${next.percent}%)`}`
          : `  ${s.name}: ${current} — highest tier`);
      }
    }

    lines.push('', options.apply ? 'Write plan (written)' : 'Write plan');
    for (const u of ok) {
      const counts = options.apply && u.written ? u.written : u.plan;
      lines.push(`${u.name}: ${describeCounts(counts)}`);
      if (!options.apply) for (const c of u.changes) lines.push(changeLine(c));
    }
  }

  if (failed.length > 0) {
    lines.push('', `FAILED (${failed.length} user(s)):`);
    for (const u of failed) lines.push(`  ${u.name}: ${u.error}`);
  }

  const { planned, written, normalized, pendingPopups } = report.totals;
  const plannedTotal = sumCounts(planned);
  lines.push('');
  if (pendingPopups > 0) {
    lines.push(`${pendingPopups} existing row(s) have seen_tier < tier and will show a popup; re-run with --apply --silent to mark them seen.`);
  }
  if (options.apply) {
    lines.push(plannedTotal === 0 && failed.length === 0
      ? 'Nothing to write — user_badges already matches the computed tiers.'
      : `Wrote ${written} badge change(s) with seen_tier = tier, normalized ${normalized} row(s). No activity_log rows were written.`);
  } else {
    lines.push(plannedTotal === 0
      ? 'Nothing to write — user_badges already matches the computed tiers.'
      : `${plannedTotal} change(s) would be written. Re-run with --apply to write them${options.silent ? '' : ' (add --silent to also mark existing rows as seen)'}.`);
  }
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await import('dotenv/config'); // först här: att importera modulen (tester) ska inte läsa .env
  const options = parseArgs(process.argv.slice(2));
  // Målet skrivs ut FÖRE körningen också, så ägaren ser vilken databas som berörs innan något skrivs.
  console.log(`Target database: ${supabaseHost()} (${options.apply ? 'APPLY' : 'dry-run'})`);
  const report = await runBackfillBadges(options);
  console.log(formatReport(report));
  if (report.failed > 0) process.exitCode = 1;
}

// Kör bara som skript, inte när testerna importerar modulen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('❌ Badge backfill failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
