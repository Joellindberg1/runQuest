/**
 * announceRelease.ts — en release som en rad i Pack News (RUN-161, v0.6.1).
 *
 * Ägarbeslut 2026-10-11: en release ska synas i Pack News, inte bara som What's new-popupen. Skriptet skriver en
 * release_published-rad per grupp (systemhändelse: ingen aktör, ingen target, is_backfill false, payload {version, title}),
 * byggd av buildReleasePublishedDraft (shared) och skriven via recordActivities (upsert ... ON CONFLICT (dedupe_key) DO NOTHING).
 *
 * VARFÖR ETT SKRIPT OCH INTE APPEN: release-previewn kör lokal frontend + backend mot PRODUKTIONSDATABASEN. Skrev appen eller
 * servern raden vid start skulle varje preview publicera releasen i förtid. Därför skrivs raden ALDRIG av appen/servern —
 * bara av det här skriptet, som körs som ett uttryckligt releasesteg med ägar-ja. (Ingen kod i src/ utanför scripts/ anropar det.)
 *
 * Vilken release: apps/frontend/src/data/changelog.json — den SENASTE posten (högsta versionen) med `announce: true`, eller
 * `--version=x.y.z`, som då måste finnas i filen och ha `announce: true`. Ingen sådan post, eller en okänd/ej annonserad
 * version → tydligt fel innan databasen rörs. Vilka grupper: alla rader i `groups` (en rad per grupp och version).
 *
 * Körs:  npm run announce:release --workspace=@runquest/backend -- [--apply] [--version=<x.y.z>]
 *   (default)   DRY-RUN: skriver ut måldatabasens host, vald release, vilka grupper som får en rad och vilka som redan har den.
 *               Skriver ingenting och provar inte activity_log-constrainten (förkravskontrollen körs bara med --apply).
 *   --apply     kontrollerar förkravet 041 (se nedan), skriver sedan raderna.
 *   --version   en specifik version i stället för den senaste annonserade.
 *
 * Mot produktion (Railway-CLI:n injicerar miljön — ingen lokal .env; kör från repo-roten):
 *   railway run --service runQuest-backend -- npm run announce:release --workspace=@runquest/backend
 *   railway run --service runQuest-backend -- npm run announce:release --workspace=@runquest/backend -- --apply
 * Dry-run är fritt; --apply mot produktion kräver ägargodkännande (docs/permissions.md). Skriptet skriver ut
 * måldatabasens host före körningen och i rapporten.
 *
 * KÖRORDNING vid releasen: deploy (backend + frontend) → migration 041 (release_published i activity_log_type_check)
 * → announce:release (dry-run → --apply). Utan 041 avvisar CHECK-constrainten raderna.
 *
 * FÖRKRAV 041 — kontrollen (bara med --apply, innan något skrivs): samma testinsert som revealBadges använder, delad hjälpare
 * scripts/lib/activityTypeProbe.ts, här med typen release_published (ett slumpat group_id som inte finns; CHECK utvärderas före
 * foreign key). Saknas typen i CHECK avbryts körningen utan att något är skrivet.
 *
 * IDEMPOTENS: nyckeln release_published:<group_id>:<version> finns redan = gruppen hoppas över. En omkörning ger noll nya rader,
 * och en grupp som skapats efter första körningen får sin rad vid nästa. Fel: recordActivities sväljer skrivfel (som live-vägen),
 * så skriptet läser tillbaka nycklarna efter skrivningen och räknar bara det som faktiskt finns; saknas någon avslutar
 * skriptet med exit-kod 1 — kör om för att ta resten.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSupabaseClient } from '../config/database.js';
import { ACTIVITY_LOG_TABLE, recordActivities } from '../services/activityLog.js';
import { supabaseHost } from './lib/supabaseHost.js';
import { probeActivityType } from './lib/activityTypeProbe.js';
import { activityKeys, buildReleasePublishedDraft, type ActivityDraft } from '@runquest/shared';

const KEY_CHUNK = 50; // dedupe_key per .in()-fråga (URL-längd)
const SEMVER = /^\d+\.\d+\.\d+$/;
const CHANGELOG_RELATIVE = 'apps/frontend/src/data/changelog.json';

export interface AnnounceReleaseOptions {
  apply: boolean;
  /** x.y.z; utelämnad = den senaste posten med announce: true. */
  version?: string;
}

/** Förkravet 041 saknas eller kunde inte verifieras: inget har skrivits. */
export class AnnouncePreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncePreconditionError';
  }
}

/** Ingen release att annonsera (ingen announce-post, okänd eller ej annonserad --version): databasen har inte rörts. */
export class ReleaseSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseSelectionError';
  }
}

// ─── Rena funktioner (testas utan databas) ───────────────────────────────────

export function parseArgs(argv: string[]): AnnounceReleaseOptions {
  const options: AnnounceReleaseOptions = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--version=')) {
      const version = arg.slice('--version='.length).trim();
      if (!SEMVER.test(version)) throw new Error(`--version must be X.Y.Z (got "${version}")`);
      options.version = version;
    } else {
      throw new Error(`Unknown argument "${arg}". Usage: [--apply] [--version=<x.y.z>]`);
    }
  }
  return options;
}

/** Det skriptet behöver ur en post i changelog.json. */
export interface ChangelogRelease {
  version: string;
  title: string;
  announce?: boolean;
}

const versionParts = (version: string): number[] => version.split('.').map(Number);

/** Negativt om a < b, 0 om lika, positivt om a > b (båda X.Y.Z). */
function compareVersions(a: string, b: string): number {
  const [pa, pb] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Releasen att annonsera: `version` om given (måste finnas och ha announce: true), annars den högsta versionen med
 * announce: true. Poster utan giltig version eller rubrik räknas inte (en trasig post ska inte kunna bli en nyhetsrad).
 */
export function selectRelease(releases: readonly ChangelogRelease[], version?: string): ChangelogRelease {
  const usable = releases.filter((r) => typeof r.version === 'string' && SEMVER.test(r.version) && typeof r.title === 'string' && r.title.trim() !== '');
  if (version) {
    const found = usable.find((r) => r.version === version);
    if (!found) throw new ReleaseSelectionError(`Version ${version} is not in changelog.json. Nothing was written.`);
    if (found.announce !== true) {
      throw new ReleaseSelectionError(`Version ${version} is in changelog.json but has no "announce": true, so it is not announced. Nothing was written.`);
    }
    return found;
  }
  const announced = usable.filter((r) => r.announce === true).sort((a, b) => compareVersions(b.version, a.version));
  if (announced.length === 0) {
    throw new ReleaseSelectionError('No release in changelog.json has "announce": true. Nothing was written.');
  }
  return announced[0];
}

export interface GroupRef {
  id: string;
  name: string;
}

export interface AnnouncePlan {
  /** Grupper som saknar raden: skrivs. */
  pending: GroupRef[];
  /** Grupper vars nyckel redan finns: rörs inte. */
  alreadyAnnounced: GroupRef[];
  /** En draft per pending-grupp. */
  drafts: ActivityDraft[];
}

/** Skrivplanen. `existingKeys` = nycklar som redan finns i activity_log. */
export function planAnnouncement(
  release: ChangelogRelease, groups: readonly GroupRef[], existingKeys: ReadonlySet<string>, occurredAt: string
): AnnouncePlan {
  const announced = (g: GroupRef): boolean => existingKeys.has(activityKeys.releasePublished(g.id, release.version));
  const pending = groups.filter((g) => !announced(g));
  return {
    pending,
    alreadyAnnounced: groups.filter(announced),
    drafts: pending.map((g) => buildReleasePublishedDraft(g.id, release.version, release.title, occurredAt)),
  };
}

// ─── Rapportens datamodell ───────────────────────────────────────────────────

export interface AnnounceReleaseReport {
  options: AnnounceReleaseOptions;
  target: string;
  release: { version: string; title: string };
  groups: Array<{ id: string; name: string; alreadyAnnounced: boolean; planned: boolean; written: boolean | null }>;
  totals: { groups: number; alreadyAnnounced: number; planned: number; written: number };
  /** Bara med --apply: hur förkravet 041 kontrollerades. */
  precondition: string | null;
  failed: number;
}

// ─── Läsning och skrivning ───────────────────────────────────────────────────

type Client = ReturnType<typeof getSupabaseClient>;

const chunked = <T>(items: readonly T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
};

/** Hittar changelog.json genom att gå uppåt från den här filen (fungerar från src/ via tsx och från dist/). */
export function findChangelogPath(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, CHANGELOG_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find ${CHANGELOG_RELATIVE} above ${startDir}`);
}

export function readChangelogReleases(path: string = findChangelogPath()): ChangelogRelease[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const releases = (parsed as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(releases)) throw new Error(`${path} has no "releases" array`);
  return releases as ChangelogRelease[];
}

async function readGroups(supabase: Client): Promise<GroupRef[]> {
  const { data, error } = await supabase.from('groups').select('id, name').order('id', { ascending: true });
  if (error) throw new Error(`Could not read groups: ${error.message}`);
  return (data ?? []).map((g: { id: string; name: string | null }) => ({ id: g.id, name: g.name ?? '' }));
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
 * Förkrav 041 (se huvudkommentaren), via den delade proben. Kastar AnnouncePreconditionError om typen avvisas eller inte kan
 * verifieras; ger annars en beskrivning till rapporten.
 */
export async function assertReleasePublishedAllowed(supabase: Client): Promise<string> {
  const verdict = await probeActivityType(supabase, 'release_published', 'announce-release-probe');
  switch (verdict.kind) {
    case 'allowed':
      return verdict.via === 'inserted_and_removed'
        ? 'activity_log accepts release_published (probe row was inserted and removed again)'
        : 'activity_log accepts release_published (check constraint passed; probe rejected by the group foreign key, nothing written)';
    case 'rejected':
      throw new AnnouncePreconditionError(
        'Migration 041 is not applied: activity_log_type_check rejects type "release_published". Nothing was written. ' +
          'Apply 041 (after the deploy), then re-run.'
      );
    case 'cleanup_failed':
      throw new AnnouncePreconditionError(`041 probe row was inserted and could not be removed (dedupe_key ${verdict.probeKey}): ${verdict.detail}`);
    case 'unverifiable':
      throw new AnnouncePreconditionError(`Could not verify migration 041 (unexpected error: ${verdict.detail}). Nothing was written.`);
  }
}

/**
 * Hela körningen. `releases` är injicerbar så att testerna slipper filsystemet; CLI:t läser changelog.json. Releasen väljs FÖRE
 * databasen: en saknad/ej annonserad version ger fel utan att något läses eller skrivs.
 */
export async function runAnnounceRelease(
  options: AnnounceReleaseOptions, releases: readonly ChangelogRelease[], now: Date = new Date()
): Promise<AnnounceReleaseReport> {
  const release = selectRelease(releases, options.version);
  const supabase = getSupabaseClient();
  // Förkravet kontrolleras före ALLT annat som skriver; saknas 041 kastas det och inget är skrivet.
  const precondition = options.apply ? await assertReleasePublishedAllowed(supabase) : null;

  const groups = await readGroups(supabase);
  const existing = await readExistingKeys(supabase, groups.map((g) => activityKeys.releasePublished(g.id, release.version)));
  const plan = planAnnouncement(release, groups, existing, now.toISOString());

  let writtenKeys = new Set<string>();
  if (options.apply && plan.drafts.length > 0) {
    await recordActivities(plan.drafts); // sväljer fel som live-vägen — verifieras nedan
    writtenKeys = await readExistingKeys(supabase, plan.drafts.map((d) => d.dedupe_key));
  }

  const rows = groups.map((g) => {
    const key = activityKeys.releasePublished(g.id, release.version);
    const alreadyAnnounced = existing.has(key);
    return {
      id: g.id, name: g.name, alreadyAnnounced, planned: !alreadyAnnounced,
      written: options.apply && !alreadyAnnounced ? writtenKeys.has(key) : null,
    };
  });
  const written = rows.filter((r) => r.written === true).length;

  return {
    options,
    target: supabaseHost(),
    release: { version: release.version, title: release.title },
    groups: rows,
    totals: { groups: groups.length, alreadyAnnounced: plan.alreadyAnnounced.length, planned: plan.pending.length, written },
    precondition,
    failed: options.apply ? plan.pending.length - written : 0,
  };
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

export function formatReport(report: AnnounceReleaseReport): string {
  const { options, totals, release } = report;
  const apply = options.apply;
  const lines = [
    `release announcement — ${apply ? 'APPLY' : 'DRY-RUN (nothing is written)'}`,
    `target database: ${report.target}`,
    `release: v${release.version} — ${release.title}`,
    `scope: ${totals.groups} group(s), one release_published row each`,
  ];
  if (report.precondition) lines.push(`migration 041: ${report.precondition}`);
  lines.push('');

  for (const g of report.groups) {
    const status = g.alreadyAnnounced
      ? 'already announced (left untouched)'
      : apply
        ? g.written ? 'written' : 'FAILED (not found after the write)'
        : 'would be written';
    lines.push(`  ${g.name || '(unnamed)'} [${g.id}]  ${status}`);
  }

  lines.push('');
  if (totals.groups === 0) {
    lines.push('No groups found — nothing to write.');
  } else if (apply) {
    lines.push(totals.planned === 0
      ? `Nothing to write — all ${totals.alreadyAnnounced} group(s) already have v${release.version} announced.`
      : `Wrote ${totals.written} of ${totals.planned} release_published row(s); ${totals.alreadyAnnounced} already announced group(s) left untouched.` +
        (report.failed > 0 ? ` ${report.failed} write(s) failed — re-run to retry.` : ''));
  } else {
    lines.push(totals.planned === 0
      ? `Nothing to write — all ${totals.alreadyAnnounced} group(s) already have v${release.version} announced.`
      : `${totals.planned} release_published row(s) would be written (${totals.alreadyAnnounced} already announced, left untouched). ` +
        'Re-run with --apply to write them (requires migration 041).');
  }
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await import('dotenv/config'); // först här: att importera modulen (tester) ska inte läsa .env
  const options = parseArgs(process.argv.slice(2));
  // Målet skrivs ut FÖRE körningen också, så ägaren ser vilken databas som berörs innan något skrivs.
  console.log(`Target database: ${supabaseHost()} (${options.apply ? 'APPLY' : 'dry-run'})`);
  const report = await runAnnounceRelease(options, readChangelogReleases());
  console.log(formatReport(report));
  if (report.failed > 0) process.exitCode = 1;
}

// Kör bara som skript, inte när testerna importerar modulen.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('❌ Release announcement failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
