/**
 * stravaWebhookSubscription.ts — view, create and delete the one Strava push subscription of the app (ADR 010 decisions 2 and 16).
 * There is one subscription per Strava app. Creating it makes Strava call GET on the callback url at once, so the backend with the
 * webhook route and STRAVA_WEBHOOK_VERIFY_TOKEN must already be live (decision 16 step 4), and every connection must already have an
 * athlete id (npm run backfill:strava-athlete). `delete` is the rollback (decision 16 step 6).
 *
 * Run:  npm run strava:webhook --workspace=@runquest/backend -- [view|create|delete] [--apply] [--id <subscription id>]
 *   view     (default) lists the subscription(s) Strava has for this app. Read-only.
 *   create   DRY-RUN unless --apply: prints the host, the callback url and the field names it would POST (secrets are never printed).
 *            Refuses when a subscription already exists, and when STRAVA_WEBHOOK_VERIFY_TOKEN is shorter than 32 characters.
 *            A dry-run asks Strava for the existing subscriptions (a read) so that it can tell you if --apply would be refused.
 *   delete   DRY-RUN unless --apply. Without --id the id comes from `view` (the subscription Strava lists); nothing listed = "nothing to
 *            delete", exit 0; several listed = refuses and asks for --id. With --id a dry-run makes no request at all.
 * Needs STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (and STRAVA_WEBHOOK_VERIFY_TOKEN for create) in the environment (.env or the shell).
 * --apply is the owner's yes (docs/permissions.md). The script never sets a Railway variable: on success it only tells the owner which one.
 * Every Strava call goes through stravaFetch. Secrets are never printed: every output line is scrubbed for their values.
 */
import { pathToFileURL } from 'node:url';
import { stravaFetch } from '../services/stravaClient.js';
import { STRAVA_WEBHOOK_CALLBACK_URL } from '../services/stravaWebhook/constants.js';
import { PUSH_SUBSCRIPTIONS_URL, errorName, listStravaSubscriptions, type StravaSubscriptionRow } from '../services/stravaWebhook/subscriptions.js';

// The constant lives in services/stravaWebhook/constants.ts (the nightly check needs it too); the script keeps exporting it.
export { STRAVA_WEBHOOK_CALLBACK_URL };
export type { StravaSubscriptionRow };
const MIN_VERIFY_TOKEN_LENGTH = 32;
/** A printed line is cut after scrubbing, never before: a cut before it could leave the first part of a secret behind. */
const MAX_LINE_LENGTH = 600;
const SUBSCRIPTION_ID_VARIABLE = 'STRAVA_WEBHOOK_SUBSCRIPTION_ID';

export type SubscriptionCommand = 'view' | 'create' | 'delete';

export interface SubscriptionOptions {
  command: SubscriptionCommand;
  apply: boolean;
  /** delete only: the subscription to delete (default: the one `view` lists). */
  id: number | undefined;
}

export type SubscriptionOutcome =
  | 'viewed'
  | 'would_create'
  | 'created'
  | 'would_delete'
  | 'deleted'
  | 'nothing_to_delete'
  | 'refused_exists'
  | 'refused_weak_token'
  | 'ambiguous'
  | 'missing_env'
  | 'failed';

export interface SubscriptionReport {
  command: SubscriptionCommand;
  apply: boolean;
  outcome: SubscriptionOutcome;
  /** What `view` (or the existence check of create/delete) found. */
  subscriptions: StravaSubscriptionRow[];
  /** create: the id Strava returned. delete: the id that was (or would be) deleted. */
  subscriptionId?: number;
  /** Every line that was printed, after scrubbing. */
  lines: string[];
}

export interface RunSubscriptionInput {
  command: SubscriptionCommand;
  apply: boolean;
  id?: number;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

const COMMANDS: SubscriptionCommand[] = ['view', 'create', 'delete'];

export function parseArgs(argv: string[]): SubscriptionOptions {
  const usage = 'Usage: [view|create|delete] [--apply] [--id <subscription id>]';
  let command: SubscriptionCommand | undefined;
  let apply = false;
  let id: number | undefined;
  const parseId = (raw: string | undefined): number => {
    const value = raw === undefined || !/^\d+$/.test(raw) ? NaN : Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--id needs a positive whole number. ${usage}`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--id') id = parseId(argv[++i]);
    else if (arg.startsWith('--id=')) id = parseId(arg.slice('--id='.length));
    else if ((COMMANDS as string[]).includes(arg)) {
      if (command !== undefined) throw new Error(`Give one command only. ${usage}`);
      command = arg as SubscriptionCommand;
    } else {
      throw new Error(`Unknown argument (not echoed, it could be a secret typed in the wrong place). ${usage}`);
    }
  }

  const resolved = command ?? 'view';
  if (apply && resolved === 'view') throw new Error(`--apply does not fit "view": it never writes. ${usage}`);
  if (id !== undefined && resolved !== 'delete') throw new Error(`--id only fits "delete". ${usage}`);
  return { command: resolved, apply, id };
}

/** Names of the environment variables the command needs and that are missing or empty. */
export function missingEnv(command: SubscriptionCommand, env: NodeJS.ProcessEnv): string[] {
  const needed = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', ...(command === 'create' ? ['STRAVA_WEBHOOK_VERIFY_TOKEN'] : [])];
  return needed.filter((name) => !env[name]);
}

/** 0 = nothing wrong (also a dry-run that would go through, and "nothing to delete"); 1 = refused, missing env or a failed call. */
export function exitCodeFor(report: Pick<SubscriptionReport, 'outcome'>): 0 | 1 {
  switch (report.outcome) {
    case 'viewed':
    case 'would_create':
    case 'created':
    case 'would_delete':
    case 'deleted':
    case 'nothing_to_delete':
      return 0;
    default:
      return 1;
  }
}

/** A short, safe description of a Strava error answer: its message and the field/code pairs, never the raw body. */
function describeFailure(status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? (body as { message?: unknown; errors?: unknown }) : {};
  const parts: string[] = [];
  if (typeof record.message === 'string') parts.push(record.message);
  if (Array.isArray(record.errors)) {
    const details = record.errors
      .map((e) => (e && typeof e === 'object' ? [(e as { field?: unknown }).field, (e as { code?: unknown }).code].filter((v) => typeof v === 'string').join(': ') : ''))
      .filter(Boolean);
    if (details.length > 0) parts.push(`(${details.join('; ')})`);
  }
  return `HTTP ${status}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`;
}

/** `unanswered`: the request got no answer (network error or timeout), so what Strava did with it is unknown. */
type Call = { ok: true; status: number; body: unknown } | { ok: false; reason: string; unanswered?: true };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function runSubscription({ command, apply, id, env, log }: RunSubscriptionInput): Promise<SubscriptionReport> {
  const lines: string[] = [];
  const report: SubscriptionReport = { command, apply, outcome: 'failed', subscriptions: [], lines };

  // Every line passes here: the values of the secrets are replaced, wherever they come from (an error message, an echoed answer).
  const secrets = [env.STRAVA_CLIENT_SECRET, env.STRAVA_WEBHOOK_VERIFY_TOKEN].filter((s): s is string => typeof s === 'string' && s.length >= 4);
  const scrub = (text: string) => secrets.reduce((acc, secret) => acc.split(secret).join('[hidden]'), text);
  const say = (line = '') => {
    const scrubbed = scrub(line);
    const clean = scrubbed.length > MAX_LINE_LENGTH ? `${scrubbed.slice(0, MAX_LINE_LENGTH)}…` : scrubbed;
    lines.push(clean);
    log(clean);
  };
  const finish = (outcome: SubscriptionOutcome, extra: Partial<SubscriptionReport> = {}): SubscriptionReport => {
    Object.assign(report, { outcome }, extra);
    return report;
  };

  const missing = missingEnv(command, env);
  if (missing.length > 0) {
    say(`${missing.join(' and ')} must be set (in .env or the shell): refusing to run, nothing was sent.`);
    return finish('missing_env');
  }
  const clientId = env.STRAVA_CLIENT_ID as string;
  const clientSecret = env.STRAVA_CLIENT_SECRET as string;
  const verifyToken = env.STRAVA_WEBHOOK_VERIFY_TOKEN as string;

  const credentialQuery = () => new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString();
  const send = async (url: string, init: RequestInit): Promise<Call> => {
    try {
      const response = await stravaFetch(url, init); // its central timeout covers headers and body
      const body = await readJson(response);
      return response.ok ? { ok: true, status: response.status, body } : { ok: false, reason: describeFailure(response.status, body) };
    } catch (err) {
      return { ok: false, unanswered: true, reason: `request failed: ${errorName(err)}` };
    }
  };

  /** GET /push_subscriptions: the subscriptions of this app. Fail-closed: an unreadable answer is a failure, never "none". */
  const listSubscriptions = () => listStravaSubscriptions({ clientId, clientSecret });

  const describeRow = (row: StravaSubscriptionRow) => {
    say(`  subscription ${row.id}: ${row.callback_url}${row.created_at ? ` (created ${row.created_at})` : ''}`);
    if (row.callback_url !== STRAVA_WEBHOOK_CALLBACK_URL) say(`    note: the callback url differs from the expected ${STRAVA_WEBHOOK_CALLBACK_URL}`);
  };

  say(`Strava webhook subscription: ${command}${command === 'view' ? '' : apply ? ' --apply' : ' — DRY-RUN (nothing is sent to Strava)'}`);
  say('Strava host: www.strava.com');

  if (command === 'view') {
    const listed = await listSubscriptions();
    if (!listed.ok) {
      say(`Could not list the subscriptions: ${listed.reason}`);
      return finish('failed');
    }
    if (listed.rows.length === 0) say('No subscription exists for this app.');
    else {
      say(`${listed.rows.length} subscription(s):`);
      listed.rows.forEach(describeRow);
    }
    return finish('viewed', { subscriptions: listed.rows });
  }

  if (command === 'create') {
    say(`Callback host: ${new URL(STRAVA_WEBHOOK_CALLBACK_URL).host}`);
    if (verifyToken.length < MIN_VERIFY_TOKEN_LENGTH) {
      say(`STRAVA_WEBHOOK_VERIFY_TOKEN is shorter than ${MIN_VERIFY_TOKEN_LENGTH} characters: refusing, a weak token is never used. Nothing was sent.`);
      return finish('refused_weak_token');
    }
    const listed = await listSubscriptions();
    if (!listed.ok) {
      say(`Could not check for an existing subscription (${listed.reason}): refusing to create a second one blindly.`);
      return finish('failed');
    }
    if (listed.rows.length > 0) {
      say('A subscription already exists, so create is refused (Strava allows one per app). Run delete first if it must be replaced:');
      listed.rows.forEach(describeRow);
      return finish('refused_exists', { subscriptions: listed.rows });
    }
    say(`${apply ? 'Sending' : 'Would send'}: POST ${PUSH_SUBSCRIPTIONS_URL}`);
    say(`  client_id=${clientId}`);
    say('  client_secret=<hidden, from STRAVA_CLIENT_SECRET>');
    say(`  callback_url=${STRAVA_WEBHOOK_CALLBACK_URL}`);
    say('  verify_token=<hidden, from STRAVA_WEBHOOK_VERIFY_TOKEN>');
    if (!apply) {
      say('Strava answers by calling GET on the callback url, so the backend with the webhook route and the verify token must be live first.');
      say('Re-run with --apply to send it (the owner\'s yes).');
      return finish('would_create');
    }
    const created = await send(PUSH_SUBSCRIPTIONS_URL, {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, callback_url: STRAVA_WEBHOOK_CALLBACK_URL, verify_token: verifyToken }),
    });
    if (!created.ok) {
      if (created.unanswered) {
        say(`The request got no answer from Strava: ${created.reason}`);
        say('It is unknown whether the subscription was created: check with view before running create again.');
      } else {
        say(`Strava refused the subscription: ${created.reason}`);
        say('Nothing was created. If the reason is the callback, check that GET on the callback url answers the challenge (verify token set in Railway, backend deployed).');
      }
      return finish('failed');
    }
    const newId = (created.body as { id?: unknown } | undefined)?.id;
    if (typeof newId !== 'number' || !Number.isSafeInteger(newId) || newId <= 0) {
      say(`Strava answered HTTP ${created.status} without a usable subscription id. Run view to see whether the subscription was created.`);
      return finish('failed');
    }
    say(`Subscription created. Strava returned id ${newId}.`);
    say(`Put ${SUBSCRIPTION_ID_VARIABLE}=${newId} in Railway (the owner does this; the script sets nothing).`);
    return finish('created', { subscriptionId: newId });
  }

  // delete
  let targetId = id;
  if (targetId === undefined) {
    const listed = await listSubscriptions();
    if (!listed.ok) {
      say(`Could not list the subscriptions to find the id: ${listed.reason}`);
      return finish('failed');
    }
    if (listed.rows.length === 0) {
      say('Nothing to delete: no subscription exists for this app.');
      return finish('nothing_to_delete');
    }
    if (listed.rows.length > 1) {
      say('Several subscriptions are listed, so the script will not pick one. Run delete again with --id <id> for the one to remove:');
      listed.rows.forEach(describeRow);
      return finish('ambiguous', { subscriptions: listed.rows });
    }
    targetId = listed.rows[0].id;
    report.subscriptions = listed.rows;
    say(`Found the id with view: ${targetId}`);
  }

  const deleteUrl = `${PUSH_SUBSCRIPTIONS_URL}/${targetId}`;
  say(`${apply ? 'Sending' : 'Would send'}: DELETE ${deleteUrl}`);
  say(`  client_id=${clientId}`);
  say('  client_secret=<hidden, from STRAVA_CLIENT_SECRET>');
  if (!apply) {
    say('Re-run with --apply to send it (the owner\'s yes). This stops new webhook events; polling carries the sync (ADR 010 decision 16 step 6).');
    return finish('would_delete', { subscriptionId: targetId });
  }
  const deleted = await send(`${deleteUrl}?${credentialQuery()}`, { method: 'DELETE' });
  if (!deleted.ok) {
    say(`Strava refused the delete: ${deleted.reason}`);
    return finish('failed', { subscriptionId: targetId });
  }
  say(`Subscription ${targetId} deleted. Remove ${SUBSCRIPTION_ID_VARIABLE} from Railway (the owner does this; the script sets nothing).`);
  return finish('deleted', { subscriptionId: targetId });
}

async function main() {
  await import('dotenv/config'); // only here: importing the module (tests) must not read .env
  const options = parseArgs(process.argv.slice(2));
  const report = await runSubscription({ ...options, env: process.env, log: (line) => console.log(line) });
  process.exitCode = exitCodeFor(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Strava webhook subscription failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
