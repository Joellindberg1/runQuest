/**
 * stagingSchemaDiff.ts — compares the schema of prod and staging and prints the difference readably. Read-only on both sides.
 * Compared: relations (kind, owner, options, row level security), columns, constraints, indexes, triggers, policies, table and column grants,
 * functions (owner and the whole definition, normalised for line endings and blank lines), function grants (the default PUBLIC execute made
 * explicit), views and enums. What is NOT compared is printed with every diff (schemaFingerprint.ts, NOT_COMPARED). Known, explained
 * differences are listed as "known" (KNOWN_DIFFERENCES).
 *
 * Both projects are read as the same role (supabase_read_only_user, through the management API's read-only query endpoint), so that the
 * text of definitions does not differ because two sessions have different search paths. Prod is read with a fixed list of statements only.
 *
 * Run:  npm run staging:schema-diff --workspace=@runquest/backend -- [--read-prod]
 *   (no flag)    prints the plan, no request.
 *   --read-prod  reads prod and staging and prints the diff.
 * Needs RUNQUEST_PROD_READ_TOKEN (prod read) and SUPABASE_STAGING_ACCESS_TOKEN (staging read) in the shell.
 * Exit code 0 = no unexplained difference (or only the plan was printed); 1 = at least one, or the run could not complete.
 */
import {
  FINGERPRINT_CATEGORIES,
  FINGERPRINT_QUERIES,
  NOT_COMPARED,
  buildFingerprint,
  diffFingerprints,
  formatDiff,
  hasUnexplainedDifferences,
  type FingerprintCategory,
  type SchemaDiff,
} from './schemaFingerprint.js';
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

export const ALLOWED_PROD_QUERIES: ReadonlySet<string> = new Set(Object.values(FINGERPRINT_QUERIES));

export interface SchemaDiffOptions {
  readProd: boolean;
}

export function parseArgs(argv: string[]): SchemaDiffOptions {
  const usage = 'Usage: staging:schema-diff [--read-prod] (it never writes)';
  let readProd = false;
  for (const arg of argv) {
    if (arg === '--read-prod') readProd = true;
    else throw new Error(`Unknown argument (not echoed, it could be a secret typed in the wrong place). ${usage}`);
  }
  return { readProd };
}

export type SchemaDiffOutcome = 'plan_only' | 'same' | 'differs' | 'missing_env' | 'refused' | 'failed';

export interface SchemaDiffReport {
  outcome: SchemaDiffOutcome;
  diff?: SchemaDiff;
  lines: string[];
}

export interface RunSchemaDiffInput {
  readProd: boolean;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  log: (line: string) => void;
}

export function exitCodeFor(report: Pick<SchemaDiffReport, 'outcome'>): 0 | 1 {
  return report.outcome === 'same' || report.outcome === 'plan_only' ? 0 : 1;
}

async function readAll(run: (sql: string) => Promise<Row[]>): Promise<Record<FingerprintCategory, Row[]>> {
  const out = {} as Record<FingerprintCategory, Row[]>;
  for (const category of FINGERPRINT_CATEGORIES) out[category] = await run(FINGERPRINT_QUERIES[category]);
  return out;
}

export async function runSchemaDiff({ readProd, env, fetchImpl, log }: RunSchemaDiffInput): Promise<SchemaDiffReport> {
  const { say, lines } = createSay(log, [env[STAGING_TOKEN_ENV] ?? '', env[PROD_READ_TOKEN_ENV] ?? '']);
  say(`staging:schema-diff${readProd ? ' --read-prod' : ''} — read-only on both projects`);
  say(`Prod (read only, only with --read-prod): ${describeTarget(PROD_PROJECT_REF)}`);
  say(`Staging (read only): ${describeTarget(STAGING_PROJECT_REF)}`);
  say(`Plan: ${FINGERPRINT_CATEGORIES.length} catalog queries (${FINGERPRINT_CATEGORIES.join(', ')}) on each project, through the read-only endpoint.`);

  if (!readProd) {
    say(`Not compared: ${NOT_COMPARED.join('; ')}.`);
    say('No --read-prod: nothing was contacted. Re-run with --read-prod to read both projects and print the diff.');
    return { outcome: 'plan_only', lines };
  }

  let staging;
  let prod;
  try {
    staging = createStagingClient({ token: requireToken(env, STAGING_TOKEN_ENV), fetchImpl });
    prod = createProdReader({ token: requireToken(env, PROD_READ_TOKEN_ENV), fetchImpl, allowedQueries: ALLOWED_PROD_QUERIES });
  } catch (err) {
    if (err instanceof MissingEnvError) {
      say(err.message);
      return { outcome: 'missing_env', lines };
    }
    if (err instanceof StagingGuardError) {
      say(err.message);
      return { outcome: 'refused', lines };
    }
    throw err;
  }

  let diff: SchemaDiff;
  try {
    const prodRows = await readAll((sql) => prod.query(sql));
    const stagingRows = await readAll((sql) => staging.readOnlyQuery(sql));
    diff = diffFingerprints(buildFingerprint(prodRows), buildFingerprint(stagingRows));
  } catch (err) {
    say(`Could not read a schema (${err instanceof Error ? err.message : 'error'}): no comparison was made.`);
    return { outcome: 'failed', lines };
  }

  for (const line of formatDiff(diff)) say(line);
  return { outcome: hasUnexplainedDifferences(diff) ? 'differs' : 'same', diff, lines };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runSchemaDiff({ ...options, env: process.env, fetchImpl: fetch, log: (line) => console.log(line) });
  process.exitCode = exitCodeFor(report);
}

runIfEntry(import.meta.url, 'staging:schema-diff', main);
