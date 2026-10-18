// Mått och målutvärdering. Ren logik.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateTargets, percentile, summarize } from './stats.mjs';

const sample = (scenario, ms, outcome = 'ok', status = 200) => ({ scenario, ms, outcome, status });

describe('percentile', () => {
  it('uses the nearest-rank method on unsorted input', () => {
    const values = [50, 10, 40, 20, 30, 60, 70, 80, 90, 100];
    assert.equal(percentile(values, 50), 50);
    assert.equal(percentile(values, 95), 100);
    assert.equal(percentile(values, 10), 10);
  });

  it('is null for no samples and does not reorder the caller input', () => {
    assert.equal(percentile([], 95), null);
    const values = [3, 1, 2];
    percentile(values, 50);
    assert.deepEqual(values, [3, 1, 2]);
  });
});

describe('summarize', () => {
  it('counts outcomes and latency per scenario and in total', () => {
    const summary = summarize([
      sample('news', 100), sample('news', 300), sample('news', 200, 'failed', 500),
      sample('login', 400, 'rate_limited', 429),
    ], 10);
    assert.deepEqual(
      { count: summary.scenarios.news.count, ok: summary.scenarios.news.ok, failed: summary.scenarios.news.failed, p95: summary.scenarios.news.p95Ms },
      { count: 3, ok: 2, failed: 1, p95: 300 },
    );
    assert.equal(summary.scenarios.login.rateLimited, 1);
    assert.equal(summary.total.count, 4);
    assert.equal(summary.total.failed, 1);
    assert.equal(summary.total.errorRate, 0.25);
    assert.equal(summary.total.requestsPerSecond, 0.4);
  });

  it('keeps cleanup traffic out of the totals', () => {
    const summary = summarize([sample('news', 100), sample('cleanup', 900, 'failed', 409)], 1);
    assert.equal(summary.total.count, 1);
    assert.equal(summary.total.failed, 0);
    assert.equal(summary.scenarios.cleanup.failed, 1);
  });

  it('gives a zero error rate for an empty run', () => {
    assert.equal(summarize([], 5).total.errorRate, 0);
  });
});

describe('evaluateTargets', () => {
  const targets = { maxErrorRate: 0.01, maxRateLimited: 0, p95Ms: { news: 800, 'log-run': 3000 } };

  it('passes when every check is within its limit', () => {
    const summary = summarize([sample('news', 100), sample('log-run', 1000)], 1);
    const result = evaluateTargets(summary, targets);
    assert.equal(result.passed, true);
    assert.ok(result.checks.every((check) => check.ok));
  });

  it('fails on a slow p95, on the error rate and on any 429', () => {
    const slow = evaluateTargets(summarize([sample('news', 900), sample('log-run', 100)], 1), targets);
    assert.equal(slow.passed, false);
    assert.equal(slow.checks.find((c) => c.name === 'p95 news').ok, false);

    const errors = evaluateTargets(summarize([sample('news', 100), sample('news', 100, 'failed', 500), sample('log-run', 100)], 1), targets);
    assert.equal(errors.checks.find((c) => c.name === 'felkvot').ok, false);

    const limited = evaluateTargets(summarize([sample('news', 100), sample('news', 100, 'rate_limited', 429), sample('log-run', 100)], 1), targets);
    assert.equal(limited.checks.find((c) => c.name === '429-svar').ok, false);
  });

  it('marks a scenario that was never sampled as not measured, not as a pass', () => {
    const result = evaluateTargets(summarize([sample('news', 100)], 1), targets);
    const check = result.checks.find((c) => c.name === 'p95 log-run');
    assert.equal(check.actual, null);
    assert.equal(check.ok, false);
    assert.equal(result.passed, false);
  });
});
