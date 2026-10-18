/**
 * backfillStravaAthleteIds.ts — fills strava_tokens.strava_athlete_id for the connections made before the webhook work
 * (ADR 010 decision 4). A webhook event carries only the athlete id, so a connection without one can never receive an event
 * (and never a deletion). There is no lazy fill-in: the subscription must not be created until every connection has an id.
 *
 * Run:  npm run backfill:strava-athlete --workspace=@runquest/backend [-- --apply]
 *   (default)  DRY-RUN: one GET /athlete per connected user that has no id yet (stored token, renewed if it has expired),
 *              prints the target database host and per user whether an id could be fetched, and reports duplicates.
 *              Writes no athlete id. A token renewal is the one exception: Strava rotates the refresh token when it
 *              answers, so the shared token path (stravaClient) must save the new tokens, as it does on every sync.
 *   --apply    writes strava_athlete_id. Users whose token cannot be renewed are listed as "must reconnect". An id that
 *              already belongs to another user, or that two users in this run resolve to, is NOT written.
 * Idempotent: users that already have an id are skipped without a Strava call. sync_paused and the consent columns are never touched.
 * Runs against the database the environment points at: --apply against production needs the owner's yes (docs/permissions.md).
 * Tokens are never printed.
 */
import { pathToFileURL } from 'node:url';
import { getSupabaseClient } from '../config/database.js';
import { getValidAccessToken, stravaFetch } from '../services/stravaClient.js';
import { isValidAthleteId } from '../services/stravaAthlete.js';
import { supabaseHost } from './lib/supabaseHost.js';

type Client = ReturnType<typeof getSupabaseClient>;

const STRAVA_ATHLETE_URL = 'https://www.strava.com/api/v3/athlete';
const UNIQUE_VIOLATION = '23505';

export interface BackfillOptions {
  apply: boolean;
}

export interface BackfillReport {
  host: string;
  apply: boolean;
  /** Users that already had an id before the run. */
  alreadySet: string[];
  /** Dry-run: the ids that --apply would write. */
  wouldWrite: Array<{ userId: string; athleteId: number }>;
  /** --apply: the ids that were written. */
  written: Array<{ userId: string; athleteId: number }>;
  /** An athlete id claimed by more than one user (in the database or among this run's results). Never written. */
  duplicates: Array<{ athleteId: number; userIds: string[] }>;
  /** The stored token cannot be used and cannot be renewed: the user has to connect Strava again. */
  mustReconnect: Array<{ userId: string; reason: string }>;
  /** No id could be fetched or written for another reason. */
  failed: Array<{ userId: string; reason: string }>;
  /** Number of strava_tokens rows (connections) found. */
  connections: number;
  /** True when every connection has an id once the run is over, i.e. the subscription may be created. */
  complete: boolean;
}

export interface RunBackfillInput {
  db: Client;
  apply: boolean;
  /** Hostname of the target database (see supabaseHost). */
  host: string;
  log: (line: string) => void;
}

export function parseArgs(argv: string[]): BackfillOptions {
  const options: BackfillOptions = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument "${arg}". Usage: [--apply]`);
  }
  return options;
}

type Resolved = { kind: 'id'; athleteId: number } | { kind: 'reconnect'; reason: string } | { kind: 'failed'; reason: string };

/** One GET /athlete with the stored token. Never throws; says why when it could not get an id. */
async function resolveAthleteId(userId: string): Promise<Resolved & { refreshed?: boolean }> {
  const token = await getValidAccessToken(userId);
  if (!token.ok) {
    // Not a connection that needs to be made again: the row could not be read, and a rerun may well work.
    if (token.reason === 'token_read_failed') return { kind: 'failed', reason: 'the stored token could not be read (a database error)' };
    // Our fault (the key or the stored value, ADR 013), not a connection that needs to be made again: fix the key and rerun.
    if (token.reason === 'token_unreadable') return { kind: 'failed', reason: 'the stored token cannot be read (check TOKEN_ENCRYPTION_KEY; the log has the cause)' };
    const reason = {
      not_connected: 'no stored Strava connection',
      no_refresh_token: 'the token has expired and no refresh token is stored',
      // refresh_failed also covers a 5xx or a network error from Strava, not only a refused refresh token: a rerun may succeed.
      refresh_failed: 'the token has expired and Strava would not renew it',
      refresh_rejected: 'Strava rejected the refresh token',
    }[token.reason];
    return { kind: 'reconnect', reason };
  }

  let response: Response;
  try {
    response = await stravaFetch(STRAVA_ATHLETE_URL, { headers: { Authorization: `Bearer ${token.accessToken}` } });
  } catch (err) {
    return { kind: 'failed', reason: `GET /athlete failed: ${err instanceof Error ? err.message : 'network error'}` };
  }
  if (response.status === 401) return { kind: 'reconnect', reason: 'Strava rejected the token (HTTP 401)' };
  if (!response.ok) return { kind: 'failed', reason: `GET /athlete answered HTTP ${response.status}` };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'failed', reason: 'GET /athlete returned no valid athlete id' };
  }
  const athleteId = (body as { id?: unknown } | null)?.id;
  if (!isValidAthleteId(athleteId)) return { kind: 'failed', reason: 'GET /athlete returned no valid athlete id' };
  return { kind: 'id', athleteId, refreshed: token.refreshed };
}

async function loadConnections(db: Client): Promise<Array<{ user_id: string; strava_athlete_id: number | null }>> {
  const { data, error } = await db.from('strava_tokens').select('user_id, strava_athlete_id').order('user_id', { ascending: true });
  if (error) throw new Error(`Could not read strava_tokens: ${error.message}`);
  return data ?? [];
}

async function loadNames(db: Client, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const { data, error } = await db.from('users').select('id, name').in('id', userIds);
  if (error) throw new Error(`Could not read users: ${error.message}`);
  for (const row of data ?? []) names.set(row.id, row.name);
  return names;
}

export async function runBackfill({ db, apply, host, log }: RunBackfillInput): Promise<BackfillReport> {
  const report: BackfillReport = {
    host,
    apply,
    alreadySet: [],
    wouldWrite: [],
    written: [],
    duplicates: [],
    mustReconnect: [],
    failed: [],
    connections: 0,
    complete: false,
  };

  const connections = await loadConnections(db);
  const names = await loadNames(db, connections.map((c) => c.user_id));
  const who = (userId: string) => `${names.get(userId) ?? 'unknown user'} (${userId})`;

  log(`Strava athlete id backfill — ${apply ? 'APPLY' : 'DRY-RUN (no athlete id is written)'}`);
  log(`Target database: ${host}`);
  log(`Connections: ${connections.length}`);

  // Every id that is claimed, by whom. Seeded with the ids already in the database, then filled in by this run.
  const claims = new Map<number, string[]>();
  const claim = (athleteId: number, userId: string) => claims.set(athleteId, [...(claims.get(athleteId) ?? []), userId]);

  for (const connection of connections) {
    if (connection.strava_athlete_id != null) {
      report.alreadySet.push(connection.user_id);
      claim(connection.strava_athlete_id, connection.user_id);
    }
  }

  // Phase 1: ask Strava (one call per user without an id).
  const resolved: Array<{ userId: string; athleteId: number }> = [];
  for (const connection of connections) {
    if (connection.strava_athlete_id != null) {
      log(`  ${who(connection.user_id)}: already has athlete id ${connection.strava_athlete_id}, skipped`);
      continue;
    }
    const result = await resolveAthleteId(connection.user_id);
    if (result.kind === 'id') {
      log(`  ${who(connection.user_id)}: athlete id ${result.athleteId} fetched${result.refreshed ? ' (the token was renewed and saved)' : ''}`);
      resolved.push({ userId: connection.user_id, athleteId: result.athleteId });
      claim(result.athleteId, connection.user_id);
    } else if (result.kind === 'reconnect') {
      log(`  ${who(connection.user_id)}: must reconnect Strava (${result.reason})`);
      report.mustReconnect.push({ userId: connection.user_id, reason: result.reason });
    } else {
      log(`  ${who(connection.user_id)}: could not fetch the athlete id (${result.reason})`);
      report.failed.push({ userId: connection.user_id, reason: result.reason });
    }
  }

  // Phase 2: duplicates. A claimed id with more than one user is never written, for any of them.
  const isDuplicate = (athleteId: number) => (claims.get(athleteId)?.length ?? 0) > 1;
  for (const [athleteId, userIds] of claims) {
    if (userIds.length > 1) report.duplicates.push({ athleteId, userIds });
  }

  // Phase 3: write (or, in a dry-run, say what would be written).
  for (const { userId, athleteId } of resolved) {
    if (isDuplicate(athleteId)) continue;
    if (!apply) {
      report.wouldWrite.push({ userId, athleteId });
      continue;
    }
    // `is null` keeps a row that got an id since it was read; the unique index (migration 045) is the last line of defence.
    const { data, error } = await db
      .from('strava_tokens')
      .update({ strava_athlete_id: athleteId })
      .eq('user_id', userId)
      .is('strava_athlete_id', null)
      .select('user_id');
    if (error?.code === UNIQUE_VIOLATION) {
      report.duplicates.push({ athleteId, userIds: [userId] });
    } else if (error) {
      report.failed.push({ userId, reason: error.message });
    } else if (!data || data.length === 0) {
      report.failed.push({ userId, reason: 'the row changed while the script ran (id already set, or connection removed)' });
    } else {
      report.written.push({ userId, athleteId });
    }
  }

  // No connections at all is not "complete": it means the wrong database, or an empty one, and must not clear the way for a subscription.
  report.connections = connections.length;
  report.complete = connections.length > 0 && report.alreadySet.length + report.written.length === connections.length;

  log('');
  for (const { athleteId, userIds } of report.duplicates) {
    log(`DUPLICATE athlete id ${athleteId}: ${userIds.map(who).join(', ')} — not written`);
  }
  if (apply) {
    for (const { userId, athleteId } of report.written) log(`written: ${who(userId)} -> ${athleteId}`);
  } else {
    for (const { userId, athleteId } of report.wouldWrite) log(`would write: ${who(userId)} -> ${athleteId}`);
  }
  for (const { userId, reason } of report.failed) log(`failed: ${who(userId)} (${reason})`);
  for (const { userId } of report.mustReconnect) log(`must reconnect: ${who(userId)}`);

  const missing = connections.length - report.alreadySet.length - report.written.length;
  log(
    `Summary: ${report.alreadySet.length} already set, ${apply ? `${report.written.length} written` : `${report.wouldWrite.length} would be written`}, ` +
      `${report.duplicates.length} duplicate id(s), ${report.mustReconnect.length} must reconnect, ${report.failed.length} failed`,
  );
  if (connections.length === 0) log('No connections found: check that the target database is the right one.');
  if (!apply) log('Re-run with --apply to write (production needs the owner\'s yes).');
  // The gate is the LAST line, so it is what the owner reads last (ADR 010 decision 4: no subscription before every connection has an id).
  log(
    report.complete
      ? 'Every connection has an athlete id: the webhook subscription may be created.'
      : `${apply ? `${missing} connection(s) still without an athlete id` : 'No athlete id has been written yet'}: do NOT create the webhook subscription yet.`,
  );
  return report;
}

/** 0 = nothing to act on. A dry-run is 1 for a problem it found (not for something it merely would write); --apply is 1 until every connection has an id. */
export function exitCodeFor(report: BackfillReport, apply: boolean): 0 | 1 {
  if (report.connections === 0) return 1;
  if (apply) return report.complete ? 0 : 1;
  return report.duplicates.length > 0 || report.mustReconnect.length > 0 || report.failed.length > 0 ? 1 : 0;
}

/** Names of the Strava credentials that are missing. Without them every expired token would look like "must reconnect". */
export function missingStravaCredentials(env: NodeJS.ProcessEnv): string[] {
  return ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'].filter((name) => !env[name]);
}

async function main() {
  await import('dotenv/config'); // only here: importing the module (tests) must not read .env
  const options = parseArgs(process.argv.slice(2));
  const missing = missingStravaCredentials(process.env);
  if (missing.length > 0) {
    throw new Error(`${missing.join(' and ')} must be set: without them a token that has expired cannot be renewed and every such user would be reported as "must reconnect"`);
  }
  const report = await runBackfill({ db: getSupabaseClient(), apply: options.apply, host: supabaseHost(), log: (line) => console.log(line) });
  process.exitCode = exitCodeFor(report, options.apply);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Backfill failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
