// Körlogiken: förberedelse (en inloggning per användare), belastning (virtuella användare i slutna slingor över en viktad blandning av
// scenarier), städning (DELETE av de egna rundorna). Allt nätverk går via den injicerade klienten, så logiken prövas mot en fejkserver.
import { SCENARIO_WEIGHTS } from './targets.mjs';
import { RUN_DISTANCE_KM, RUN_KEY_PREFIX, createScenarios, loginUser, newRunKey, todayStockholm } from './scenarios.mjs';
import { summarize } from './stats.mjs';

export { RUN_DISTANCE_KM, RUN_KEY_PREFIX };

/** Förberedelsen lyckades inte (en användare gick inte att logga in). Meddelandet nämner användarens ordningsnummer, aldrig uppgifterna. */
export class SetupFailed extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetupFailed';
  }
}

/** Rapporten som ska städas innehåller något lasttestet inte har skapat. Ingenting raderas. */
export class CleanupRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'CleanupRefused';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Väntar, men släpper så fort signalen avbryts, så att ett Ctrl-C inte väntar ut tänketiden. */
const sleep = (ms, signal) => new Promise((resolve) => {
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});

function pickWeighted(names, weights, random) {
  const total = names.reduce((sum, name) => sum + weights[name], 0);
  let point = random() * total;
  for (const name of names) {
    point -= weights[name];
    if (point < 0) return name;
  }
  return names[names.length - 1];
}

/** DELETE av rundorna, en i taget. 409 (en runda som kvalificerat ett event får inte raderas) räknas som kvar, inte som fel. */
export async function cleanupRuns({ client, users, createdRuns }) {
  const outcome = { deleted: 0, kept: 0, failed: 0, keptRuns: [], failedRuns: [] };
  for (const run of createdRuns) {
    const result = await client.request({ scenario: 'cleanup', method: 'DELETE', path: `/api/runs/${run.id}`, token: users[run.userIndex].token });
    if (result.outcome === 'ok' || result.status === 404) outcome.deleted++; // 404: redan borta
    else if (result.status === 409) { outcome.kept++; outcome.keptRuns.push(run); }
    else { outcome.failed++; outcome.failedRuns.push(run); }
  }
  return outcome;
}

/** Loggar in användarna som behövs för att städa rundor från en tidigare körning (en inloggning per användare). */
export async function loginForCleanup({ client, users, createdRuns }) {
  for (const index of new Set(createdRuns.map((run) => run.userIndex))) {
    const result = await loginUser(client, users[index]);
    if (!users[index].token) throw new SetupFailed(`Inloggningen för användare nr ${index + 1} misslyckades (status ${result.status ?? 'nätverksfel'})`);
  }
}

/**
 * Väljer ut rundorna i en rapportfil som ska städas och prövar varenda en: id är en uuid, nyckeln bär lasttestets prefix och
 * användarindexet pekar på en användare i listan. En enda ogiltig post vägrar hela rapporten; en rapportfil är indata från disk och
 * får aldrig kunna få skriptet att radera en runda som lasttestet inte skapat.
 * Tas med: rundor rapporten markerat som kvar eller misslyckade, samt alla skapade rundor om körningen lämnade dem orörda (skipped > 0).
 */
export function planCleanup(report, userCount) {
  const asList = (value) => (Array.isArray(value) ? value : value === undefined ? [] : null);
  const kept = asList(report?.cleanup?.keptRuns);
  const failed = asList(report?.cleanup?.failedRuns);
  const created = asList(report?.createdRuns);
  if (report === null || typeof report !== 'object' || kept === null || failed === null || created === null) {
    throw new CleanupRefused('Rapportfilen har inte det väntade formatet; ingenting raderades.');
  }
  const wanted = [...kept, ...failed, ...(report.cleanup?.skipped > 0 ? created : [])];
  const unique = new Map();
  wanted.forEach((run, position) => {
    const problem = (() => {
      if (typeof run?.id !== 'string' || !UUID.test(run.id)) return 'id är inte en uuid';
      if (typeof run?.key !== 'string' || !run.key.startsWith(`${RUN_KEY_PREFIX}-`)) return `nyckeln saknar lasttestets prefix ${RUN_KEY_PREFIX}`;
      if (!Number.isInteger(run?.userIndex) || run.userIndex < 0 || run.userIndex >= userCount) return 'användarindexet finns inte i LOADTEST_USERS';
      return null;
    })();
    if (problem) throw new CleanupRefused(`Post ${position + 1} i rapporten kan inte städas (${problem}); ingenting raderades.`);
    unique.set(run.id, { id: run.id, userIndex: run.userIndex, key: run.key });
  });
  return [...unique.values()];
}

/** Städar rundor ur en rapportfil från en tidigare körning: prövar hela listan först, loggar in ägarna och raderar. */
export async function cleanupFromReport({ client, users, report }) {
  const runs = planCleanup(report, users.length);
  await loginForCleanup({ client, users, createdRuns: runs });
  return cleanupRuns({ client, users, createdRuns: runs });
}

/**
 * @param {object} args
 * @param {{ request: Function, samples: object[] }} args.client
 * @param {{ users: {login: string, password: string}[], vus: number, durationMs: number, thinkMs: number, loginBudget: number, runBudget: number, keepRuns: boolean }} args.options
 * @param {AbortSignal} [args.signal] avbryter belastningen i förtid; städningen körs ändå
 */
export async function runLoadtest({ client, options, log = console.log, random = Math.random, now = Date.now, pause = sleep, newKey = newRunKey, today = todayStockholm, weights = SCENARIO_WEIGHTS, signal }) {
  const users = options.users.map((user, index) => ({ index, login: user.login, password: user.password, token: null }));
  const state = { loginsLeft: options.loginBudget, runsLeft: options.runBudget, busy: new Set(), createdRuns: [], unresolvedKeys: [] };
  const scenarios = createScenarios({ client, newKey, today });

  // Förberedelse: en inloggning per användare. Misslyckas någon avbryts allt innan någon last har lagts på.
  for (const user of users) {
    const result = await loginUser(client, user);
    if (!user.token) throw new SetupFailed(`Inloggningen för användare nr ${user.index + 1} misslyckades (status ${result.status ?? 'nätverksfel'}); inget lasttest kördes`);
  }
  log(`Förberedelsen klar: ${users.length} användare inloggade. Startar ${options.vus} virtuella användare i ${Math.round(options.durationMs / 1000)} s.`);

  const startedAt = new Date().toISOString();
  const loadStart = now();
  const deadline = loadStart + options.durationMs;
  let failure = null;
  let stop = false;

  // Ett fel i en virtuell användare stoppar de andra och går vidare till städning; det kastas inte, så att rapporten kan skrivas.
  const virtualUsers = Array.from({ length: options.vus }, async (_, vu) => {
    const user = users[vu % users.length];
    try {
      while (!stop && !signal?.aborted && now() < deadline) {
        const names = Object.keys(scenarios).filter((name) => (weights[name] ?? 0) > 0 && scenarios[name].available(state, user));
        if (names.length === 0) break; // inget valbart scenario kvar (budgetarna slut)
        const name = pickWeighted(names, weights, random);
        await scenarios[name].run({ user, state });
        if (options.thinkMs > 0) await pause(options.thinkMs * (0.5 + random()), signal);
      }
    } catch (error) {
      stop = true;
      failure ??= error instanceof Error ? error.message : 'okänt fel';
    }
  });
  await Promise.all(virtualUsers);
  const elapsedSeconds = (now() - loadStart) / 1000;

  let cleanup;
  if (options.keepRuns) {
    cleanup = { deleted: 0, kept: 0, failed: 0, skipped: state.createdRuns.length, keptRuns: [], failedRuns: [] };
  } else {
    log(`Städar ${state.createdRuns.length} rundor.`);
    try {
      cleanup = { ...(await cleanupRuns({ client, users, createdRuns: state.createdRuns })), skipped: 0 };
    } catch (error) {
      failure ??= error instanceof Error ? error.message : 'okänt fel vid städning';
      cleanup = { deleted: 0, kept: 0, failed: state.createdRuns.length, skipped: 0, keptRuns: [], failedRuns: [...state.createdRuns] };
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: summarize(client.samples, elapsedSeconds),
    createdRuns: state.createdRuns,
    unresolvedKeys: state.unresolvedKeys,
    cleanup,
    interrupted: Boolean(signal?.aborted),
    failure,
  };
}
