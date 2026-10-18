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
//   LOADTEST_KEEP_RUNS=1, LOADTEST_OUT_DIR       se docs/loadtest.md
// Utgångskod: 0 målen nåddes, 2 målen missades, 1 felaktig konfiguration, nekad bas-URL eller misslyckad förberedelse.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { loadConfig } from './config.mjs';
import { buildJsonReport, formatReport } from './report.mjs';
import { cleanupRuns, loginForCleanup, runLoadtest } from './runner.mjs';
import { evaluateTargets } from './stats.mjs';
import { TARGETS } from './targets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Kör hela provet med en färdig konfiguration, skriver rapportfilen och returnerar utfallet. Delas av `run.mjs` och `local.mjs`. */
export async function executeLoadtest({ config, log = console.log, fetchImpl }) {
  const client = createClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs, ...(fetchImpl && { fetchImpl }) });
  log(`Mål: ${config.baseUrl} (${config.vus} virtuella användare, ${config.durationSeconds} s, ${config.users.length} konton, inloggningsbudget ${config.loginBudget}, rundbudget ${config.runBudget})`);

  const result = await runLoadtest({
    client,
    log,
    options: { ...config, durationMs: config.durationSeconds * 1000 },
  });
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
  return { result, evaluation, outPath };
}

async function cleanupFromReport(config, reportPath, log) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const createdRuns = [...(report.cleanup?.keptRuns ?? []), ...(report.cleanup?.failedRuns ?? []), ...(report.cleanup?.skipped ? report.createdRuns : [])];
  const unique = [...new Map(createdRuns.map((run) => [run.id, run])).values()];
  if (unique.length === 0) { log('Inga rundor att städa i rapporten.'); return 0; }
  const client = createClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
  const users = config.users.map((user, index) => ({ index, ...user, token: null }));
  await loginForCleanup({ client, users, createdRuns: unique });
  const outcome = await cleanupRuns({ client, users, createdRuns: unique });
  log(`Städning: ${outcome.deleted} borttagna, ${outcome.kept} kvar (409), ${outcome.failed} misslyckades.`);
  for (const run of [...outcome.keptRuns, ...outcome.failedRuns]) log(`  kvar: ${run.id} (nyckel ${run.key})`);
  return outcome.failed + outcome.kept === 0 ? 0 : 2;
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
      return await cleanupFromReport(config, resolve(argv[1]), console.log);
    }
    const { evaluation } = await executeLoadtest({ config });
    return evaluation.passed ? 0 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Okänt fel');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
