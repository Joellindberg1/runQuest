// Rapportens text (konsolen, klistras in i docs/loadtest.md) och JSON (filen i out/). Ren formatering. Ingen inloggning, inget lösenord
// och ingen token skrivs hit: konfigurationen visas utan användarlistan, och rundorna bär bara id, ordningsnummer och nyckel.
import { TARGETS } from './targets.mjs';

const ms = (value) => (value === null || value === undefined ? '-' : `${value}`);
const pct = (value) => `${(value * 100).toFixed(2)} %`;

function table(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  const line = (row) => `| ${row.map((cell, column) => String(cell).padEnd(widths[column])).join(' | ')} |`;
  return [line(rows[0]), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.slice(1).map(line)].join('\n');
}

export function formatReport({ config, result, evaluation }) {
  const { summary, cleanup } = result;
  const scenarioRows = [['scenario', 'anrop', 'ok', '429', 'fel', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms']];
  for (const [name, s] of Object.entries(summary.scenarios)) {
    scenarioRows.push([name, s.count, s.ok, s.rateLimited, s.failed, ms(s.p50Ms), ms(s.p95Ms), ms(s.p99Ms), ms(s.maxMs)]);
  }
  const checkRows = [['mål', 'utfall', 'gräns', 'resultat']];
  for (const check of evaluation.checks) {
    const isRate = check.name === 'felkvot';
    const actual = check.actual === null ? 'ej mätt' : isRate ? pct(check.actual) : check.actual;
    const limit = isRate ? pct(check.limit) : check.limit;
    checkRows.push([check.name, actual, limit, check.ok ? 'ok' : 'MISSAT']);
  }

  const lines = [
    `Lasttest mot ${config.baseUrl}`,
    `${config.vus} samtidiga användare (${config.users.length} konton), ${summary.elapsedSeconds.toFixed(1)} s belastning, tänketid ${config.thinkMs} ms, ${summary.total.count} anrop (${summary.total.requestsPerSecond.toFixed(1)}/s)`,
    `Start ${result.startedAt}, slut ${result.finishedAt}`,
    '',
    table(scenarioRows),
    '',
    table(checkRows),
    '',
    `Totalt: felkvot ${pct(summary.total.errorRate)}, ${summary.total.rateLimited} st 429-svar.`,
    `Resultat mot målen (${TARGETS.concurrentUsers} användare, ${TARGETS.durationSeconds} s): ${evaluation.passed ? 'GODKÄND' : 'EJ GODKÄND'}`,
    ...(config.vus < TARGETS.concurrentUsers || config.durationSeconds < TARGETS.durationSeconds
      ? [`OBS: avgränsad körning. Målkörningen är minst ${TARGETS.concurrentUsers} samtidiga användare i ${TARGETS.durationSeconds} s; en mindre körning är ett rökprov, inte mätningen.`]
      : []),
    '',
    `Rundor skapade: ${result.createdRuns.length} (märkta med nyckelprefixet 10ad7e57 och distans 1,01 km).`,
  ];
  if (config.keepRuns) lines.push(`Rundorna lämnades kvar (LOADTEST_KEEP_RUNS=1): ${cleanup.skipped} st. Städa med: npm run loadtest:cleanup -- <rapportfil>`);
  else lines.push(`Städning: ${cleanup.deleted} borttagna, ${cleanup.kept} kvar (event-kvalificerade, 409), ${cleanup.failed} misslyckades.`);
  for (const run of [...cleanup.keptRuns, ...cleanup.failedRuns]) lines.push(`  kvar: ${run.id} (nyckel ${run.key})`);
  if (result.unresolvedKeys.length > 0) {
    lines.push(`Rundanrop utan id i svaret (kan ändå ha skapat en runda, sök på nyckel i staging): ${result.unresolvedKeys.length} st`);
    for (const key of result.unresolvedKeys) lines.push(`  nyckel ${key}`);
  }
  return lines.join('\n');
}

export function buildJsonReport({ config, result, evaluation }) {
  return {
    baseUrl: config.baseUrl,
    settings: {
      vus: config.vus, durationSeconds: config.durationSeconds, thinkMs: config.thinkMs, accounts: config.users.length,
      loginBudget: config.loginBudget, runBudget: config.runBudget, keepRuns: config.keepRuns,
    },
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    summary: result.summary,
    evaluation,
    createdRuns: result.createdRuns,
    unresolvedKeys: result.unresolvedKeys,
    cleanup: result.cleanup,
  };
}
