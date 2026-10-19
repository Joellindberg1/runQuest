/**
 * backfillStravaTokenEncryption.ts — moves the Strava tokens in strava_tokens to the active encryption key (ADR 013 decision 7).
 * Before it has run, rows hold legacy plaintext; after a key rotation they hold values under a retired key. Every row that is not on
 * the active key is encrypted again, one row at a time, and checked.
 *
 * Run (the owner or Lead, never an agent; the key comes from the service's environment, so it never passes through a chat):
 *   railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend [-- <flags>]
 *
 *   (no flag)        DRY-RUN. Reads every row, needs a valid key (stops otherwise), prints the target database host and the class of
 *                    every row, and proves in memory that each row that needs it can be encrypted and read back. Writes nothing and
 *                    calls nobody.
 *   --apply          Encrypts the rows. Per row: the new values are proved in memory, then written as a compare-and-swap on BOTH stored
 *                    strings the listing saw (a refresh that landed meanwhile is never overwritten; the row is left for the next run),
 *                    then read back and opened. Idempotent: a row on the active key is not written. A row that fails does not stop
 *                    the others. Ctrl-C finishes the row in hand and stops; run again to finish.
 *   --refresh-tokens With --apply: afterwards asks Strava for new tokens for every connection (one call each, through the same token
 *                    path and the same rate guard as the rest of the backend, ADR 013 Ö4) and saves them encrypted. The old plaintext in
 *                    older database backups is then dead at Strava. Without --apply it only says how many calls it would make.
 *   --decrypt        THE EMERGENCY EXIT, for backing out a release to code that cannot read `enc:` values. Dry-run unless --apply.
 *                    With --apply it needs the extra flag --confirm-write-plaintext, because it writes PLAINTEXT tokens to the database.
 *                    Same compare-and-swap and read-back; it only writes a token the reader accepts as plaintext. Cannot be combined
 *                    with --refresh-tokens. After it the database holds exactly what it held before the backfill: run --apply again.
 *
 * Tokens are only ever handled inside services/stravaTokenStore.ts (listTokenRows, rewriteTokenRow): this script gets forms, status
 * codes and counts, so it has nothing to print by accident. The report holds user ids, key ids, counts and error codes; never a token,
 * a stored value or key material. No copy of any value is written anywhere.
 * Runs against the database the environment points at: --apply, --refresh-tokens and --decrypt --apply against production need the
 * owner's yes (docs/permissions.md, ADR 013 decision 13).
 */
import { pathToFileURL } from 'node:url';
import { errorCode } from '../utils/errorCode.js';
import { flushSentry, initSentry } from '../observability/sentry.js';
import { refreshAccessToken } from '../services/stravaClient.js';
import { isOverSoftLimit, registerStravaRateBudget } from '../services/stravaRateBudget.js';
import {
  inspectTokenKeyConfig,
  listTokenRows,
  rewriteTokenRow,
  type ListedTokenRow,
  type StravaTokenColumn,
  type TokenColumnForm,
  type TokenKeyConfig,
  type TokenRewriteOutcome,
} from '../services/stravaTokenStore.js';
import { supabaseHost } from './lib/supabaseHost.js';
import { missingStravaCredentials } from './backfillStravaAthleteIds.js';

export interface BackfillOptions {
  /** Write. Without it nothing is written and Strava is not called. */
  apply: boolean;
  /** Ask Strava for new tokens for every connection (needs apply to do it). */
  refreshTokens: boolean;
  /** The emergency exit: write plaintext back. */
  decrypt: boolean;
  /** The extra confirmation `--decrypt --apply` requires. */
  confirmWritePlaintext: boolean;
}

/** A problem with how the script was started or configured: its message is ours, safe to print as it is. */
export class BackfillAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillAbort';
  }
}

const USAGE = 'Usage: [--apply] [--refresh-tokens] | --decrypt [--apply --confirm-write-plaintext]';

export function parseArgs(argv: string[]): BackfillOptions {
  const options: BackfillOptions = { apply: false, refreshTokens: false, decrypt: false, confirmWritePlaintext: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--refresh-tokens') options.refreshTokens = true;
    else if (arg === '--decrypt') options.decrypt = true;
    else if (arg === '--confirm-write-plaintext') options.confirmWritePlaintext = true;
    else throw new BackfillAbort(`Unknown argument "${arg}". ${USAGE}`);
  }
  assertCombination(options);
  return options;
}

/** The rules between the flags. Checked again by runBackfill, so a caller that skips parseArgs cannot skip them. */
function assertCombination(options: BackfillOptions): void {
  if (options.decrypt && options.refreshTokens) throw new BackfillAbort(`--decrypt cannot be combined with --refresh-tokens. ${USAGE}`);
  if (options.confirmWritePlaintext && !(options.decrypt && options.apply)) {
    throw new BackfillAbort(`--confirm-write-plaintext only goes with --decrypt --apply. ${USAGE}`);
  }
  if (options.decrypt && options.apply && !options.confirmWritePlaintext) {
    throw new BackfillAbort('--decrypt --apply writes PLAINTEXT tokens to the database and needs the extra flag --confirm-write-plaintext. Nothing was done.');
  }
}

/** Rows by class (a row is as bad as its worst column). */
export interface RowClassCounts {
  /** No token in either column. */
  empty: number;
  encryptedActive: number;
  /** Encrypted, but on a key id other than the active one (a retired key, or one the configuration does not hold). */
  encryptedOtherKid: number;
  plaintext: number;
  unrecognised: number;
}

export interface RowError {
  userId: string;
  /** A code from the store (`unrecognised`, `auth_failed`, `write_failed`, ...) or `unexpected_error`. Never a message. */
  code: string;
  column?: StravaTokenColumn;
}

export interface RefreshReport {
  /** Dry-run: how many calls to Strava's token endpoint --apply would make. */
  wouldAttempt: number;
  renewed: string[];
  /** The reason Strava or the token path gave (`refresh_rejected`, `refresh_failed`, `token_unreadable`, ...). Not `no_refresh_token`. */
  failed: Array<{ userId: string; code: string }>;
  failedByCode: Record<string, number>;
  /** The row holds no refresh token, so there is nothing to renew. Not a failure; kept apart from `failed`. */
  noRefreshToken: string[];
  /**
   * Strava may have replaced the refresh token without us holding the new one (the answer was lost or unusable, or the save failed): the
   * user may have to reconnect Strava. The run stops at the first such user.
   */
  mayHaveLost: string[];
  /** Left unasked because the run stopped early (after `mayHaveLost`, or after two renewals in a row that failed). */
  stoppedBeforeAsking: string[];
  /** Left unasked because the shared rate guard said the budget was used up. */
  skippedForRateLimit: string[];
  /** Rows with an error in the encryption step: Strava is not asked for them, so their old refresh token stays alive at Strava. */
  notAttempted: string[];
}

/** Two renewals in a row that fail say that Strava or the network is the problem, and every further call risks the same. */
const STOP_AFTER_CONSECUTIVE_FAILURES = 2;

export interface BackfillReport {
  host: string;
  apply: boolean;
  direction: 'encrypt' | 'decrypt';
  refreshTokens: boolean;
  activeKid: string;
  retiredKids: string[];
  rows: number;
  /** The rows by class when the run began. */
  before: RowClassCounts;
  /** The rows by class read again when the run ended (--apply only). */
  after: RowClassCounts | null;
  /** Dry-run: the rows --apply would rewrite. */
  wouldRewrite: string[];
  /** --apply: the rows written and verified. */
  rewritten: string[];
  nothingToDo: number;
  /** The row changed while the script ran and was left as it is: run again. */
  conflicts: string[];
  /** Written, but replaced by a newer save right after (a token refresh). Readable; not an error. */
  superseded: string[];
  errors: RowError[];
  errorsByCode: Record<string, number>;
  refresh: RefreshReport | null;
  /** Stopped by Ctrl-C before every row was handled. */
  interrupted: boolean;
}

/** What the shared Strava rate budget says (services/stravaRateBudget.ts). Injected so a test needs no clock. */
export interface RateGuard {
  isOverSoftLimit(): boolean;
}

export interface RunBackfillInput {
  options: BackfillOptions;
  /** Hostname of the target database (see supabaseHost). */
  host: string;
  log: (line: string) => void;
  /** Aborting it stops after the row in hand. */
  signal?: AbortSignal;
  rateGuard?: RateGuard;
}

function keyProblemMessage(config: Exclude<TokenKeyConfig, { ok: true }>): string {
  const base = `The token key is not usable (${config.problem}): nothing was read or written. Check TOKEN_ENCRYPTION_KEY and TOKEN_ENCRYPTION_KEYS_RETIRED in this environment (docs/runbook-token-key.md).`;
  if (config.problem !== 'kid_not_allowed') return base;
  return `${base} This environment accepts only key ids starting with "${config.requiredPrefix}"; refused: ${config.offendingKids.join(', ')}.`;
}

/** A database error as a code and, when it has one, an HTTP status (`42501`, `PGRST301, HTTP 401`, `unknown, HTTP 503`). Never its message. */
function describeDbError(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? `${errorCode(error)}, HTTP ${status}` : errorCode(error);
}

const labelOf = (form: TokenColumnForm): string => {
  switch (form.form) {
    case 'empty':
      return 'empty';
    case 'plaintext':
      return 'plaintext';
    case 'encrypted':
      return `encrypted:${form.kid}`;
    case 'unrecognised':
      return 'UNRECOGNISED';
  }
};

/** A row is as bad as its worst column: unrecognised, then plaintext, then encrypted on another key. */
function classOf(row: ListedTokenRow, activeKid: string): keyof RowClassCounts {
  const forms = [row.access, row.refresh].filter((form) => form.form !== 'empty');
  if (forms.length === 0) return 'empty';
  if (forms.some((form) => form.form === 'unrecognised')) return 'unrecognised';
  if (forms.some((form) => form.form === 'plaintext')) return 'plaintext';
  return forms.some((form) => form.form === 'encrypted' && form.kid !== activeKid) ? 'encryptedOtherKid' : 'encryptedActive';
}

function countClasses(rows: ListedTokenRow[], activeKid: string): RowClassCounts {
  const counts: RowClassCounts = { empty: 0, encryptedActive: 0, encryptedOtherKid: 0, plaintext: 0, unrecognised: 0 };
  for (const row of rows) counts[classOf(row, activeKid)] += 1;
  return counts;
}

const describeCounts = (counts: RowClassCounts): string =>
  `empty ${counts.empty}, encrypted on the active key ${counts.encryptedActive}, encrypted on another key ${counts.encryptedOtherKid}, ` +
  `legacy plaintext ${counts.plaintext}, unrecognised ${counts.unrecognised}`;

const tally = (counts: Record<string, number>, code: string): void => {
  counts[code] = (counts[code] ?? 0) + 1;
};

const describeTally = (counts: Record<string, number>): string => {
  const entries = Object.entries(counts);
  return entries.length === 0 ? 'none' : entries.map(([code, n]) => `${code} ${n}`).join(', ');
};

function outcomeText(outcome: TokenRewriteOutcome | { status: 'failed'; code: string; column?: StravaTokenColumn }, direction: 'encrypt' | 'decrypt'): string {
  switch (outcome.status) {
    case 'nothing_to_do':
      return 'nothing to do';
    case 'ready':
      return `would ${direction}`;
    case 'written':
      return `${direction}ed and verified`;
    case 'conflict':
      return 'CONFLICT: the row changed while the script ran, left as it is (run again)';
    case 'superseded':
      return 'written, then replaced by a newer save (a token refresh); not an error (run again to check)';
    case 'failed':
      return `FAILED: ${outcome.code}${outcome.column ? ` (${outcome.column})` : ''}`;
  }
}

export async function runBackfill({ options, host, log, signal, rateGuard = { isOverSoftLimit } }: RunBackfillInput): Promise<BackfillReport> {
  assertCombination(options);
  const direction = options.decrypt ? 'decrypt' : 'encrypt';
  const config = inspectTokenKeyConfig();
  if (!config.ok) throw new BackfillAbort(keyProblemMessage(config));
  const ring = config.ring;
  const retiredKids = ring.kids.filter((kid) => kid !== ring.activeKid);

  let rows: ListedTokenRow[];
  try {
    rows = await listTokenRows();
  } catch (error) {
    // Say what failed and how (a code, an HTTP status), never the database's message: it can carry row values.
    throw new BackfillAbort(`Could not read strava_tokens (${describeDbError(error)}): nothing was written. Check the connection and the service role key.`);
  }
  const before = countClasses(rows, ring.activeKid);

  const mode = options.decrypt
    ? options.apply
      ? 'DECRYPT APPLY — EMERGENCY EXIT: WRITES PLAINTEXT TOKENS to the database'
      : 'DECRYPT DRY-RUN (nothing is written)'
    : options.apply
      ? 'APPLY (moves every row to the active key)'
      : 'DRY-RUN (nothing is written, Strava is not called)';
  log(`Strava token encryption backfill — ${mode}`);
  log(`Target database: ${host}`);
  log(`Active key: ${ring.activeKid}; retired keys: ${retiredKids.length > 0 ? retiredKids.join(', ') : 'none'}`);
  log(`Rows: ${rows.length}`);
  log(`Before: ${describeCounts(before)}`);
  if (rows.length === 0) log('No token rows found: check that the target database is the right one.');

  const report: BackfillReport = {
    host,
    apply: options.apply,
    direction,
    refreshTokens: options.refreshTokens,
    activeKid: ring.activeKid,
    retiredKids,
    rows: rows.length,
    before,
    after: null,
    wouldRewrite: [],
    rewritten: [],
    nothingToDo: 0,
    conflicts: [],
    superseded: [],
    errors: [],
    errorsByCode: {},
    refresh: null,
    interrupted: false,
  };

  const fail = (userId: string, code: string, column?: StravaTokenColumn): void => {
    report.errors.push(column ? { userId, code, column } : { userId, code });
    tally(report.errorsByCode, code);
  };

  // Step 1: the rows, one at a time.
  for (const row of rows) {
    if (signal?.aborted) {
      report.interrupted = true;
      break;
    }
    let outcome: TokenRewriteOutcome | { status: 'failed'; code: string; column?: StravaTokenColumn };
    try {
      outcome = await rewriteTokenRow(row, direction, ring, { dryRun: !options.apply });
    } catch (error) {
      // A bug or an unexpected failure in one row must not stop the others; only its code or name is kept, never its message.
      outcome = { status: 'failed', code: `unexpected_error:${errorCode(error)}` };
    }
    switch (outcome.status) {
      case 'nothing_to_do':
        report.nothingToDo += 1;
        break;
      case 'ready':
        report.wouldRewrite.push(row.userId);
        break;
      case 'written':
        report.rewritten.push(row.userId);
        break;
      case 'conflict':
        report.conflicts.push(row.userId);
        break;
      case 'superseded':
        report.superseded.push(row.userId);
        break;
      case 'failed':
        fail(row.userId, outcome.code, outcome.column);
        break;
    }
    log(`  ${row.userId}: access_token ${labelOf(row.access)}, refresh_token ${labelOf(row.refresh)} -> ${outcomeText(outcome, direction)}`);
  }

  // Step 2 (--refresh-tokens): new tokens from Strava, through the shared token path and the shared rate guard.
  if (options.refreshTokens) {
    const withError = new Set(report.errors.map((error) => error.userId));
    const refresh: RefreshReport = {
      wouldAttempt: 0,
      renewed: [],
      failed: [],
      failedByCode: {},
      noRefreshToken: [],
      mayHaveLost: [],
      stoppedBeforeAsking: [],
      skippedForRateLimit: [],
      notAttempted: [...withError],
    };
    report.refresh = refresh;
    const candidates = rows.filter((row) => !withError.has(row.userId));
    if (!options.apply) {
      refresh.wouldAttempt = candidates.filter((row) => row.refresh.form !== 'empty').length;
      log(
        `--refresh-tokens: would ask Strava for new tokens for ${refresh.wouldAttempt} connection(s) (${refresh.wouldAttempt} call(s) to the token endpoint); ` +
          'nothing is asked in a dry-run.',
      );
    } else if (!report.interrupted) {
      let consecutiveFailures = 0;
      for (const [index, row] of candidates.entries()) {
        if (signal?.aborted) {
          report.interrupted = true;
          break;
        }
        if (rateGuard.isOverSoftLimit()) {
          refresh.skippedForRateLimit = candidates.slice(index).map((left) => left.userId);
          log(
            `Strava's rate budget is used up: ${refresh.skippedForRateLimit.length} connection(s) not renewed (${refresh.skippedForRateLimit.join(', ')}). ` +
              'Run again later with --apply --refresh-tokens.',
          );
          break;
        }
        const result = await refreshAccessToken(row.userId, { reason: 'The token backfill renews the tokens' });
        if (result.ok && result.refreshed) {
          refresh.renewed.push(row.userId);
          consecutiveFailures = 0;
          log(`  ${row.userId}: new tokens saved (encrypted)`);
          continue;
        }
        const code = result.ok ? 'not_renewed' : result.reason;
        if (code === 'no_refresh_token') {
          refresh.noRefreshToken.push(row.userId);
          log(`  ${row.userId}: nothing to renew (no refresh token is stored)`);
          continue;
        }
        refresh.failed.push({ userId: row.userId, code });
        tally(refresh.failedByCode, code);
        log(`  ${row.userId}: renewal failed (${code})`);
        consecutiveFailures = code === 'refresh_failed' ? consecutiveFailures + 1 : 0;

        const lost = !result.ok && result.reason === 'refresh_failed' && result.mayHaveRotated === true;
        if (lost) {
          refresh.mayHaveLost.push(row.userId);
          log(
            `  ${row.userId}: STRAVA MAY HAVE REPLACED THIS USER'S REFRESH TOKEN WITHOUT IT BEING SAVED. The user may have to reconnect Strava. ` +
              'Look in the log for "🚨 KRITISKT: kunde inte spara roterad Strava-token" (or a "Token refresh" error line) for this user.',
          );
        }
        if (lost || consecutiveFailures >= STOP_AFTER_CONSECUTIVE_FAILURES) {
          refresh.stoppedBeforeAsking = candidates.slice(index + 1).map((left) => left.userId);
          log(
            lost
              ? `Stopped: not asking Strava for the other ${refresh.stoppedBeforeAsking.length} connection(s), because the same cause (a failing save, a lost answer) would lose their tokens too.`
              : `Stopped after ${consecutiveFailures} failed renewals in a row: Strava or the network is the problem. ${refresh.stoppedBeforeAsking.length} connection(s) not asked.`,
          );
          break;
        }
      }
    }
  }

  // Step 3: look again, so the report says what the table holds now and not what the run believes it did.
  if (options.apply) {
    try {
      report.after = countClasses(await listTokenRows(), ring.activeKid);
    } catch (error) {
      fail('(all rows)', `recount_failed:${describeDbError(error)}`);
    }
  }

  printSummary(report, log);
  return report;
}

function printSummary(report: BackfillReport, log: (line: string) => void): void {
  const verb = report.direction;
  const done = report.apply ? `${report.rewritten.length} ${verb}ed and verified` : `${report.wouldRewrite.length} would be ${verb}ed`;
  log('');
  log(
    `Summary: ${done}, ${report.nothingToDo} nothing to do, ${report.conflicts.length} conflict(s), ` +
      `${report.superseded.length} replaced by a newer save, ${report.errors.length} error(s)`,
  );
  log(`Errors by code: ${describeTally(report.errorsByCode)}`);
  if (report.refresh && report.apply) {
    const refresh = report.refresh;
    log(`Renewed at Strava: ${refresh.renewed.length}`);
    log(`Renewal failures by reason: ${describeTally(refresh.failedByCode)}`);
    if (refresh.noRefreshToken.length > 0) log(`Nothing to renew (no refresh token stored; not a failure): ${refresh.noRefreshToken.join(', ')}`);
    if (refresh.mayHaveLost.length > 0) {
      log(`MAY HAVE LOST THEIR STRAVA CONNECTION (Strava may have replaced the token without it being saved; they must reconnect): ${refresh.mayHaveLost.join(', ')}`);
    }
    if (refresh.stoppedBeforeAsking.length > 0) log(`Not asked because the run stopped early: ${refresh.stoppedBeforeAsking.join(', ')}`);
  }
  if (report.refresh && report.refresh.notAttempted.length > 0) {
    log(
      `${report.apply ? 'Not renewed' : 'Would not be renewed'} because of an error in the row: ${report.refresh.notAttempted.join(', ')}. Their old refresh token stays alive at Strava; ` +
        'fix the row (or have the user reconnect) and run again with --apply --refresh-tokens.',
    );
  }
  if (report.after) log(`After: ${describeCounts(report.after)}`);
  log(`Plaintext rows left: ${(report.after ?? report.before).plaintext}`);
  if (report.interrupted) log('Interrupted: not every row was handled. Run again to finish (it is safe to repeat).');
  if (report.conflicts.length > 0) log('Conflicts are rows a token refresh changed while the script ran: run again.');

  const clean = exitCodeFor(report) === 0;
  if (!report.apply) {
    log(
      report.direction === 'decrypt'
        ? 'Re-run with --apply --confirm-write-plaintext to write PLAINTEXT tokens back (the emergency exit; production needs the owner\'s yes).'
        : 'Re-run with --apply to write (production needs the owner\'s yes).',
    );
  } else if (clean && report.direction === 'decrypt') {
    log('Done: no encrypted column is left. The tokens are PLAINTEXT again; run --apply when the release is back in place, to encrypt them.');
  } else if (clean) {
    log(`Done: every token row is encrypted under key ${report.activeKid}. Check the health block: plaintext_rows=0, unrecognised_rows=0, rows_on_other_kid=0.`);
  } else {
    log('Not done: look at the errors above and run again (it is safe to repeat).');
  }
}

/**
 * 0 = nothing to act on. A dry-run is 1 for a problem it found (an unreadable row), not for something it merely would write.
 * --apply is 1 until the table is clean: no error, no conflict, nothing left on plaintext, another key or of unknown shape
 * (for --decrypt: nothing left encrypted), and every renewal done.
 */
export function exitCodeFor(report: BackfillReport): 0 | 1 {
  if (report.rows === 0 || report.interrupted) return 1;
  if (report.errors.length > 0 || report.conflicts.length > 0) return 1;
  // A connection with no refresh token (`noRefreshToken`) has nothing to renew and is not a reason to fail. Everything else left undone is.
  if (report.refresh) {
    const { failed, mayHaveLost, stoppedBeforeAsking, skippedForRateLimit } = report.refresh;
    if (failed.length + mayHaveLost.length + stoppedBeforeAsking.length + skippedForRateLimit.length > 0) return 1;
  }
  const after = report.after;
  if (after) {
    if (after.unrecognised > 0 || after.encryptedOtherKid > 0) return 1;
    if (report.direction === 'encrypt' && after.plaintext > 0) return 1;
    if (report.direction === 'decrypt' && after.encryptedActive > 0) return 1;
  }
  return 0;
}

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  host: string;
  log: (line: string) => void;
  signal?: AbortSignal;
  /** Starts Sentry when SENTRY_DSN is set, so a `🚨 KRITISKT` line of the token path reaches Sentry as it does from the server. */
  initSentry: () => boolean;
  /** Sends what is queued before the process ends. */
  flushSentry: () => Promise<boolean>;
  registerRateBudget: () => void;
}

/** The whole run as the command line does it, returning the exit code. Sentry is flushed whatever happens. */
export async function runCli(argv: string[], deps: CliDeps): Promise<0 | 1> {
  const options = parseArgs(argv);
  if (options.apply && options.refreshTokens) {
    const missing = missingStravaCredentials(deps.env);
    if (missing.length > 0) throw new BackfillAbort(`${missing.join(' and ')} must be set: without them no token can be renewed`);
    deps.registerRateBudget(); // the shared budget hears every Strava answer of this run, a 429 included
  }
  deps.initSentry();
  try {
    const report = await runBackfill({ options, host: deps.host, log: deps.log, signal: deps.signal });
    return exitCodeFor(report);
  } finally {
    await deps.flushSentry();
  }
}

async function main() {
  await import('dotenv/config'); // only here: importing the module (tests) must not read .env
  const controller = new AbortController();
  // The first Ctrl-C finishes the row in hand (and a renewal in hand, with its save). A second one ends the process at once.
  process.once('SIGINT', () => {
    console.log('Interrupt received: finishing the row in hand, then stopping. Run again to finish. (A second Ctrl-C kills the process at once.)');
    controller.abort();
  });
  process.exitCode = await runCli(process.argv.slice(2), {
    env: process.env,
    host: supabaseHost(),
    log: (line) => console.log(line),
    signal: controller.signal,
    initSentry: () => initSentry(),
    flushSentry: () => flushSentry(),
    registerRateBudget: () => void registerStravaRateBudget(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Our own messages are safe to print; anything else (a database or library error can carry values) is reduced to its code.
    console.error('Backfill failed:', err instanceof BackfillAbort ? err.message : errorCode(err));
    process.exit(1);
  });
}
