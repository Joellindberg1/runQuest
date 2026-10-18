#!/usr/bin/env node
// Lasttestet mot staging (docs/loadtest.md). Körs av Lead eller ägaren, aldrig av CI och aldrig av en byggare.
//
//   npm run loadtest:staging                       kör belastningen och städar rundorna efteråt
//   npm run loadtest:cleanup -- <rapportfil.json>  städar rundor som en tidigare körning lämnade kvar (LOADTEST_KEEP_RUNS=1 eller 409)
//
// Miljövariabler (alla läses här, inget hårdkodas):
//   LOADTEST_USERS         JSON-lista med testkonton: [{"login":"...","password":"..."}]   (krävs)
//   LOADTEST_BASE_URL      standard stagingbackenden; bara den och localhost/127.0.0.1 godtas
//   LOADTEST_VUS, LOADTEST_DURATION_S, LOADTEST_THINK_MS, LOADTEST_TIMEOUT_MS, LOADTEST_LOGIN_BUDGET, LOADTEST_RUN_BUDGET,
//   LOADTEST_KEEP_RUNS=1, LOADTEST_IGNORE_LOGIN_LEDGER=1, LOADTEST_OUT_DIR       se docs/loadtest.md
// Utgångskod: 0 hel mätning som nådde målen, 1 felaktig konfiguration, nekad bas-URL, misslyckad förberedelse eller fel under körningen,
// 2 målen missades, 3 rökprov (avgränsad eller avbruten körning) där inget gick fel. Ctrl-C (SIGINT/SIGTERM) städar och skriver rapporten.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { loadConfig } from './config.mjs';
import { isLocalBase } from './guard.mjs';
import { assertLoginRoom, createFileLedger } from './loginLedger.mjs';
import { buildJsonReport, exitCodeFor, formatReport } from './report.mjs';
import { cleanupFromReport, planCleanup, runLoadtest } from './runner.mjs';
import { evaluateTargets, summarize } from './stats.mjs';
import { TARGETS } from './targets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const loginCount = (client) => client.samples.filter((sample) => sample.scenario === 'login').length;

/** Loggboken ligger bredvid rapporterna och används mot den riktiga stagingvärden; fejkservern har ingen inloggningsgräns att skydda. */
function ledgerFor(config) {
  return isLocalBase(config.baseUrl) ? null : createFileLedger(join(config.outDir ?? join(HERE, 'out'), 'login-ledger.json'));
}

/** Reserverar inloggningar i loggboken (eller vägrar) innan första anropet. Returnerar en funktion som bokför det som faktiskt gjordes. */
function reserveLogins({ ledger, config, needed, client }) {
  if (!ledger) return () => {};
  assertLoginRoom(ledger.entries(), config.baseUrl, needed, Date.now(), { force: config.ignoreLoginLedger });
  const id = ledger.reserve(config.baseUrl, needed);
  return () => ledger.settle(id, loginCount(client));
}

/**
 * Kör hela provet med en färdig konfiguration, skriver rapportfilen och returnerar utfallet. Delas av `run.mjs` och `local.mjs`.
 * Kastar bara när loggboken inte ger plats för körningen (inget har då hänt). Allt annat, även en misslyckad förberedelse, ger en rapport.
 */
export async function executeLoadtest({ config, log = console.log, fetchImpl, ledger = ledgerFor(config), signal }) {
  const client = createClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs, ...(fetchImpl && { fetchImpl }) });
  const settle = reserveLogins({ ledger, config, needed: config.users.length + config.loginBudget, client });
  log(`Mål: ${config.baseUrl} (${config.vus} virtuella användare, ${config.durationSeconds} s, ${config.users.length} konton, inloggningsbudget ${config.loginBudget}, rundbudget ${config.runBudget})`);

  let result;
  try {
    result = await runLoadtest({ client, log, signal, options: { ...config, durationMs: config.durationSeconds * 1000 } });
  } catch (error) {
    // Förberedelsen föll (eller något oväntat): en rapport med felet och det som hann mätas, i stället för bara ett felmeddelande.
    const now = new Date().toISOString();
    result = {
      startedAt: now, finishedAt: now, summary: summarize(client.samples, 0), createdRuns: [], unresolvedKeys: [],
      cleanup: { deleted: 0, kept: 0, failed: 0, skipped: 0, keptRuns: [], failedRuns: [] },
      interrupted: Boolean(signal?.aborted), failure: error instanceof Error ? error.message : 'okänt fel',
    };
  } finally {
    settle();
  }

  const evaluation = evaluateTargets(result.summary, TARGETS);
  const report = buildJsonReport({ config, result, evaluation });
  const outDir = config.outDir ?? join(HERE, 'out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `loadtest-${result.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  log('');
  log(formatReport({ config, result, evaluation }));
  log('');
  log(`Rapportfil: ${outPath}`);
  return { result, evaluation, outPath, exitCode: exitCodeFor({ config, result, evaluation }) };
}

/** Städar rundor ur en tidigare rapport. Hela rapporten prövas (nyckelprefix, uuid, användarindex) innan en enda inloggning görs. */
async function cleanupFromFile(config, reportPath, log) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const runs = planCleanup(report, config.users.length);
  if (runs.length === 0) { log('Inga rundor att städa i rapporten.'); return 0; }
  const client = createClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
  const owners = new Set(runs.map((run) => run.userIndex)).size;
  const settle = reserveLogins({ ledger: ledgerFor(config), config, needed: owners, client });
  const users = config.users.map((user, index) => ({ index, ...user, token: null }));
  try {
    const outcome = await cleanupFromReport({ client, users, report });
    log(`Städning: ${outcome.deleted} borttagna, ${outcome.kept} kvar (409), ${outcome.failed} misslyckades.`);
    for (const run of [...outcome.keptRuns, ...outcome.failedRuns]) log(`  kvar: ${run.id} (nyckel ${run.key})`);
    return outcome.failed + outcome.kept === 0 ? 0 : 2;
  } finally {
    settle();
  }
}

/** Ctrl-C och SIGTERM avbryter belastningen, städar och skriver rapporten; en andra signal avslutar direkt. */
function abortOnSignals(controller, log) {
  let received = 0;
  const handler = (name) => () => {
    received += 1;
    if (received > 1) process.exit(130);
    log(`\n${name} mottagen: avbryter belastningen, städar rundorna och skriver rapporten. Tryck igen för att avsluta direkt.`);
    controller.abort();
  };
  process.on('SIGINT', handler('SIGINT'));
  process.on('SIGTERM', handler('SIGTERM'));
}

async function main(argv, env) {
  if (env.CI || env.VITEST) {
    console.error('Lasttestet körs aldrig i CI eller i en testkörning.');
    return 1;
  }
  try {
    const config = loadConfig(env);
    if (argv[0] === '--cleanup') {
      if (!argv[1]) throw new Error('Ange rapportfilen: npm run loadtest:cleanup -- <rapportfil.json>');
      return await cleanupFromFile(config, resolve(argv[1]), console.log);
    }
    const controller = new AbortController();
    abortOnSignals(controller, console.log);
    const { exitCode } = await executeLoadtest({ config, signal: controller.signal });
    return exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Okänt fel');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
