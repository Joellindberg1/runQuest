/**
 * backfillActivityLog.ts — retroaktiv backfill av härledbara händelser till activity_log (ADR 008 beslut 7).
 *
 * Skriver `is_backfill = true`-rader med SAMMA dedupe_key som live-skrivningen, så skriptet är idempotent:
 * omkörning ger inga dubbletter (INSERT … ON CONFLICT (dedupe_key) DO NOTHING) och rader som redan
 * finns (live eller från en tidigare körning) hoppas över och räknas som "finns redan".
 *
 * Omfång (rena byggfunktioner i @runquest/shared, enhetstestade — skriptet är bara I/O):
 *   challenge_won / challenge_draw   completed-utmaningar (occurred_at = determine_at ?? end_date)
 *   challenge_received               endast pending-utmaningar (created_at)
 *   event_open                       events med status active (starts_at)
 *   event_closed                     events med status settled (settled_at ?? ends_at); participants ur
 *                                    event_entries, members = NUVARANDE gruppstorlek (approximation)
 *   level_up                         XP-liggaren (buildXpLedger) uppspelad mot level_requirements
 *   run_milestone                    runs kumulerat per användare (100/250/500/1000/2500/5000 km)
 *   streak_broken                    dagsföljder ≥ T (lägsta days i streak_multipliers) som dött
 *   title_*                          BACKFILLAS INTE (title_leaderboard skrivs över; earned_at = "senast förbättrad")
 *
 * Körs:  npm run backfill:activity-log --workspace=@runquest/backend -- [--apply] [--since=YYYY-MM-DD] [--group=<id>]
 *   (default)   DRY-RUN: skriver bara räknare per typ + urval, rör ingenting
 *   --apply     skriver nya rader (kronologiskt, så id-ordningen i en tom tabell = tidsordning)
 *   --since     bara händelser vars occurred_at ≥ början av dagen (Stockholm); default idag − 90 dagar
 *   --group     bara en grupp
 *
 * Ordning vid utrullning (ADR 008 beslut 12): migration 034 → denna backfill (dry-run, sedan --apply)
 * → deploy av backend med skrivpunkterna + /api/news. Körs mot den databas .env pekar på: --apply
 * mot produktion kräver ägargodkännande (docs/permissions.md). Rader kan rensas/regenereras med
 * `delete from activity_log where is_backfill`.
 */
import { pathToFileURL } from 'node:url';
import { getSupabaseClient } from '../config/database.js';
import { ACTIVITY_LOG_TABLE, toActivityRow } from '../services/activityLog.js';
import { isIsoCalendarDate, todayStockholm } from '../utils/dateUtils.js';
import {
  ACTIVITY_TYPES,
  FALLBACK_LEVEL_REQUIREMENTS,
  backfillChallenges,
  backfillEvents,
  backfillLevelUps,
  backfillRunMilestones,
  backfillStreakBroken,
  buildXpLedger,
  defaultSinceDay,
  filterSince,
  sortChronologically,
  streakBrokenThreshold,
  type ActivityDraft,
  type ActivityType,
  type BackfillChallengeRow,
  type BackfillEventEntry,
  type EventActivityRow,
  type LedgerEventEntry,
  type LedgerRun,
  type LevelRequirement,
} from '@runquest/shared';

const PAGE_SIZE = 1000;   // PostgREST kapar svar vid 1000 rader — all läsning sker sidvis
const KEY_CHUNK = 50;     // dedupe_key:er per .in()-fråga (URL-längd)
const WRITE_CHUNK = 200;  // rader per upsert
const SAMPLE_SIZE = 3;

export interface BackfillOptions {
  apply: boolean;
  /** Stockholm-dag YYYY-MM-DD. */
  since: string;
  groupId?: string;
}

export interface TypeReport {
  total: number;
  /** Fanns redan i tabellen (live eller tidigare körning). */
  existing: number;
  /** Skulle skrivas / skrevs. */
  new: number;
  /** Urval av nya rader (dedupe_key + occurred_at). */
  sample: Array<{ dedupe_key: string; occurred_at: string }>;
}

export interface BackfillReport {
  options: BackfillOptions;
  /** Värd (hostname) för databasen som körs mot — så att ägaren ser målet i rapporten. */
  target: string;
  perType: Record<ActivityType, TypeReport>;
  totalNew: number;
  inserted: number;
}

type Client = ReturnType<typeof getSupabaseClient>;

// ─── Läsning ─────────────────────────────────────────────────────────────────

async function fetchAll<T = any>(build: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Samlar alla drafts ur databasen via de rena byggfunktionerna i shared. */
export async function collectDrafts(supabase: Client, options: BackfillOptions): Promise<ActivityDraft[]> {
  const { groupId } = options;

  // Användare och grupper (gruppstorlek = nuvarande antal medlemmar)
  const users = await fetchAll<{ id: string; group_id: string | null }>((from, to) => {
    let q = supabase.from('users').select('id, group_id').order('id', { ascending: true });
    if (groupId) q = q.eq('group_id', groupId);
    return q.range(from, to);
  });
  const groupByUser = new Map<string, string | null>(users.map((u) => [u.id, u.group_id ?? null]));
  const membersByGroup: Record<string, number> = {};
  for (const u of users) if (u.group_id) membersByGroup[u.group_id] = (membersByGroup[u.group_id] ?? 0) + 1;
  const userIds = users.map((u) => u.id);

  // Utmaningar
  const challenges = await fetchAll<BackfillChallengeRow>((from, to) => {
    let q = supabase
      .from('challenges')
      .select(
        'id, group_id, status, tier, metric, duration_days, challenger_id, opponent_id, outcome, ' +
        'challenger_final_value, opponent_final_value, winner_type, winner_delta, winner_duration, ' +
        'loser_type, loser_delta, loser_duration, determine_at, end_date, created_at',
      )
      .in('status', ['completed', 'pending'])
      .order('id', { ascending: true });
    if (groupId) q = q.eq('group_id', groupId);
    return q.range(from, to);
  });

  // Events + deltagare
  const eventRows = await fetchAll<any>((from, to) => {
    let q = supabase
      .from('events')
      .select('id, group_id, type, status, starts_at, ends_at, settled_at, event_templates ( name, icon, reward_xp, reward_xp_1st )')
      .in('status', ['active', 'settled'])
      .order('id', { ascending: true });
    if (groupId) q = q.eq('group_id', groupId);
    return q.range(from, to);
  });
  const events: Array<EventActivityRow & { status: string }> = [];
  for (const e of eventRows) {
    const t = one<any>(e.event_templates);
    if (!t || (e.type !== 'participation' && e.type !== 'competition')) continue;
    events.push({
      id: e.id, group_id: e.group_id, type: e.type, status: e.status, starts_at: e.starts_at, ends_at: e.ends_at,
      settled_at: e.settled_at ?? null,
      template: { name: t.name, icon: t.icon ?? null, reward_xp: t.reward_xp ?? null, reward_xp_1st: t.reward_xp_1st ?? null },
    });
  }

  // event_entries: används både för "participants/top" och för XP-liggaren (level_up)
  const entryRows = await fetchAll<any>((from, to) =>
    supabase
      .from('event_entries')
      .select('id, event_id, user_id, rank, xp_awarded, qualified_at, events ( type, settled_at, ends_at )')
      .order('id', { ascending: true })
      .range(from, to),
  );
  const eventIds = new Set(events.map((e) => e.id));
  const entries: BackfillEventEntry[] = entryRows
    .filter((en) => eventIds.has(en.event_id))
    .map((en) => ({ event_id: en.event_id, user_id: en.user_id, rank: en.rank ?? null, xp_awarded: en.xp_awarded ?? null }));

  const ledgerEntries: LedgerEventEntry[] = [];
  for (const en of entryRows) {
    const ev = one<any>(en.events);
    if (!ev || !groupByUser.has(en.user_id)) continue;
    ledgerEntries.push({
      entry_id: en.id, user_id: en.user_id, event_id: en.event_id, event_type: ev.type, xp_awarded: en.xp_awarded ?? null,
      qualified_at: en.qualified_at ?? null, settled_at: ev.settled_at ?? null, ends_at: ev.ends_at,
    });
  }

  // Rundor (liggare, milstolpar, streak)
  const runs: Array<LedgerRun & { distance: number | string | null }> =
    userIds.length === 0
      ? []
      : await fetchAll((from, to) => {
          let q = supabase.from('runs').select('id, user_id, date, distance, xp_gained').order('date', { ascending: true }).order('id', { ascending: true });
          if (groupId) q = q.in('user_id', userIds);
          return q.range(from, to);
        }).then((rows) => rows.filter((r: any) => groupByUser.has(r.user_id)));

  // Konfig: level-trösklar och streak-tröskel T
  const { data: reqRows, error: reqError } = await supabase
    .from('level_requirements')
    .select('level, xp_required')
    .order('level', { ascending: true });
  if (reqError) throw reqError;
  const requirements: LevelRequirement[] = reqRows?.length ? reqRows : FALLBACK_LEVEL_REQUIREMENTS;

  const { data: multRows } = await supabase.from('streak_multipliers').select('days');
  const threshold = streakBrokenThreshold(multRows ?? []);

  const drafts: ActivityDraft[] = [
    ...backfillChallenges(challenges),
    ...backfillEvents(events, entries, membersByGroup),
    ...backfillLevelUps(buildXpLedger(runs, ledgerEntries), requirements, groupByUser),
    ...backfillRunMilestones(runs, groupByUser),
    ...backfillStreakBroken(runs, groupByUser, threshold, todayStockholm()),
  ];
  return sortChronologically(filterSince(drafts, options.since));
}

// ─── Skrivning ───────────────────────────────────────────────────────────────

async function existingKeys(supabase: Client, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(keys, KEY_CHUNK)) {
    const { data, error } = await supabase.from(ACTIVITY_LOG_TABLE).select('dedupe_key').in('dedupe_key', part);
    if (error) throw error;
    for (const r of data ?? []) found.add(r.dedupe_key);
  }
  return found;
}

/** Hostname ur SUPABASE_URL (aldrig nycklar/sökväg). 'unknown' om variabeln saknas eller är ogiltig. */
export function supabaseHost(url: string | undefined = process.env.SUPABASE_URL): string {
  try {
    return (url && new URL(url).host) || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function runBackfill(supabase: Client, options: BackfillOptions): Promise<BackfillReport> {
  const drafts = await collectDrafts(supabase, options);
  const existing = await existingKeys(supabase, drafts.map((d) => d.dedupe_key));
  const fresh = drafts.filter((d) => !existing.has(d.dedupe_key));

  const perType = Object.fromEntries(
    ACTIVITY_TYPES.map((t) => [t, { total: 0, existing: 0, new: 0, sample: [] } satisfies TypeReport]),
  ) as unknown as Record<ActivityType, TypeReport>;
  for (const d of drafts) {
    const r = perType[d.type];
    r.total++;
    if (existing.has(d.dedupe_key)) {
      r.existing++;
    } else {
      r.new++;
      if (r.sample.length < SAMPLE_SIZE) r.sample.push({ dedupe_key: d.dedupe_key, occurred_at: d.occurred_at });
    }
  }

  let inserted = 0;
  if (options.apply) {
    // fresh är redan kronologiskt sorterad. ignoreDuplicates skyddar mot en samtidig live-skrivning.
    for (const part of chunk(fresh, WRITE_CHUNK)) {
      const { error } = await supabase
        .from(ACTIVITY_LOG_TABLE)
        .upsert(part.map((d) => toActivityRow({ ...d, is_backfill: true })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (error) throw error;
      inserted += part.length;
    }
  }

  return { options, target: supabaseHost(), perType, totalNew: fresh.length, inserted };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv: string[], today: string = todayStockholm()): BackfillOptions {
  const options: BackfillOptions = { apply: false, since: defaultSinceDay(today) };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--since=')) {
      const since = arg.slice('--since='.length);
      if (!isIsoCalendarDate(since)) throw new Error(`--since must be a date YYYY-MM-DD (got "${since}")`);
      options.since = since;
    } else if (arg.startsWith('--group=')) {
      const group = arg.slice('--group='.length).trim();
      if (!group) throw new Error('--group needs a group id');
      options.groupId = group;
    } else {
      throw new Error(`Unknown argument "${arg}". Usage: [--apply] [--since=YYYY-MM-DD] [--group=<id>]`);
    }
  }
  return options;
}

export function formatReport(report: BackfillReport): string {
  const { options } = report;
  const lines = [
    `activity_log backfill — ${options.apply ? 'APPLY' : 'DRY-RUN (nothing is written)'}`,
    `target database: ${report.target}`,
    `since ${options.since}${options.groupId ? `, group ${options.groupId}` : ', all groups'}`,
    '',
    'type                 total  existing  new',
  ];
  for (const type of ACTIVITY_TYPES) {
    const r = report.perType[type];
    lines.push(`${type.padEnd(20)} ${String(r.total).padStart(5)}  ${String(r.existing).padStart(8)}  ${String(r.new).padStart(3)}`);
    for (const s of r.sample) lines.push(`    e.g. ${s.dedupe_key}  @ ${s.occurred_at}`);
  }
  lines.push('', `title_* events are never backfilled (ADR 008 beslut 7).`);
  lines.push(options.apply
    ? `Inserted ${report.inserted} new row(s) with is_backfill = true.`
    : `${report.totalNew} new row(s) would be written. Re-run with --apply to write them.`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  await import('dotenv/config'); // först här: att importera modulen (tester) ska inte läsa .env
  const options = parseArgs(process.argv.slice(2));
  // Målet skrivs ut FÖRE körningen också, så ägaren ser vilken databas som berörs innan något skrivs.
  console.log(`Target database: ${supabaseHost()} (${options.apply ? 'APPLY' : 'dry-run'})`);
  const report = await runBackfill(getSupabaseClient(), options);
  console.log(formatReport(report));
}

// Kör bara som skript, inte när testerna importerar modulen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('❌ Backfill failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
