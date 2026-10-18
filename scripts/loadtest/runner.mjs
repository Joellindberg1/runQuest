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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * @param {object} args
 * @param {{ request: Function, samples: object[] }} args.client
 * @param {{ users: {login: string, password: string}[], vus: number, durationMs: number, thinkMs: number, loginBudget: number, runBudget: number, keepRuns: boolean }} args.options
 */
export async function runLoadtest({ client, options, log = console.log, random = Math.random, now = Date.now, pause = sleep, newKey = newRunKey, today = todayStockholm, weights = SCENARIO_WEIGHTS }) {
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
  let cleanup;
  let elapsedSeconds = 0;

  try {
    const virtualUsers = Array.from({ length: options.vus }, async (_, vu) => {
      const user = users[vu % users.length];
      while (now() < deadline) {
        const names = Object.keys(scenarios).filter((name) => (weights[name] ?? 0) > 0 && scenarios[name].available(state, user));
        if (names.length === 0) break; // inget valbart scenario kvar (budgetarna slut)
        const name = pickWeighted(names, weights, random);
        await scenarios[name].run({ user, state });
        if (options.thinkMs > 0) await pause(options.thinkMs * (0.5 + random()));
      }
    });
    await Promise.all(virtualUsers);
    elapsedSeconds = (now() - loadStart) / 1000;
  } finally {
    if (options.keepRuns) {
      cleanup = { deleted: 0, kept: 0, failed: 0, skipped: state.createdRuns.length, keptRuns: [], failedRuns: [] };
    } else {
      log(`Städar ${state.createdRuns.length} rundor.`);
      cleanup = { ...(await cleanupRuns({ client, users, createdRuns: state.createdRuns })), skipped: 0 };
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: summarize(client.samples, elapsedSeconds),
    createdRuns: state.createdRuns,
    unresolvedKeys: state.unresolvedKeys,
    cleanup,
  };
}
