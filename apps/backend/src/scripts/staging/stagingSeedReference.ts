/**
 * stagingSeedReference.ts — copies the game rules and configuration from prod into STAGING so that staging plays like prod.
 * Only the tables in REFERENCE_TABLES are read, and only with the SELECT lists below. No user, run, token, group or activity data is read.
 * Two tables are read through a SELECT that blanks what must not travel: titles (no holders, no current values) and admin_settings
 * (the password hash is replaced inside the SELECT, so the real hash never leaves prod).
 *
 * Prod is contacted ONLY with --read-prod, and then through the read-only endpoint with the fixed list of statements (stagingTarget.ts).
 * Without --read-prod the script prints its plan and makes no request at all.
 *
 * Re-runnable: every insert is `on conflict do nothing`, so a second run adds no duplicates. After --apply the script checks that every prod
 * key exists in staging and reports the ones that do not. The rows are never written to a file in the repo.
 *
 * Run:  npm run staging:seed-reference --workspace=@runquest/backend -- [--read-prod] [--apply]
 *   (no flag)            prints the plan, no request.
 *   --read-prod          DRY-RUN: READS prod (the tables above) and staging (row counts) and writes nothing.
 *   --read-prod --apply  writes to staging.   --apply alone is refused: the rows come from prod.
 * Needs RUNQUEST_PROD_READ_TOKEN (prod read) and SUPABASE_STAGING_ACCESS_TOKEN (staging write) in the shell.
 * When a table in this list gains a column in a migration, check that the SELECT still returns only configuration.
 */
import {
  MissingEnvError,
  PROD_PROJECT_REF,
  PROD_READ_TOKEN_ENV,
  STAGING_PROJECT_REF,
  STAGING_TOKEN_ENV,
  StagingGuardError,
  createProdReader,
  createSay,
  createStagingClient,
  describeTarget,
  requireToken,
  runIfEntry,
  type FetchLike,
  type Row,
} from './stagingTarget.js';

/** table -> SELECT list. The order is the insert order (foreign keys). `*` is only used for tables that hold nothing but rules. */
export const REFERENCE_TABLES: Readonly<Record<string, string>> = {
  challenge_durations: '*',
  challenge_metrics: '*',
  challenge_rewards: '*',
  event_templates: '*',
  event_pools: '*',
  event_pool_members: '*',
  level_challenge_rewards: '*',
  level_requirements: '*',
  streak_multipliers: '*',
  titles:
    // current_holder_id and current_value are not read at all (no holder data leaves prod); the insert names its columns, so staging
    // gives them their defaults (NULL and 0).
    'id,name,description,unlock_requirement,created_at,updated_at,metric_key,outdoor_only',
  admin_settings:
    "id,'staging-ej-anvand'::text as admin_password_hash,min_run_distance,base_xp,xp_per_km,bonus_5km,bonus_10km,bonus_15km,bonus_20km,created_at,updated_at,min_run_date",
};

export const REFERENCE_TABLE_NAMES = Object.keys(REFERENCE_TABLES);

/** The primary key columns, for the check after --apply. Every other table has a single `id`. */
export const REFERENCE_KEY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  event_pool_members: ['pool_id', 'template_id'],
  level_challenge_rewards: ['level'],
};
const keyColumnsOf = (table: string): readonly string[] => REFERENCE_KEY_COLUMNS[table] ?? ['id'];

/** The only statement ever sent to prod for a table. */
export function prodSelectFor(table: string): string {
  const columns = REFERENCE_TABLES[table];
  if (columns === undefined) throw new StagingGuardError(`Refusing: ${table} is not a reference table, so it is never read from prod.`);
  return `select ${columns} from public.${table}`;
}

/** The fixed list of statements the prod reader may send for this script. */
export const ALLOWED_PROD_QUERIES: ReadonlySet<string> = new Set(REFERENCE_TABLE_NAMES.map(prodSelectFor));

const escapeLiteral = (text: string) => text.replace(/'/g, "''");

/** The column names of the rows, in first-seen order. Names that are not plain identifiers are refused (they end up in SQL). */
export function columnsOf(rows: Row[]): string[] {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const bad = columns.filter((c) => !/^[a-z_][a-z0-9_]*$/.test(c));
  if (bad.length > 0) throw new StagingGuardError('Refusing a column name that is not a plain identifier.');
  return columns;
}

/**
 * The staging write: one transaction, one idempotent insert per table. The insert names its columns, so a column that staging has and the
 * rows do not (a newer migration) gets its default instead of NULL.
 */
export function buildSeedSql(seed: Readonly<Record<string, Row[]>>): string {
  let sql = 'begin;\n';
  for (const table of REFERENCE_TABLE_NAMES) {
    const rows = seed[table] ?? [];
    if (rows.length === 0) continue;
    const columns = columnsOf(rows).map((c) => `"${c}"`).join(', ');
    sql += `insert into public.${table} (${columns}) select ${columns} from json_populate_recordset(null::public.${table}, '${escapeLiteral(JSON.stringify(rows))}') on conflict do nothing;\n`;
  }
  return `${sql}commit;`;
}

function countsSql(): string {
  return REFERENCE_TABLE_NAMES.map((t) => `select '${t}' as t, count(*)::int as n from public.${t}`).join(' union all ');
}

const toCounts = (rows: Row[]): Record<string, number> => Object.fromEntries(rows.map((r) => [String(r.t), Number(r.n)]));

const keyOf = (table: string, row: Row): string => keyColumnsOf(table).map((c) => String(row[c])).join('|');

/** The prod keys that staging does not have, per table. A table where a key column is missing from the rows cannot be checked and is reported. */
export function findMissingKeys(prod: Readonly<Record<string, Row[]>>, staging: Readonly<Record<string, Row[]>>): Record<string, string[]> {
  const missing: Record<string, string[]> = {};
  for (const table of REFERENCE_TABLE_NAMES) {
    const columns = keyColumnsOf(table);
    const prodRows = prod[table] ?? [];
    if (prodRows.some((r) => columns.some((c) => !(c in r)))) {
      missing[table] = ['(key column missing, cannot be checked)'];
      continue;
    }
    const present = new Set((staging[table] ?? []).map((r) => keyOf(table, r)));
    const absent = prodRows.map((r) => keyOf(table, r)).filter((k) => !present.has(k));
    if (absent.length > 0) missing[table] = absent;
  }
  return missing;
}

export interface SeedReferenceOptions {
  apply: boolean;
  readProd: boolean;
}

export function parseArgs(argv: string[]): SeedReferenceOptions {
  const usage = 'Usage: staging:seed-reference [--read-prod] [--apply]';
  let apply = false;
  let readProd = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--read-prod') readProd = true;
    else throw new Error(`Unknown argument (not echoed, it could be a secret typed in the wrong place). ${usage}`);
  }
  return { apply, readProd };
}

export type SeedReferenceOutcome = 'plan_only' | 'dry_run' | 'seeded' | 'deviations' | 'missing_env' | 'refused' | 'failed';

export interface SeedReferenceReport {
  outcome: SeedReferenceOutcome;
  apply: boolean;
  readProd: boolean;
  /** Rows read from prod, per table. */
  read: Record<string, number>;
  /** Row counts in staging after the run (apply) or before it (dry-run). */
  stagingCounts: Record<string, number>;
  /** After --apply: prod keys that staging does not have. */
  missingInStaging: Record<string, string[]>;
  lines: string[];
}

export interface RunSeedReferenceInput {
  apply: boolean;
  readProd: boolean;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  log: (line: string) => void;
}

export function exitCodeFor(report: Pick<SeedReferenceReport, 'outcome'>): 0 | 1 {
  return report.outcome === 'plan_only' || report.outcome === 'dry_run' || report.outcome === 'seeded' ? 0 : 1;
}

export async function runSeedReference({ apply, readProd, env, fetchImpl, log }: RunSeedReferenceInput): Promise<SeedReferenceReport> {
  const { say, lines } = createSay(log, [env[STAGING_TOKEN_ENV] ?? '', env[PROD_READ_TOKEN_ENV] ?? '']);
  const report: SeedReferenceReport = { outcome: 'failed', apply, readProd, read: {}, stagingCounts: {}, missingInStaging: {}, lines };
  const finish = (outcome: SeedReferenceOutcome): SeedReferenceReport => ({ ...report, outcome });

  say(`staging:seed-reference${apply ? ' --apply' : ''}${readProd ? ' --read-prod' : ''}`);
  say(`Target (write): ${describeTarget(STAGING_PROJECT_REF)}`);
  say(`Source (read only, only with --read-prod): ${describeTarget(PROD_PROJECT_REF)}`);
  say(`Plan: read ${REFERENCE_TABLE_NAMES.length} tables from prod with one fixed SELECT each, through the read-only endpoint:`);
  for (const table of REFERENCE_TABLE_NAMES) say(`  ${prodSelectFor(table)}`);

  if (!readProd) {
    say('No --read-prod: nothing was contacted. Re-run with --read-prod for a dry-run that reads prod and staging (and --apply to write staging).');
    return finish(apply ? 'refused' : 'plan_only');
  }
  say(apply ? 'Writing to staging (--apply).' : 'DRY-RUN: prod and staging are read, nothing is written.');

  let staging;
  let prod;
  try {
    staging = createStagingClient({ token: requireToken(env, STAGING_TOKEN_ENV), fetchImpl });
    prod = createProdReader({ token: requireToken(env, PROD_READ_TOKEN_ENV), fetchImpl, allowedQueries: ALLOWED_PROD_QUERIES });
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

  const seed: Record<string, Row[]> = {};
  try {
    for (const table of REFERENCE_TABLE_NAMES) {
      seed[table] = await prod.query(prodSelectFor(table));
      report.read[table] = seed[table].length;
    }
    report.stagingCounts = toCounts(await staging.query(countsSql()));
  } catch (err) {
    say(`Reading failed (${err instanceof Error ? err.message : 'error'}): nothing was written.`);
    return finish('failed');
  }

  for (const table of REFERENCE_TABLE_NAMES) {
    say(`  ${table}: ${report.read[table]} row(s) in prod, ${report.stagingCounts[table] ?? 0} in staging`);
  }
  const empty = REFERENCE_TABLE_NAMES.filter((t) => report.read[t] === 0);
  if (empty.length > 0) {
    say(`Warning: prod returned no rows for ${empty.join(', ')}. The read-only role may be filtered by row level security; check before trusting this copy.`);
  }

  if (!apply) {
    say('Would insert the rows above into staging (on conflict do nothing, so existing rows are left alone). Re-run with --apply to write.');
    return finish('dry_run');
  }

  try {
    await staging.query(buildSeedSql(seed));
    report.stagingCounts = toCounts(await staging.query(countsSql()));
  } catch (err) {
    say(`Writing failed (${err instanceof Error ? err.message : 'error'}): the insert runs in one transaction, so staging was not partly seeded.`);
    return finish('failed');
  }

  // The insert is `on conflict do nothing`, so a row that was skipped is not an error by itself; a prod key that is not in staging is.
  try {
    const stagingRows: Record<string, Row[]> = {};
    for (const table of REFERENCE_TABLE_NAMES) {
      stagingRows[table] = await staging.query(`select ${keyColumnsOf(table).join(', ')} from public.${table}`);
    }
    report.missingInStaging = findMissingKeys(seed, stagingRows);
  } catch (err) {
    say(`The check after writing failed (${err instanceof Error ? err.message : 'error'}); run the dry-run to compare the counts.`);
    return finish('failed');
  }

  say(`Counts in staging now: ${REFERENCE_TABLE_NAMES.map((t) => `${t}=${report.stagingCounts[t] ?? 0}`).join(' ')}`);
  const deviating = Object.entries(report.missingInStaging);
  if (deviating.length > 0) {
    for (const [table, keys] of deviating) say(`Deviation: ${table} is missing ${keys.length} prod key(s) in staging: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? ', …' : ''}`);
    return finish('deviations');
  }
  say('Checked: every prod key exists in staging.');
  return finish('seeded');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runSeedReference({ ...options, env: process.env, fetchImpl: fetch, log: (line) => console.log(line) });
  process.exitCode = exitCodeFor(report);
}

runIfEntry(import.meta.url, 'staging:seed-reference', main);
