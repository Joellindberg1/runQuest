// Mått och målutvärdering. Ren logik utan I/O.

/** Percentil med närmaste-rang-metoden. Null för tom indata. Ändrar inte indata. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

function describeSamples(samples) {
  const latencies = samples.map((s) => s.ms);
  const failed = samples.filter((s) => s.outcome === 'failed').length;
  return {
    count: samples.length,
    ok: samples.filter((s) => s.outcome === 'ok').length,
    rateLimited: samples.filter((s) => s.outcome === 'rate_limited').length,
    failed,
    errorRate: samples.length === 0 ? 0 : failed / samples.length,
    p50Ms: round1(percentile(latencies, 50)),
    p95Ms: round1(percentile(latencies, 95)),
    p99Ms: round1(percentile(latencies, 99)),
    maxMs: latencies.length === 0 ? null : round1(Math.max(...latencies)),
  };
}

/** Städningen (DELETE av de egna rundorna) mäts men räknas inte in i totalen och målen. */
const EXCLUDED_FROM_TOTAL = new Set(['cleanup']);

export function summarize(samples, elapsedSeconds) {
  const byScenario = new Map();
  for (const sample of samples) {
    if (!byScenario.has(sample.scenario)) byScenario.set(sample.scenario, []);
    byScenario.get(sample.scenario).push(sample);
  }
  const scenarios = Object.fromEntries([...byScenario].map(([name, list]) => [name, describeSamples(list)]));
  const counted = samples.filter((s) => !EXCLUDED_FROM_TOTAL.has(s.scenario));
  const total = describeSamples(counted);
  total.requestsPerSecond = elapsedSeconds > 0 ? counted.length / elapsedSeconds : 0;
  return { scenarios, total, elapsedSeconds };
}

/**
 * Jämför en sammanfattning med målen. Ett scenario utan mätvärden (inget anrop gjordes) är inte godkänt: tystnad är inte ett bevis.
 * Returnerar { passed, checks: [{ name, actual, limit, ok }] }.
 */
export function evaluateTargets(summary, targets) {
  const checks = [
    { name: 'felkvot', actual: summary.total.errorRate, limit: targets.maxErrorRate, ok: summary.total.errorRate <= targets.maxErrorRate },
    { name: '429-svar', actual: summary.total.rateLimited, limit: targets.maxRateLimited, ok: summary.total.rateLimited <= targets.maxRateLimited },
  ];
  for (const [scenario, limit] of Object.entries(targets.p95Ms)) {
    const measured = summary.scenarios[scenario]?.p95Ms ?? null;
    checks.push({ name: `p95 ${scenario}`, actual: measured, limit, ok: measured !== null && measured <= limit });
  }
  return { passed: checks.every((check) => check.ok), checks };
}
