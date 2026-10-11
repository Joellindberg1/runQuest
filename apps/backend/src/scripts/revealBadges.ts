/**
 * revealBadges.ts — "avtäckning" av badges vid release (ADR 009 beslut 5 och 10, RUN-156).
 *
 * Ägarbeslut: vid releasen ska alla användare få sina badges som om de precis förtjänat dem. backfill:badges
 * (RUN-124/125) skrev user_badges med seen_tier = tier och inga news-rader, med avsikt, så att ingen popup-flod
 * eller historisk news uppstod vid backfillen. Det här skriptet gör det synligt i efterhand, per user_badges-rad:
 *   1. en badge_earned-rad i Pack News (activity_log) — byggd av SAMMA kod som den löpande utvärderingen:
 *      badgeNewsChanges (shared) med en "insert" per rad ger exakt live-draften (payload {series, tier,
 *      previous_tier: null}, dedupe_key = badge_earned:<user>:<serie>:<tier> för landningsnivån, is_backfill false,
 *      users.group_id som grupp) och skrivs via recordActivities (upsert ... ON CONFLICT (dedupe_key) DO NOTHING);
 *   2. seen_tier = 0 på raden, så uppgraderingspopupen (seen_tier < tier) visas vid nästa inloggning.
 * Rapporten innehåller användarnamn (för Lead i terminalen) men aldrig e-post, lösenord eller tokens — de läses aldrig.
 *
 * Körs:  npm run reveal:badges --workspace=@runquest/backend -- [--apply] [--group=<id>]
 *   (default)   DRY-RUN: per användare antal badges, news-rader som skulle skrivas, rader som får seen_tier = 0,
 *               rader som redan är avtäckta (news finns) och användare utan grupp. Skriver ingenting och rör
 *               inte activity_log-constrainten (förkravskontrollen nedan körs bara med --apply).
 *   --apply     kontrollerar förkravet 036 (se nedan), skriver sedan news och nollställer seen_tier.
 *   --group     bara användare i en grupp (users.group_id).
 *
 * Mot produktion (Railway-CLI:n injicerar miljön — ingen lokal .env; kör från repo-roten):
 *   railway run --service runQuest-backend -- npm run reveal:badges --workspace=@runquest/backend
 *   railway run --service runQuest-backend -- npm run reveal:badges --workspace=@runquest/backend -- --apply
 * Dry-run är fritt; --apply mot produktion kräver ägargodkännande (docs/permissions.md). Skriptet skriver ut
 * måldatabasens host före körningen och i rapporten.
 *
 * KÖRORDNING vid v0.6.0-releasen:
 *   deploy (backend + frontend v0.6.0) → migration 036 (badge_earned i activity_log_type_check)
 *   → reveal:badges (dry-run → --apply) → migration 037 + reprocess-all.
 *   Skäl: v0.5.3-frontendens News kraschar på okända typer, så badge_earned-rader får inte finnas före den nya
 *   frontenden; och utan 036 avvisar CHECK-constrainten raderna. Reveal före 037/reprocess-all, eftersom
 *   reprocess-all kan ändra rundor och därmed tiers: avtäckningen ska utgå från de rader som backfillen skrev.
 *   Reveal är en engångsåtgärd: efter releasen skriver den löpande utvärderingen news och popup själv.
 *
 * FÖRKRAV 036 — kontrollen (bara med --apply, innan något annat skrivs):
 *   En testinsert av en badge_earned-rad med ett slumpat group_id som inte finns (FK activity_log.group_id →
 *   groups). Postgres utvärderar CHECK-constrainten FÖRE foreign key-kontrollen, så utfallet säger vad som saknas:
 *     - 23514 / activity_log_type_check  → 036 saknas: avbrott, inget skrivet (testinserten avvisades).
 *     - 23503 (foreign key)              → CHECK:en släppte igenom badge_earned: 036 finns; inget skrevs.
 *     - lyckad insert (oväntat)          → raden raderas direkt på sin egen unika testnyckel; kontrollen godkänns.
 *     - annat fel                        → kan inte verifieras: avbrott.
 *   Valet: kräver ingen RPC eller ny migration, lämnar inga data kvar och går via service-role-klienten.
 *
 * IDEMPOTENS: en rad räknas som redan avtäckt när dess news-nyckel finns i activity_log (live-earned med news
 * eller en tidigare reveal-körning) och rörs då inte alls — varken news eller seen_tier. Därför ger en omkörning noll
 * nya news-rader och rör inte seen_tier hos användare som hunnit se sin popup. Per rad görs seen_tier = 0 FÖRE
 * news-skrivningen: faller något mitt i står nyckeln fortfarande saknad och en omkörning tar om raden.
 * Användare utan grupp får ingen news (loggen kräver group_id) men seen_tier nollställs ändå, så popupen visas;
 * för dem finns ingen nyckel att vara idempotent mot (rapporteras separat).
 *
 * Fel: recordActivities sväljer skrivfel (som live-vägen), så skriptet läser tillbaka nycklarna efter skrivningen
 * och räknar bara det som faktiskt finns. En användare vars skrivning eller verifiering faller rapporteras,
 * övriga körs vidare och skriptet avslutar med exit-kod 1 — kör om för att ta resten.
 */
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '../config/database.js';
import { ACTIVITY_LOG_TABLE, recordActivities } from '../services/activityLog.js';
import { supabaseHost } from './backfillActivityLog.js';
import {
  activityKeys,
  badgeNewsChanges,
  type ActivityDraft,
  type BadgeDiff,
  type BadgeInsert,
} from '@runquest/shared';

const PAGE_SIZE = 1000;
const ID_CHUNK = 100;  // användar-id per .in()-fråga (URL-längd)
const KEY_CHUNK = 50;  // dedupe_key per .in()-fråga (URL-längd)
const USER_BADGES_TABLE = 'user_badges';

export interface RevealBadgesOptions {
  apply: boolean;
  groupId?: string;
}

/** Förkravet 036 saknas eller kunde inte verifieras: inget har skrivits. */
export class RevealPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevealPreconditionError';
  }
}

// ─── Rena funktioner (testas utan databas) ───────────────────────────────────

export function parseArgs(argv: string[]): RevealBadgesOptions {
  const options: RevealBadgesOptions = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--group=')) {
      const group = arg.slice('--group='.length).trim();
      if (!group) throw new Error('--group needs a group id');
      options.groupId = group;
    } else {
      throw new Error(`Unknown argument "${arg}". Usage: [--apply] [--group=<id>]`);
    }
  }
  return options;
}

export interface BadgeRowRef {
  series: string;
  tier: number;
  seen_tier: number;
}

export interface RevealPlan {
  /** Rader som ännu inte är avtäckta (news saknas, eller ingen grupp). */
  pending: BadgeRowRef[];
  /** Rader vars news redan finns: rörs inte. */
  alreadyRevealed: BadgeRowRef[];
  /** badge_earned-drafts att skriva, en per pending-rad; tom utan grupp. */
  drafts: ActivityDraft[];
  /** Pending-rader med seen_tier > 0: de som nollställs. */
  seenResets: BadgeRowRef[];
}

const insertOf = (row: BadgeRowRef, occurredAt: string): BadgeInsert => ({
  series: row.series, tier: row.tier, seen_tier: row.seen_tier, earned_at: occurredAt, source_run_id: null, updated_at: occurredAt,
});

/**
 * Live-draften för en rad: badgeNewsChanges med en insert per rad (samma funktion som evaluateBadges använder).
 * Utan grupp ger den ingen draft.
 */
export function revealDrafts(
  userId: string, groupId: string | null, rows: readonly BadgeRowRef[], occurredAt: string
): ActivityDraft[] {
  const written: BadgeDiff = { inserts: rows.map((r) => insertOf(r, occurredAt)), upgrades: [], downgrades: [], deletes: [], showcaseRemovals: [] };
  return badgeNewsChanges(written, { userId, groupId, occurredAt }).drafts;
}

export const newsKeyOf = (userId: string, row: BadgeRowRef): string => activityKeys.badgeEarned(userId, row.series, row.tier);

/** Skrivplanen för en användare. `existingKeys` = nycklar som redan finns i activity_log. */
export function planUserReveal(
  userId: string, groupId: string | null, rows: readonly BadgeRowRef[], existingKeys: ReadonlySet<string>, occurredAt: string
): RevealPlan {
  // Utan grupp finns ingen news och därmed ingen nyckel att jämföra mot: alla rader är pending.
  const revealed = (r: BadgeRowRef): boolean => groupId !== null && existingKeys.has(newsKeyOf(userId, r));
  const pending = rows.filter((r) => !revealed(r));
  const alreadyRevealed = rows.filter(revealed);
  return {
    pending,
    alreadyRevealed,
    drafts: revealDrafts(userId, groupId, pending, occurredAt),
    seenResets: pending.filter((r) => r.seen_tier > 0),
  };
}

// ─── Rapportens datamodell ───────────────────────────────────────────────────

export interface UserRevealReport {
  userId: string;
  name: string;
  groupId: string | null;
  badges: number;
  alreadyRevealed: number;
  /** Planerat. */
  newsPlanned: number;
  seenResetsPlanned: number;
  /** Faktiskt skrivet (bara med --apply). */
  newsWritten: number | null;
  seenResetsWritten: number | null;
  error: string | null;
}

export interface RevealBadgesReport {
  options: RevealBadgesOptions;
  target: string;
  users: UserRevealReport[];
  /** Namn på användare med badges men utan grupp (ingen news). */
  withoutGroup: string[];
  totals: {
    users: number;
    badges: number;
    alreadyRevealed: number;
    newsPlanned: number;
    seenResetsPlanned: number;
    newsWritten: number;
    seenResetsWritten: number;
  };
  /** Bara med --apply: hur förkravet 036 kontrollerades. */
  precondition: string | null;
  failed: number;
}

// ─── Läsning och skrivning ───────────────────────────────────────────────────

type Client = ReturnType<typeof getSupabaseClient>;

interface BadgeRowRecord extends BadgeRowRef {
  user_id: string;
}

interface UserRow {
  id: string;
  name: string;
  group_id: string | null;
}

const chunked = <T>(items: readonly T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
};

async function readAllBadges(supabase: Client): Promise<BadgeRowRecord[]> {
  const rows: BadgeRowRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(USER_BADGES_TABLE)
      .select('user_id, series, tier, seen_tier')
      .order('user_id', { ascending: true })
      .order('series', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error?.code === 'PGRST103' && from > 0) return rows; // sidan ligger bortom sista raden
    if (error) throw new Error(`Could not read user_badges: ${error.message}`);
    for (const r of data ?? []) {
      rows.push({ user_id: r.user_id, series: r.series, tier: Number(r.tier), seen_tier: Number(r.seen_tier) });
    }
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/** Bara id, namn och grupp — aldrig e-post, lösenordshash eller Strava-tokens. */
async function readUsers(supabase: Client, ids: readonly string[], groupId: string | undefined): Promise<Map<string, UserRow>> {
  const users = new Map<string, UserRow>();
  for (const part of chunked(ids, ID_CHUNK)) {
    let query = supabase.from('users').select('id, name, group_id').in('id', part);
    if (groupId) query = query.eq('group_id', groupId);
    const { data, error } = await query;
    if (error) throw new Error(`Could not read users: ${error.message}`);
    for (const u of data ?? []) users.set(u.id, { id: u.id, name: u.name, group_id: u.group_id ?? null });
  }
  return users;
}

async function readExistingKeys(supabase: Client, keys: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunked(keys, KEY_CHUNK)) {
    const { data, error } = await supabase.from(ACTIVITY_LOG_TABLE).select('dedupe_key').in('dedupe_key', part);
    if (error) throw new Error(`Could not read activity_log keys: ${error.message}`);
    for (const r of data ?? []) found.add(r.dedupe_key);
  }
  return found;
}

/**
 * Förkrav 036 (se huvudkommentaren): testinsert med ett group_id som inte finns. CHECK utvärderas före
 * FK, så 23514 = badge_earned avvisas av constrainten, 23503 = constrainten släppte igenom raden.
 * Kastar RevealPreconditionError om förkravet saknas eller inte kan verifieras; ger annars en beskrivning.
 */
export async function assertBadgeEarnedAllowed(supabase: Client): Promise<string> {
  const probeKey = `reveal-badges-probe:${randomUUID()}`;
  const { error } = await supabase.from(ACTIVITY_LOG_TABLE).insert({
    group_id: randomUUID(), // finns inte i groups → raden kan aldrig bli kvar
    type: 'badge_earned',
    actor_user_id: null,
    target_user_id: null,
    payload: {},
    payload_version: 1,
    dedupe_key: probeKey,
    is_backfill: false,
  });

  if (!error) {
    // Oväntat: FK:n släppte igenom. Städa vår egen testrad (unik nyckel) och godkänn — CHECK:en tillät typen.
    const cleanup = await supabase.from(ACTIVITY_LOG_TABLE).delete().eq('dedupe_key', probeKey);
    if (cleanup.error) {
      throw new RevealPreconditionError(`036 probe row was inserted and could not be removed (dedupe_key ${probeKey}): ${cleanup.error.message}`);
    }
    return 'activity_log accepts badge_earned (probe row was inserted and removed again)';
  }
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  if (error.code === '23514' || /activity_log_type_check/.test(text)) {
    throw new RevealPreconditionError(
      'Migration 036 is not applied: activity_log_type_check rejects type "badge_earned". Nothing was written. ' +
        'Apply 036 (after the v0.6.0 deploy), then re-run.'
    );
  }
  if (error.code === '23503' || /foreign key/i.test(text)) {
    return 'activity_log accepts badge_earned (check constraint passed; probe rejected by the group foreign key, nothing written)';
  }
  throw new RevealPreconditionError(`Could not verify migration 036 (unexpected error: ${text.trim()}). Nothing was written.`);
}

/** seen_tier = 0 på en rad. Tier-vakten gör att en rad vars tier ändrats under tiden inte träffas. */
async function resetSeenTier(supabase: Client, userId: string, row: BadgeRowRef, now: Date): Promise<boolean> {
  const { error } = await supabase
    .from(USER_BADGES_TABLE)
    .update({ seen_tier: 0, updated_at: now.toISOString() })
    .eq('user_id', userId)
    .eq('series', row.series)
    .eq('tier', row.tier);
  return !error;
}

async function processUser(
  supabase: Client, user: UserRow, rows: readonly BadgeRowRef[], options: RevealBadgesOptions, now: Date
): Promise<UserRevealReport> {
  const report: UserRevealReport = {
    userId: user.id, name: user.name, groupId: user.group_id, badges: rows.length, alreadyRevealed: 0,
    newsPlanned: 0, seenResetsPlanned: 0, newsWritten: null, seenResetsWritten: null, error: null,
  };
  try {
    const occurredAt = now.toISOString();
    const existing = user.group_id
      ? await readExistingKeys(supabase, rows.map((r) => newsKeyOf(user.id, r)))
      : new Set<string>();
    const plan = planUserReveal(user.id, user.group_id, rows, existing, occurredAt);
    report.alreadyRevealed = plan.alreadyRevealed.length;
    report.newsPlanned = plan.drafts.length;
    report.seenResetsPlanned = plan.seenResets.length;
    if (!options.apply) return report;

    // seen_tier först: faller något mitt i står news-nyckeln kvar som saknad och en omkörning tar om raden.
    const failedResets = new Set<string>();
    let resets = 0;
    for (const row of plan.seenResets) {
      if (await resetSeenTier(supabase, user.id, row, now)) resets += 1;
      else failedResets.add(row.series);
    }
    const drafts = plan.drafts.filter((d) => !failedResets.has((d.payload as { series: string }).series));
    await recordActivities(drafts); // sväljer fel som live-vägen — verifieras nedan

    const after = await readExistingKeys(supabase, drafts.map((d) => d.dedupe_key));
    const written = drafts.filter((d) => after.has(d.dedupe_key)).length;
    report.newsWritten = written;
    report.seenResetsWritten = resets;
    if (failedResets.size > 0 || written < drafts.length) {
      report.error = 'some writes failed (see log above); re-run to retry';
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  return report;
}

export async function runRevealBadges(options: RevealBadgesOptions, now: Date = new Date()): Promise<RevealBadgesReport> {
  const supabase = getSupabaseClient();
  // Förkravet kontrolleras före ALLT annat som skriver; saknas 036 kastas det och inget är skrivet.
  const precondition = options.apply ? await assertBadgeEarnedAllowed(supabase) : null;

  const badges = await readAllBadges(supabase);
  const byUser = new Map<string, BadgeRowRef[]>();
  for (const b of badges) {
    const list = byUser.get(b.user_id) ?? [];
    list.push({ series: b.series, tier: b.tier, seen_tier: b.seen_tier });
    byUser.set(b.user_id, list);
  }
  const users = await readUsers(supabase, [...byUser.keys()], options.groupId);

  const reports: UserRevealReport[] = [];
  for (const user of users.values()) reports.push(await processUser(supabase, user, byUser.get(user.id) ?? [], options, now));
  reports.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));

  const totals = {
    users: reports.length, badges: 0, alreadyRevealed: 0, newsPlanned: 0, seenResetsPlanned: 0, newsWritten: 0, seenResetsWritten: 0,
  };
  for (const r of reports) {
    totals.badges += r.badges;
    totals.alreadyRevealed += r.alreadyRevealed;
    totals.newsPlanned += r.newsPlanned;
    totals.seenResetsPlanned += r.seenResetsPlanned;
    totals.newsWritten += r.newsWritten ?? 0;
    totals.seenResetsWritten += r.seenResetsWritten ?? 0;
  }

  return {
    options,
    target: supabaseHost(),
    users: reports,
    withoutGroup: reports.filter((r) => r.groupId === null).map((r) => r.name),
    totals,
    precondition,
    failed: reports.filter((r) => r.error).length,
  };
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

/** Kolumner av olika bredd, två mellanslag emellan; sista kolumnen paddas inte. */
function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join('  ').trimEnd());
}

export function formatReport(report: RevealBadgesReport): string {
  const { options, totals } = report;
  const apply = options.apply;
  const lines = [
    `badges reveal — ${apply ? 'APPLY' : 'DRY-RUN (nothing is written)'}`,
    `target database: ${report.target}`,
    `scope: ${options.groupId ? `group ${options.groupId}` : 'all groups'}, ${totals.users} user(s) with badges`,
  ];
  if (report.precondition) lines.push(`migration 036: ${report.precondition}`);
  lines.push('');

  if (report.users.length > 0) {
    lines.push(...table([
      ['user', 'badges', 'already revealed', apply ? 'news written' : 'news to write', apply ? 'seen_tier reset' : 'seen_tier -> 0', 'group'],
      ...report.users.map((u) => [
        u.name,
        String(u.badges),
        String(u.alreadyRevealed),
        apply ? `${u.newsWritten ?? 0}/${u.newsPlanned}` : String(u.newsPlanned),
        apply ? `${u.seenResetsWritten ?? 0}/${u.seenResetsPlanned}` : String(u.seenResetsPlanned),
        u.groupId ?? 'NONE (no news)',
      ]),
    ]));
  }

  const failed = report.users.filter((u) => u.error);
  if (failed.length > 0) {
    lines.push('', `FAILED (${failed.length} user(s)):`);
    for (const u of failed) lines.push(`  ${u.name}: ${u.error}`);
  }
  if (report.withoutGroup.length > 0) {
    lines.push('', `${report.withoutGroup.length} user(s) without a group get no news (seen_tier is still reset): ${report.withoutGroup.join(', ')}`);
  }

  lines.push('');
  const nothingToDo = totals.newsPlanned === 0 && totals.seenResetsPlanned === 0;
  if (apply) {
    lines.push(nothingToDo && failed.length === 0
      ? `Nothing to write — ${totals.alreadyRevealed} badge row(s) already revealed.`
      : `Wrote ${totals.newsWritten} badge_earned news row(s) and reset seen_tier on ${totals.seenResetsWritten} badge row(s); ` +
        `${totals.alreadyRevealed} already revealed row(s) left untouched.`);
  } else {
    lines.push(nothingToDo
      ? `Nothing to write — ${totals.alreadyRevealed} badge row(s) already revealed.`
      : `${totals.newsPlanned} news row(s) would be written and seen_tier reset on ${totals.seenResetsPlanned} badge row(s) ` +
        `(${totals.alreadyRevealed} already revealed, left untouched). Re-run with --apply to write them (requires migration 036).`);
  }
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await import('dotenv/config'); // först här: att importera modulen (tester) ska inte läsa .env
  const options = parseArgs(process.argv.slice(2));
  // Målet skrivs ut FÖRE körningen också, så ägaren ser vilken databas som berörs innan något skrivs.
  console.log(`Target database: ${supabaseHost()} (${options.apply ? 'APPLY' : 'dry-run'})`);
  const report = await runRevealBadges(options);
  console.log(formatReport(report));
  if (report.failed > 0) process.exitCode = 1;
}

// Kör bara som skript, inte när testerna importerar modulen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('❌ Badge reveal failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
