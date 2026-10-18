/**
 * createGroup.ts — creates a group with its admin through the database function create_group_with_admin (ADR 012 decision 7, S12).
 * It is how the make-believe group for the multi-group tests is made in STAGING (owner decision F5): there is no endpoint for creating a group
 * yet (RUN-95), and a test group is never made in production.
 *
 * Run:  npm run create:group --workspace=@runquest/backend -- --owner-email=<address> | --owner-id=<uuid> [--name=<text>] [--invite-code=<CODE>] [--show-invite-code] [--apply]
 *   (default)  DRY-RUN: prints the target database host, reads the owner, says what would be created. Writes nothing.
 *   --apply    creates the group; the owner becomes its admin (create_group_with_admin also sets the pointer users.group_id, in one transaction).
 *
 * The owner must be an existing user WITHOUT an active membership (one active membership per user in v0.8.0). The script creates no account:
 * make the test account the usual way (docs/staging.md, section 5) and give the script its e-mail address or id.
 *
 * The target is decided from the connection URL the script will really use (SUPABASE_URL), never from a flag:
 *   - staging (aormctqrmguvncxrigwy):  dry-run and --apply allowed.
 *   - production (yrrqaxdngayakcivfrck): even a DRY-RUN is refused without --allow-prod, because it reads users and memberships there (a read in
 *     prod is an ask). --apply needs BOTH --allow-prod and --confirm-prod=<PROD_CONFIRMATION>. They are used only after the owner's explicit yes
 *     (docs/staging.md, "5. create:group"; the matching row in docs/permissions.md waits for the owner's OK); a test group never goes to production
 *     (F5). A URL that names the production ref anywhere counts as production.
 *   - anything else (another project, a local stack, a custom domain, a URL that cannot be read): a dry-run is allowed, --apply is refused,
 *     because it cannot be told apart from prod.
 * The environment comes from the shell (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), e.g. `railway run` against the staging service. No .env is
 * loaded, so a stray local file cannot choose the target. Run by Lead, never by CI or a builder (the entry point refuses under CI/VITEST).
 *
 * The invite code is a secret that gives access to the group: it is generated with crypto.randomBytes (or given), and is NOT printed unless
 * --show-invite-code is given. It is never logged and never sent to Sentry; the admin sees it in the app (GET /api/groups/my).
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { errorCode } from '../utils/errorCode.js';
import { MembershipError, createGroupWithAdmin, getActiveMembership } from '../utils/membership.js';
import { todayStockholm } from '../utils/dateUtils.js';
import { supabaseHost } from './lib/supabaseHost.js';
import { PROD_PROJECT_REF, STAGING_PROJECT_REF, createSay, runIfEntry } from './staging/stagingTarget.js';

/** What --confirm-prod must be, letter for letter. Typed by Lead only after the owner's yes. */
export const PROD_CONFIRMATION = `I-HAVE-THE-OWNERS-YES-FOR-${PROD_PROJECT_REF}`;
export const DEFAULT_GROUP_NAME = 'Staging Second Pack';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** groups/join upper-cases what the user types, so a code with lower case in the database could never be matched. */
const INVITE_CODE = /^[A-Z0-9]{6,32}$/;
const MAX_NAME_LENGTH = 60;

export interface CreateGroupOptions {
  apply: boolean;
  name: string;
  inviteCode?: string;
  showInviteCode: boolean;
  ownerId?: string;
  ownerEmail?: string;
  allowProd: boolean;
  confirmProd?: string;
}

export function parseArgs(argv: string[]): CreateGroupOptions {
  const usage = 'Usage: create:group --owner-email=<address> | --owner-id=<uuid> [--name=<text>] [--invite-code=<CODE>] [--show-invite-code] [--apply]';
  const options: CreateGroupOptions = { apply: false, name: DEFAULT_GROUP_NAME, showInviteCode: false, allowProd: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--show-invite-code') options.showInviteCode = true;
    else if (arg === '--allow-prod') options.allowProd = true;
    else if (arg.startsWith('--confirm-prod=')) options.confirmProd = arg.slice('--confirm-prod='.length);
    else if (arg.startsWith('--owner-id=')) options.ownerId = arg.slice('--owner-id='.length).trim();
    else if (arg.startsWith('--owner-email=')) options.ownerEmail = arg.slice('--owner-email='.length).trim().toLowerCase();
    else if (arg.startsWith('--name=')) options.name = arg.slice('--name='.length).trim();
    else if (arg.startsWith('--invite-code=')) options.inviteCode = arg.slice('--invite-code='.length);
    // Not echoed: an unknown argument could be a secret typed in the wrong place.
    else throw new Error(`Unknown argument. ${usage}`);
  }
  if ((options.ownerId ? 1 : 0) + (options.ownerEmail ? 1 : 0) !== 1) throw new Error(`Give exactly one of --owner-id and --owner-email. ${usage}`);
  if (options.ownerId !== undefined && !UUID.test(options.ownerId)) throw new Error('--owner-id must be a uuid.');
  if (options.name === '' || options.name.length > MAX_NAME_LENGTH) throw new Error(`--name must be 1 to ${MAX_NAME_LENGTH} characters.`);
  if (options.inviteCode !== undefined && !INVITE_CODE.test(options.inviteCode)) {
    throw new Error('The invite code must be 6 to 32 upper-case letters or digits (a join upper-cases what is typed).');
  }
  return options;
}

export type TargetKind = 'staging' | 'prod' | 'unknown';
export interface Target {
  kind: TargetKind;
  host: string;
}

/** Which project the connection URL points at. Fail-closed: production wins on any mention of its ref, staging needs an exact https host. */
export function classifyTarget(url: string | undefined): Target {
  const raw = (url ?? '').trim();
  const host = supabaseHost(raw);
  if (raw.toLowerCase().includes(PROD_PROJECT_REF)) return { kind: 'prod', host };
  try {
    const parsed = new URL(raw);
    const exact = parsed.protocol === 'https:' && parsed.hostname === `${STAGING_PROJECT_REF}.supabase.co` && !parsed.username && !parsed.password && !parsed.port;
    if (exact) return { kind: 'staging', host };
  } catch {
    // not a URL: unknown
  }
  return { kind: 'unknown', host };
}

export type CreateGroupOutcome =
  | 'dry_run'
  | 'created'
  | 'refused_prod'
  | 'refused_target'
  | 'missing_env'
  | 'owner_not_found'
  | 'owner_ambiguous'
  | 'owner_has_membership'
  | 'invite_code_taken'
  | 'failed';

export type RunDecision = { ok: true } | { ok: false; outcome: 'refused_prod' | 'refused_target'; message: string };

/**
 * Whether this run may touch the target at all. Decided before any database client exists.
 * Staging: allowed. Production: a dry-run needs --allow-prod (it reads users and memberships, which in prod is an ask), --apply needs the flag and
 * the exact confirmation string. Another project: a dry-run only. Production flags on staging are refused, in a dry-run too.
 */
export function decideRun(target: Target, options: Pick<CreateGroupOptions, 'apply' | 'allowProd' | 'confirmProd'>): RunDecision {
  const prodFlags = options.allowProd || options.confirmProd !== undefined;
  if (target.kind === 'staging') {
    return prodFlags
      ? { ok: false, outcome: 'refused_target', message: 'Refusing: --allow-prod / --confirm-prod were given but the target is staging. Check SUPABASE_URL: the flags are for production only.' }
      : { ok: true };
  }
  if (target.kind === 'prod') {
    const allowed = options.apply ? options.allowProd && options.confirmProd === PROD_CONFIRMATION : options.allowProd;
    return allowed
      ? { ok: true }
      : {
          ok: false,
          outcome: 'refused_prod',
          message: `Refusing: the target is the PRODUCTION project. Even a dry-run reads users and memberships there, and a test group is never created in production (owner decision F5). Needs the owner's explicit yes, then --allow-prod${options.apply ? ' and --confirm-prod=<the confirmation string in docs/staging.md>' : ''}.`,
        };
  }
  return options.apply
    ? { ok: false, outcome: 'refused_target', message: 'Refusing: SUPABASE_URL is neither the staging nor the production project, so --apply cannot be allowed (it could be production under another name).' }
    : { ok: true };
}

/** A fresh upper-case code from crypto.randomBytes: 10 hex digits is 40 bits, enough for a code that is checked against a unique index. */
export function generateInviteCode(): string {
  return `STG${randomBytes(5).toString('hex').toUpperCase()}`;
}

export interface CreateGroupReport {
  outcome: CreateGroupOutcome;
  apply: boolean;
  target: Target;
  lines: string[];
  groupId?: string;
  /** Only set when --show-invite-code was given. */
  inviteCode?: string;
}

export interface RunCreateGroupInput {
  options: CreateGroupOptions;
  env: NodeJS.ProcessEnv;
  /** Builds the client from the URL that was classified. Injected so that the tests never open a connection. */
  createDb: (url: string, serviceRoleKey: string) => SupabaseClient;
  log: (line: string) => void;
  today?: string;
  generateCode?: () => string;
}

export function exitCodeFor(report: Pick<CreateGroupReport, 'outcome'>): 0 | 1 {
  return report.outcome === 'dry_run' || report.outcome === 'created' ? 0 : 1;
}

const TARGET_LABEL: Record<TargetKind, string> = { staging: 'STAGING project', prod: 'PRODUCTION project', unknown: 'unknown project' };

export async function runCreateGroup(input: RunCreateGroupInput): Promise<CreateGroupReport> {
  const { options, env, createDb } = input;
  const url = env.SUPABASE_URL?.trim() ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const target = classifyTarget(url);
  // The code is chosen before anything is printed so that it, and the key, can be scrubbed from every line.
  const inviteCode = options.inviteCode ?? (options.apply ? (input.generateCode ?? generateInviteCode)() : '');
  const { say, lines } = createSay(input.log, [key, inviteCode]);
  const report: CreateGroupReport = { outcome: 'failed', apply: options.apply, target, lines };
  const finish = (outcome: CreateGroupOutcome): CreateGroupReport => ({ ...report, outcome });

  say(`create:group${options.apply ? ' --apply' : ' — DRY-RUN (nothing is written)'}`);
  say(`Target database: ${target.host} (${TARGET_LABEL[target.kind]})`);

  const missing = [url ? '' : 'SUPABASE_URL', key ? '' : 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length > 0) {
    say(`${missing.join(' and ')} must be set in the shell: nothing was read or written.`);
    return finish('missing_env');
  }
  const decision = decideRun(target, options);
  if (!decision.ok) {
    say(decision.message);
    return finish(decision.outcome);
  }

  const db = createDb(url, key);

  const owner = await findOwner(db, options);
  if (owner.kind === 'failed') {
    say(`Could not read the owner (database code ${owner.code}): nothing was written.`);
    return finish('failed');
  }
  if (owner.kind === 'none') {
    say('No user matches the owner you gave: nothing was written. The account has to exist first (docs/staging.md).');
    return finish('owner_not_found');
  }
  if (owner.kind === 'many') {
    say('More than one user matches the owner you gave: use --owner-id.');
    return finish('owner_ambiguous');
  }
  const who = `${owner.name} (${owner.id})`;

  let active;
  try {
    active = await getActiveMembership(owner.id, db);
  } catch (err) {
    say(`Could not read the owner's membership (database code ${errorCode(err)}): nothing was written.`);
    return finish('failed');
  }
  if (active) {
    say(`${who} already has an active membership: a group's creator must be an account without one. Nothing was written.`);
    return finish('owner_has_membership');
  }

  say(`Group "${options.name}", admin and creator: ${who}`);
  if (!options.apply) {
    say(`Would create it. The invite code is ${options.inviteCode ? 'the one you gave' : 'generated at --apply'} and is not printed unless --show-invite-code is given. Re-run with --apply to create the group.`);
    return finish('dry_run');
  }

  try {
    const group = await createGroupWithAdmin({ name: options.name, inviteCode, ownerId: owner.id, today: input.today ?? todayStockholm() }, db);
    say(`Created the group "${group.name}" (${group.id}) with ${who} as admin.`);
    const done = { ...report, outcome: 'created' as const, groupId: group.id };
    if (options.showInviteCode) {
      // The one place the code is printed, on request, and straight to the log: it is not part of `lines`.
      input.log(`Invite code: ${inviteCode}`);
      return { ...done, inviteCode };
    }
    say('The invite code was not printed (--show-invite-code); the admin sees it in the app.');
    return done;
  } catch (err) {
    if (err instanceof MembershipError && err.kind !== 'unavailable') {
      // The database itself refused, and its transaction rolled back: nothing exists.
      say(`${err.message} (database code ${err.code}): nothing was created.`);
      if (err.kind === 'invite_code_taken') return finish('invite_code_taken');
      if (err.kind === 'already_member') return finish('owner_has_membership');
      if (err.kind === 'not_found') return finish('owner_not_found');
      return finish('failed');
    }
    // A broken connection or a timeout can come after the commit, so the outcome is not known: never say "nothing was created".
    say(`Creating failed (code ${errorCode(err)}). The outcome is unknown: the group may have been created before the answer was lost. Run a dry-run (without --apply): if the owner now has an active membership the group exists; do not run --apply again before that.`);
    return finish('failed');
  }
}

type OwnerLookup = { kind: 'one'; id: string; name: string } | { kind: 'none' } | { kind: 'many' } | { kind: 'failed'; code: string };

async function findOwner(db: SupabaseClient, options: Pick<CreateGroupOptions, 'ownerId' | 'ownerEmail'>): Promise<OwnerLookup> {
  const select = db.from('users').select('id, name');
  const { data, error } = await (options.ownerId ? select.eq('id', options.ownerId) : select.eq('email', options.ownerEmail ?? '')).limit(2);
  if (error) return { kind: 'failed', code: errorCode(error) };
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length > 1) return { kind: 'many' };
  return { kind: 'one', id: rows[0].id, name: rows[0].name };
}

export interface CliDeps {
  createDb: RunCreateGroupInput['createDb'];
  log: (line: string) => void;
}

/** The command line as a function: arguments and environment in, exit code out. Bad arguments are reported, not thrown, and never echoed. */
export async function runCli(argv: string[], env: NodeJS.ProcessEnv, deps: CliDeps): Promise<0 | 1> {
  let options: CreateGroupOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    deps.log(err instanceof Error ? err.message : 'Invalid arguments.');
    return 1;
  }
  return exitCodeFor(await runCreateGroup({ options, env, createDb: deps.createDb, log: deps.log }));
}

async function main() {
  process.exitCode = await runCli(process.argv.slice(2), process.env, {
    createDb: (url, key) => createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
    log: (line) => console.log(line),
  });
}

runIfEntry(import.meta.url, 'create:group', main);
