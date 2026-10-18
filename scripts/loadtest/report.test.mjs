// Rapportens text och JSON: målen syns bredvid utfallet, städningen redovisas, och inget hemligt följer med.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildJsonReport, exitCodeFor, formatReport } from './report.mjs';
import { evaluateTargets, summarize } from './stats.mjs';
import { TARGETS } from './targets.mjs';

const sample = (scenario, ms, outcome = 'ok', status = 200) => ({ scenario, ms, outcome, status });
const full = { vus: TARGETS.concurrentUsers, durationSeconds: TARGETS.durationSeconds };
const config = {
  baseUrl: 'http://127.0.0.1:4010', vus: 4, durationSeconds: 10, thinkMs: 800, loginBudget: 3, runBudget: 6, keepRuns: false,
  users: [{ login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' }],
};

function resultWith(samples, extra = {}) {
  return {
    interrupted: false,
    failure: null,
    startedAt: '2026-10-18T10:00:00.000Z',
    finishedAt: '2026-10-18T10:00:10.000Z',
    summary: summarize(samples, 10),
    createdRuns: [{ id: '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f', userIndex: 0, key: '10ad7e57-0000-4000-8000-000000000000' }],
    unresolvedKeys: ['10ad7e57-1111-4111-8111-111111111111'],
    cleanup: { deleted: 0, kept: 1, failed: 0, skipped: 0, keptRuns: [{ id: '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f', userIndex: 0, key: 'k' }], failedRuns: [] },
    ...extra,
  };
}

describe('formatReport', () => {
  const good = [sample('login', 100), sample('leaderboard', 100), sample('news', 100), sample('log-run', 100)];

  it('shows the host, the figures per scenario and a passing verdict', () => {
    const result = resultWith(good);
    const text = formatReport({ config: { ...config, ...full }, result, evaluation: evaluateTargets(result.summary, TARGETS) });
    assert.match(text, /127\.0\.0\.1:4010/);
    for (const name of ['login', 'leaderboard', 'news', 'log-run']) assert.match(text, new RegExp(name));
    assert.match(text, /GODKÄND/);
  });

  it('flags a run smaller than the target run so it is not mistaken for the measurement', () => {
    const result = resultWith(good);
    const evaluation = evaluateTargets(result.summary, TARGETS);
    assert.match(formatReport({ config, result, evaluation }), /avgränsad/);
    assert.doesNotMatch(formatReport({ config: { ...config, ...full }, result, evaluation }), /avgränsad/);
  });

  it('does not call a smaller run GODKÄND even when every target was met, and labels it as a smoke test', () => {
    const result = resultWith(good);
    const text = formatReport({ config, result, evaluation: evaluateTargets(result.summary, TARGETS) });
    assert.doesNotMatch(text, /GODKÄND/);
    assert.match(text, /RÖKPROV/);
  });

  it('says so when the run was interrupted or failed, instead of giving a verdict', () => {
    const interrupted = resultWith(good, { interrupted: true });
    const failed = resultWith(good, { failure: 'boom' });
    const cfg = { ...config, ...full };
    assert.match(formatReport({ config: cfg, result: interrupted, evaluation: evaluateTargets(interrupted.summary, TARGETS) }), /AVBRUTEN/);
    const text = formatReport({ config: cfg, result: failed, evaluation: evaluateTargets(failed.summary, TARGETS) });
    assert.match(text, /AVBRUTEN AV FEL: boom/);
    assert.doesNotMatch(text, /GODKÄND/);
  });

  it('says which target was missed', () => {
    const result = resultWith([...good, sample('news', 5000)]);
    const evaluation = evaluateTargets(result.summary, TARGETS);
    const text = formatReport({ config, result, evaluation });
    assert.match(text, /EJ GODKÄND/);
    assert.match(text, /p95 news/);
  });

  it('reports runs that were kept and keys that could not be resolved, so the cleanup in staging is not forgotten', () => {
    const result = resultWith(good);
    const text = formatReport({ config, result, evaluation: evaluateTargets(result.summary, TARGETS) });
    assert.match(text, /10ad7e57/);
    assert.match(text, /kvar/i);
  });
});

describe('exitCodeFor', () => {
  const good = [sample('login', 100), sample('leaderboard', 100), sample('news', 100), sample('log-run', 100)];
  const code = (cfg, extra, samples = good) => {
    const result = resultWith(samples, extra);
    return exitCodeFor({ config: cfg, result, evaluation: evaluateTargets(result.summary, TARGETS) });
  };

  it('is 0 only for a full-size, uninterrupted run that met every target', () => {
    assert.equal(code({ ...config, ...full }, {}), 0);
  });

  it('is 3 for a smaller run or an interrupted run that otherwise looked fine, so a smoke test never reads as a measurement', () => {
    assert.equal(code(config, {}), 3);
    assert.equal(code({ ...config, ...full }, { interrupted: true }), 3);
  });

  it('is 3 for an interrupted run even when too little was measured to meet every target', () => {
    assert.equal(code({ ...config, ...full }, { interrupted: true }, [sample('news', 100)]), 3);
  });

  it('is 2 when a target was missed and 1 when the run failed', () => {
    assert.equal(code({ ...config, ...full }, {}, [...good, sample('news', 5000)]), 2);
    assert.equal(code({ ...config, ...full }, { failure: 'boom' }), 1);
  });
});

describe('buildJsonReport', () => {
  it('records whether the run was a measurement, interrupted or failed', () => {
    const result = resultWith([sample('news', 100)], { interrupted: true, failure: 'boom' });
    const report = buildJsonReport({ config, result, evaluation: evaluateTargets(result.summary, TARGETS) });
    assert.equal(report.measurement, false);
    assert.equal(report.interrupted, true);
    assert.equal(report.failure, 'boom');
  });

  it('carries the figures and run ids but neither logins nor passwords', () => {
    const result = resultWith([sample('news', 100)]);
    const json = JSON.stringify(buildJsonReport({ config, result, evaluation: evaluateTargets(result.summary, TARGETS) }));
    assert.ok(json.includes('"createdRuns"'));
    assert.ok(!json.includes('FAKE_TEST_PASSWORD'));
    assert.ok(!json.includes('example.invalid'));
  });
});
