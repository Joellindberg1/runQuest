// Rapportens text och JSON: målen syns bredvid utfallet, städningen redovisas, och inget hemligt följer med.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildJsonReport, formatReport } from './report.mjs';
import { evaluateTargets, summarize } from './stats.mjs';
import { TARGETS } from './targets.mjs';

const sample = (scenario, ms, outcome = 'ok', status = 200) => ({ scenario, ms, outcome, status });
const config = {
  baseUrl: 'http://127.0.0.1:4010', vus: 4, durationSeconds: 10, thinkMs: 800, loginBudget: 3, runBudget: 6, keepRuns: false,
  users: [{ login: 'fake-user-1@example.invalid', password: 'FAKE_TEST_PASSWORD_1_not_real' }],
};

function resultWith(samples) {
  return {
    startedAt: '2026-10-18T10:00:00.000Z',
    finishedAt: '2026-10-18T10:00:10.000Z',
    summary: summarize(samples, 10),
    createdRuns: [{ id: '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f', userIndex: 0, key: '10ad7e57-0000-4000-8000-000000000000' }],
    unresolvedKeys: ['10ad7e57-1111-4111-8111-111111111111'],
    cleanup: { deleted: 0, kept: 1, failed: 0, skipped: 0, keptRuns: [{ id: '0b8a4f3e-5c1d-4c6e-9d2a-7a1b3c4d5e6f', userIndex: 0, key: 'k' }], failedRuns: [] },
  };
}

describe('formatReport', () => {
  const good = [sample('login', 100), sample('leaderboard', 100), sample('news', 100), sample('log-run', 100)];

  it('shows the host, the figures per scenario and a passing verdict', () => {
    const result = resultWith(good);
    const text = formatReport({ config, result, evaluation: evaluateTargets(result.summary, TARGETS) });
    assert.match(text, /127\.0\.0\.1:4010/);
    for (const name of ['login', 'leaderboard', 'news', 'log-run']) assert.match(text, new RegExp(name));
    assert.match(text, /GODKÄND/);
  });

  it('flags a run smaller than the target run so it is not mistaken for the measurement', () => {
    const result = resultWith(good);
    const evaluation = evaluateTargets(result.summary, TARGETS);
    assert.match(formatReport({ config, result, evaluation }), /avgränsad/);
    const full = { ...config, vus: TARGETS.concurrentUsers, durationSeconds: TARGETS.durationSeconds };
    assert.doesNotMatch(formatReport({ config: full, result, evaluation }), /avgränsad/);
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

describe('buildJsonReport', () => {
  it('carries the figures and run ids but neither logins nor passwords', () => {
    const result = resultWith([sample('news', 100)]);
    const json = JSON.stringify(buildJsonReport({ config, result, evaluation: evaluateTargets(result.summary, TARGETS) }));
    assert.ok(json.includes('"createdRuns"'));
    assert.ok(!json.includes('FAKE_TEST_PASSWORD'));
    assert.ok(!json.includes('example.invalid'));
  });
});
