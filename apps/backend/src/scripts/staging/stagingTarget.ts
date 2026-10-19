/**
 * stagingTarget.ts — the safety rails shared by the four staging scripts (staging:migrate, staging:seed-reference,
 * staging:seed-group, staging:schema-diff).
 *
 * - The write target is hard-coded to the staging project. A client for any other ref, and above all the prod ref, cannot be built.
 * - Prod can only be READ, and in three layers:
 *     1. an exact allow-list: the prod reader sends only statements that are members of a fixed set the script built from its own constants
 *        (the reference SELECTs, the catalog fingerprint queries). Anything else is refused before a request is made. This is the
 *        layer that holds; the other two are extra.
 *     2. assertReadOnlySql, a lexical filter (one SELECT, no write keyword). A filter like this is not a parser and can be fooled by unusual
 *        quoting, which is why it is never the only layer.
 *     3. the read-only endpoint of the Supabase management API, POST /v1/projects/{ref}/database/query/read-only ("Run a sql query as
 *        supabase_read_only_user", Beta; source: the management API OpenAPI document, https://api.supabase.com/api/v1-json, read 2026-10-17).
 *        The prod reader has no other path, so the database itself refuses a write.
 * - Tokens come from the environment only (SUPABASE_STAGING_ACCESS_TOKEN for staging, RUNQUEST_PROD_READ_TOKEN for the prod read; never
 *   SUPABASE_ACCESS_TOKEN, which an editor or an MCP server may have in the same shell) and are scrubbed from every line a script prints and
 *   from every error message. The scripts never load .env.
 * - Prod is only contacted when the script is given --read-prod. The network is injected (`fetchImpl`), so the tests never leave the machine.
 */
import { realpathSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGING_PROJECT_REF = 'aormctqrmguvncxrigwy';
export const PROD_PROJECT_REF = 'yrrqaxdngayakcivfrck';
export const STAGING_TOKEN_ENV = 'SUPABASE_STAGING_ACCESS_TOKEN';
export const PROD_READ_TOKEN_ENV = 'RUNQUEST_PROD_READ_TOKEN';

const MANAGEMENT_API_HOST = 'api.supabase.com';
export const QUERY_PATH = '/database/query';
export const READ_ONLY_QUERY_PATH = '/database/query/read-only';
const REQUEST_TIMEOUT_MS = 120_000;
/** An error body is cut after scrubbing, never before: a cut before it could leave the first part of a secret behind. */
const MAX_ERROR_LENGTH = 500;
const MAX_LINE_LENGTH = 600;

export type Row = Record<string, unknown>;
export type FetchLike = typeof fetch;

export class StagingGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingGuardError';
  }
}

export class MissingEnvError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} must be set in the shell (never in a file the repo tracks): refusing to run, nothing was sent.`);
    this.name = 'MissingEnvError';
  }
}

const normalizeRef = (ref: string) => ref.trim().toLowerCase();

/** Throws unless `ref` is exactly the staging project. The prod ref gets its own, plainer message. */
export function assertStagingTarget(ref: string): void {
  const wanted = normalizeRef(ref);
  if (wanted === PROD_PROJECT_REF) throw new StagingGuardError('Refusing: the target is the PRODUCTION project. The staging scripts never write to prod.');
  if (wanted !== STAGING_PROJECT_REF) throw new StagingGuardError('Refusing: the target is not the staging project.');
}

/** The value of a required token variable. The error names the variable, never a value. */
export function requireToken(env: NodeJS.ProcessEnv, variable: string): string {
  const value = env[variable];
  if (typeof value !== 'string' || value.trim() === '') throw new MissingEnvError(variable);
  return value.trim();
}

/** Replaces every secret (4 characters or more) wherever it occurs. */
export function scrubSecrets(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 4).reduce((acc, secret) => acc.split(secret).join('[hidden]'), text);
}

/** A printer that scrubs every line, keeps what was printed, and cuts overlong lines after scrubbing. */
export function createSay(log: (line: string) => void, secrets: string[]) {
  const lines: string[] = [];
  const say = (line = '') => {
    const scrubbed = scrubSecrets(line, secrets);
    const clean = scrubbed.length > MAX_LINE_LENGTH ? `${scrubbed.slice(0, MAX_LINE_LENGTH)}…` : scrubbed;
    lines.push(clean);
    log(clean);
  };
  return { say, lines };
}

/** The host a script says it is talking to (the database host of the project, reached through the management API). */
export function describeTarget(ref: string): string {
  return `project ${ref} (db.${ref}.supabase.co, via ${MANAGEMENT_API_HOST})`;
}

const isIdentifierChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(ch);

/**
 * Strips comments, quoted strings and quoted identifiers so that a keyword in a literal is not mistaken for a keyword in the statement.
 * Two details that a first version got wrong: an E'…' string treats a backslash as an escape (E'\'' is one quote), and a `$` inside an
 * identifier (x$a$) does not start a dollar-quoted string.
 */
function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
    } else if (ch === "'" || ch === '"') {
      const backslashEscapes = ch === "'" && /[eE]$/.test(out) && !isIdentifierChar(out[out.length - 2]);
      i++;
      while (i < sql.length) {
        if (backslashEscapes && sql[i] === '\\') i += 2;
        else if (sql[i] === ch && sql[i + 1] === ch) i += 2;
        else if (sql[i] === ch) break;
        else i++;
      }
      i++;
      out += ch + ch;
    } else if (ch === '$' && !isIdentifierChar(out[out.length - 1])) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      const end = tag ? sql.indexOf(tag[0], i + tag[0].length) : -1;
      if (tag && end !== -1) {
        i = end + tag[0].length;
        out += "''";
      } else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const FORBIDDEN_IN_PROD_READ =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|into|vacuum|reindex|cluster|lock|listen|notify|set|reset|refresh|comment|merge|prepare|deallocate|discard|setval|nextval|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|dblink_exec)\b/i;

/**
 * An extra layer, not the guard: throws unless `sql` looks like a single plain SELECT (or WITH … SELECT) without a write or admin keyword.
 * It is lexical, so the allow-list (createProdReader) is what decides what prod is asked.
 */
export function assertReadOnlySql(sql: string): void {
  const stripped = stripLiteralsAndComments(sql).trim().replace(/;+\s*$/, '');
  if (stripped.includes(';')) throw new StagingGuardError('Refusing a prod read with more than one statement.');
  if (!/^(select|with)\b/i.test(stripped)) throw new StagingGuardError('Refusing a prod read that is not a SELECT.');
  if (FORBIDDEN_IN_PROD_READ.test(stripped)) throw new StagingGuardError('Refusing a prod read that contains a write or admin keyword.');
}

function createRawClient(ref: string, token: string, fetchImpl: FetchLike, extraSecrets: string[] = []) {
  const base = `https://${MANAGEMENT_API_HOST}/v1/projects/${ref}`;
  const request = async (path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(scrubSecrets(`request to ${MANAGEMENT_API_HOST} failed: ${err instanceof Error ? err.name : 'error'}`, [token, ...extraSecrets]));
    }
    const text = await response.text();
    if (!response.ok) {
      const clean = scrubSecrets(text, [token, ...extraSecrets]);
      throw new Error(`${MANAGEMENT_API_HOST} answered HTTP ${response.status}: ${clean.slice(0, MAX_ERROR_LENGTH)}`);
    }
    try {
      return text === '' ? [] : JSON.parse(text);
    } catch {
      throw new Error(`${MANAGEMENT_API_HOST} answered HTTP ${response.status} with a body that is not JSON.`);
    }
  };
  const query = async (path: string, sql: string): Promise<Row[]> => {
    const body = await request(path, { method: 'POST', body: { query: sql } });
    // Fail-closed: anything but a list of rows is an error, never "no rows".
    if (!Array.isArray(body)) throw new Error('The query answer was not a list of rows.');
    return body as Row[];
  };
  return { query, request };
}

export interface StagingClient {
  readonly ref: string;
  /** Runs any SQL in the staging project (the caller decides, behind --apply, whether it may be a write). */
  query(sql: string): Promise<Row[]>;
  /** One plain SELECT as the read-only role (the same role prod is read as, so that both sides print identically). */
  readOnlyQuery(sql: string): Promise<Row[]>;
  /** The names of the migrations the project has recorded. */
  listMigrationNames(): Promise<string[]>;
  applyMigration(name: string, sql: string): Promise<void>;
}

/** A client for the staging project. `projectRef` exists so the guard can be tested; any value but the staging ref throws. */
export function createStagingClient(input: { token: string; fetchImpl: FetchLike; projectRef?: string; extraSecrets?: string[] }): StagingClient {
  const ref = input.projectRef ?? STAGING_PROJECT_REF;
  assertStagingTarget(ref);
  const raw = createRawClient(ref, input.token, input.fetchImpl, input.extraSecrets);
  return {
    ref,
    query: (sql) => raw.query(QUERY_PATH, sql),
    async readOnlyQuery(sql) {
      assertReadOnlySql(sql);
      return raw.query(READ_ONLY_QUERY_PATH, sql);
    },
    async listMigrationNames() {
      const body = await raw.request('/database/migrations', { method: 'GET' });
      // Fail-closed: an unreadable answer must not look like "nothing applied yet", or every migration would be run again.
      if (!Array.isArray(body)) throw new Error('The migration list answer was not a list.');
      return body.map((m) => String((m as { name?: unknown }).name ?? ''));
    },
    async applyMigration(name, sql) {
      await raw.request('/database/migrations', { method: 'POST', body: { name, query: sql } });
    },
  };
}

export interface ProdReader {
  readonly ref: string;
  /** A statement that is a member of the allow-list. Anything else throws before a request is made. */
  query(sql: string): Promise<Row[]>;
}

/**
 * The only way the staging scripts touch prod: a reader with no write methods, no path but the read-only endpoint, and a fixed allow-list of
 * exact statements. `allowedQueries` must be built by the script from its own constants, never from input.
 */
export function createProdReader(input: { token: string; fetchImpl: FetchLike; allowedQueries: ReadonlySet<string> }): ProdReader {
  const raw = createRawClient(PROD_PROJECT_REF, input.token, input.fetchImpl);
  const allowed = new Set(input.allowedQueries);
  return {
    ref: PROD_PROJECT_REF,
    async query(sql) {
      if (!allowed.has(sql)) throw new StagingGuardError('Refusing a prod read that is not on the fixed list of statements this script may send.');
      assertReadOnlySql(sql);
      return raw.query(READ_ONLY_QUERY_PATH, sql);
    },
  };
}

// ── Entry point ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const samePath = (a: string, b: string): boolean => {
  const real = (p: string) => {
    try {
      return realpathSync(resolve(p));
    } catch {
      return resolve(p);
    }
  };
  const [x, y] = [real(a), real(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

export type EntryDecision = { action: 'run' } | { action: 'skip'; message?: string } | { action: 'refuse'; message: string };

/**
 * Whether `main` should run: only when this module is the script node was started with, and never under CI or a test runner (a script that
 * can write must not run by accident). When the module name matches but the paths do not, it says so instead of staying silent.
 */
export function entryDecision(input: { moduleUrl: string; argv1: string | undefined; env: NodeJS.ProcessEnv; name: string }): EntryDecision {
  const { moduleUrl, argv1, env, name } = input;
  if (!argv1) return { action: 'skip' };
  const modulePath = fileURLToPath(moduleUrl);
  if (!samePath(modulePath, argv1)) {
    const sameName = basename(argv1, extname(argv1)) === basename(modulePath, extname(modulePath));
    return sameName ? { action: 'skip', message: `${name}: main did not run, because the entry path does not match this module's path (entry ${argv1}).` } : { action: 'skip' };
  }
  if (env.CI || env.VITEST) return { action: 'refuse', message: `${name}: refusing to run under CI or a test runner (CI or VITEST is set).` };
  return { action: 'run' };
}

/** The tail of every staging script: runs `main` when the script is the entry point, with the checks above. */
export function runIfEntry(moduleUrl: string, name: string, main: () => Promise<void>): void {
  const decision = entryDecision({ moduleUrl, argv1: process.argv[1], env: process.env, name });
  if (decision.action === 'skip') {
    if (decision.message) console.error(decision.message);
    return;
  }
  if (decision.action === 'refuse') {
    console.error(decision.message);
    process.exitCode = 1;
    return;
  }
  main().catch((err) => {
    console.error(`${name} failed:`, err instanceof Error ? err.message : 'error');
    process.exit(1);
  });
}
