/**
 * stagingMigrate.ts — builds (or brings up to date) the STAGING database from the repo: 000_baseline.sql and every migration >= 032, in
 * filename order, through the Supabase management API (POST /v1/projects/{ref}/database/migrations). 001-031 are frozen history and are never
 * run against a new database (see the head of 000_baseline.sql, ADR 002). Migrations the project has already recorded are skipped, so the
 * script can be run again at any time.
 *
 * Run:  npm run staging:migrate --workspace=@runquest/backend -- [--apply]
 *   Without --apply it is a DRY-RUN: it reads the list of recorded migrations from staging and prints what it would apply. It writes nothing.
 * Needs SUPABASE_STAGING_ACCESS_TOKEN in the shell. The target is hard-coded to the staging project; the prod ref is refused (stagingTarget.ts).
 * Prod is never contacted.
 *
 * Refuses --apply when a pending migration is older than one staging already has (it would run out of order), and reports migrations that
 * staging has recorded but the repo does not have.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MissingEnvError,
  STAGING_PROJECT_REF,
  STAGING_TOKEN_ENV,
  StagingGuardError,
  createSay,
  createStagingClient,
  describeTarget,
  requireToken,
  runIfEntry,
  type FetchLike,
} from './stagingTarget.js';

/** 001-031 are frozen history; the baseline (000) replaces them (ADR 002). */
export const FIRST_MIGRATION_AFTER_BASELINE = 32;
/** The management API is rate limited; Lead's first build used this pause. */
export const PAUSE_BETWEEN_MIGRATIONS_MS = 1_500;

const MIGRATION_FILE = /^(\d{3})_.*\.sql$/;
export const DEFAULT_MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

export interface MigrationFile {
  /** The file name without .sql, which is also the name recorded in the project. */
  name: string;
  sql: string;
}

/**
 * The file names a new database is built from: the baseline plus every number >= 032, sorted. Throws on two files with the same number and on
 * a .sql file whose name does not follow NNN_name.sql (it would otherwise be skipped without a word).
 */
export function selectStagingMigrationFiles(fileNames: string[]): string[] {
  const stray = fileNames.filter((f) => f.endsWith('.sql') && !MIGRATION_FILE.test(f));
  if (stray.length > 0) throw new Error(`A .sql file in the migrations folder does not match NNN_name.sql: ${stray.join(', ')}. Fix the repo first.`);
  const picked = fileNames
    .filter((f) => MIGRATION_FILE.test(f))
    .filter((f) => {
      const n = Number(f.slice(0, 3));
      return n === 0 || n >= FIRST_MIGRATION_AFTER_BASELINE;
    })
    .sort();
  const seen = new Map<string, string>();
  for (const file of picked) {
    const number = file.slice(0, 3);
    const earlier = seen.get(number);
    if (earlier) throw new Error(`Two migration files share the number ${number}: ${earlier} and ${file}. Fix the repo first.`);
    seen.set(number, file);
  }
  return picked;
}

export function loadMigrationFiles(dir = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  return selectStagingMigrationFiles(readdirSync(dir)).map((file) => ({
    name: file.replace(/\.sql$/, ''),
    sql: readFileSync(join(dir, file), 'utf8'),
  }));
}

export interface MigrateOptions {
  apply: boolean;
}

export function parseArgs(argv: string[]): MigrateOptions {
  const usage = 'Usage: staging:migrate [--apply]';
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else throw new Error(`Unknown argument (not echoed, it could be a secret typed in the wrong place). ${usage}`);
  }
  return { apply };
}

export type MigrateOutcome = 'dry_run' | 'applied' | 'up_to_date' | 'missing_env' | 'refused' | 'refused_out_of_order' | 'failed';

export interface MigrateReport {
  outcome: MigrateOutcome;
  apply: boolean;
  /** Names that were (or, in a dry-run, would be) applied. */
  pending: string[];
  /** Names applied by this run. */
  applied: string[];
  /** Names skipped because staging has already recorded them. */
  skipped: string[];
  /** Names staging has recorded that the repo does not have (a migration applied by hand, or one removed from the repo). */
  recordedNotInRepo: string[];
  /** Pending names that are older than the newest migration staging has. */
  outOfOrder: string[];
  lines: string[];
}

export interface RunMigrateInput {
  apply: boolean;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  log: (line: string) => void;
  files: MigrationFile[];
  sleep?: (ms: number) => Promise<void>;
  pauseMs?: number;
}

export function exitCodeFor(report: Pick<MigrateReport, 'outcome'>): 0 | 1 {
  return report.outcome === 'dry_run' || report.outcome === 'applied' || report.outcome === 'up_to_date' ? 0 : 1;
}

export async function runMigrate(input: RunMigrateInput): Promise<MigrateReport> {
  const { apply, env, fetchImpl, files } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const pauseMs = input.pauseMs ?? PAUSE_BETWEEN_MIGRATIONS_MS;
  const { say, lines } = createSay(input.log, [env[STAGING_TOKEN_ENV] ?? '']);
  const report: MigrateReport = { outcome: 'failed', apply, pending: [], applied: [], skipped: [], recordedNotInRepo: [], outOfOrder: [], lines };
  const finish = (outcome: MigrateOutcome): MigrateReport => ({ ...report, outcome });

  say(`staging:migrate${apply ? ' --apply' : ' — DRY-RUN (nothing is written)'}`);
  say(`Target: ${describeTarget(STAGING_PROJECT_REF)}`);

  let client;
  try {
    client = createStagingClient({ token: requireToken(env, STAGING_TOKEN_ENV), fetchImpl });
  } catch (err) {
    if (err instanceof MissingEnvError) {
      say(err.message);
      return finish('missing_env');
    }
    if (err instanceof StagingGuardError) {
      say(err.message);
      return finish('refused');
    }
    throw err;
  }

  let recorded: Set<string>;
  try {
    recorded = new Set(await client.listMigrationNames());
  } catch (err) {
    say(`Could not read the recorded migrations (${err instanceof Error ? err.message : 'error'}): refusing to guess, nothing was applied.`);
    return finish('failed');
  }

  const pending = files.filter((f) => !recorded.has(f.name));
  const inRepo = new Set(files.map((f) => f.name));
  report.skipped = files.filter((f) => recorded.has(f.name)).map((f) => f.name);
  report.pending = pending.map((f) => f.name);
  report.recordedNotInRepo = [...recorded].filter((name) => !inRepo.has(name)).sort();
  for (const name of report.skipped) say(`skip (already recorded): ${name}`);
  for (const name of report.recordedNotInRepo) say(`warning: staging has recorded ${name}, which is not among the repo's migration files.`);

  const newestRecorded = [...recorded].sort().at(-1);
  report.outOfOrder = pending.filter((f) => newestRecorded !== undefined && f.name < newestRecorded).map((f) => f.name);
  for (const name of report.outOfOrder) say(`${apply ? 'REFUSED' : 'warning'}: ${name} is older than ${newestRecorded}, which staging already has: applying it would run out of order.`);
  if (apply && report.outOfOrder.length > 0) {
    say('Nothing was applied. Rebuild staging, or apply the old migration by hand after looking at what the newer ones changed.');
    return finish('refused_out_of_order');
  }

  if (pending.length === 0) {
    say(`Staging is up to date (${files.length} migration files, all recorded).`);
    return finish('up_to_date');
  }

  if (!apply) {
    for (const f of pending) say(`would apply: ${f.name}`);
    say(`${pending.length} migration(s) pending. Re-run with --apply to apply them to staging.`);
    return finish('dry_run');
  }

  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];
    try {
      await client.applyMigration(file.name, file.sql);
    } catch (err) {
      say(`FAILED ${file.name}: ${err instanceof Error ? err.message : 'error'}`);
      say('Stopped. Later migrations were not run; fix the cause and run the script again (recorded migrations are skipped).');
      return finish('failed');
    }
    report.applied.push(file.name);
    say(`applied: ${file.name}`);
    if (i < pending.length - 1) await sleep(pauseMs);
  }
  say(`Done: ${report.applied.length} applied, ${report.skipped.length} skipped.`);
  return finish('applied');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runMigrate({
    ...options,
    env: process.env,
    fetchImpl: fetch,
    log: (line) => console.log(line),
    files: loadMigrationFiles(),
  });
  process.exitCode = exitCodeFor(report);
}

runIfEntry(import.meta.url, 'staging:migrate', main);
