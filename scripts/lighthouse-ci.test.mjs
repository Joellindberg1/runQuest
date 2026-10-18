// Test av Lighthouse-verktygen: det falska API:et, medianraden i sammanfattningen och att budgeten täcker det den ska.
// Körs med `node --test scripts/lighthouse-ci.test.mjs` (CI: frontend-jobbet, som kör alla scripts/*.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockApi, MOCK_STATS } from './lighthouse/mock-api.mjs';
import { formatTable, median, summarizeLhrs } from './lighthouse/summarize.mjs';

const here = dirname(fileURLToPath(import.meta.url));

describe('mock-api', () => {
  let server;
  let base;
  before(async () => {
    server = createMockApi();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  it('answers /api/public/stats with the three numbers the landing validates, readable cross-origin', async () => {
    const res = await fetch(`${base}/api/public/stats`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await res.json(), { success: true, data: MOCK_STATS });
    for (const n of Object.values(MOCK_STATS)) assert.ok(Number.isFinite(n) && n >= 0);
  });

  it('answers everything else with 404', async () => {
    const res = await fetch(`${base}/api/auth/users`);
    assert.equal(res.status, 404);
  });
});

describe('median', () => {
  it('picks the middle value of an odd count regardless of order', () => {
    assert.equal(median([9, 1, 5]), 5);
  });

  it('averages the two middle values of an even count', () => {
    assert.equal(median([1, 2, 3, 10]), 2.5);
  });

  it('has no median for an empty list', () => {
    assert.equal(median([]), null);
  });
});

const lhr = (url, { perf, lcp, cls = 0, tbt = 0, script, style, image = 0, total }) => ({
  finalDisplayedUrl: url,
  categories: {
    performance: { score: perf },
    accessibility: { score: 1 },
    'best-practices': { score: 1 },
    seo: { score: 1 },
  },
  audits: {
    'first-contentful-paint': { numericValue: 1000 },
    'largest-contentful-paint': { numericValue: lcp },
    'cumulative-layout-shift': { numericValue: cls },
    'total-blocking-time': { numericValue: tbt },
    'resource-summary': {
      details: {
        items: [
          { resourceType: 'script', transferSize: script },
          { resourceType: 'stylesheet', transferSize: style },
          { resourceType: 'image', transferSize: image },
          { resourceType: 'total', transferSize: total },
        ],
      },
    },
  },
});

describe('summarizeLhrs', () => {
  const runs = [
    lhr('http://127.0.0.1:18090/', { perf: 0.8, lcp: 3000, script: 100, style: 10, total: 500 }),
    lhr('http://127.0.0.1:18090/', { perf: 0.9, lcp: 4000, script: 300, style: 30, total: 900 }),
    lhr('http://127.0.0.1:18090/', { perf: 0.7, lcp: 9000, script: 200, style: 20, total: 700 }),
    lhr('http://127.0.0.1:18090/legal', { perf: 1, lcp: 1000, script: 50, style: 5, total: 100 }),
  ];

  it('takes the median per metric and page, so one slow run does not decide', () => {
    const [landing] = summarizeLhrs(runs);
    assert.equal(landing.url, 'http://127.0.0.1:18090/');
    assert.equal(landing.runs, 3);
    assert.equal(landing.categories.performance, 0.8);
    assert.equal(landing.lcp, 4000);
    assert.deepEqual(landing.bytes, { script: 200, stylesheet: 20, image: 0, total: 700 });
  });

  it('keeps one row per page, in the order the pages first appear', () => {
    const rows = summarizeLhrs(runs);
    assert.deepEqual(rows.map((r) => r.url), ['http://127.0.0.1:18090/', 'http://127.0.0.1:18090/legal']);
    assert.equal(rows[1].runs, 1);
  });

  it('prints a table with a line per page and the budgeted columns', () => {
    const table = formatTable(summarizeLhrs(runs));
    assert.match(table, /\| Page \| Runs \| Perf \| A11y \| BP \| SEO \| LCP \(ms\) \| CLS \| TBT \(ms\) \| JS \(kB\) \| CSS \(kB\) \| Total \(kB\) \|/);
    assert.match(table, /\/legal/);
  });
});

describe('lighthouserc budget', () => {
  const rc = JSON.parse(readFileSync(join(here, 'lighthouse', 'lighthouserc.json'), 'utf8'));
  const { assertions } = rc.ci.assert;

  it('measures the landing and /legal, three runs each, judged on the median', () => {
    assert.equal(rc.ci.collect.numberOfRuns, 3);
    assert.deepEqual(rc.ci.collect.url.map((u) => new URL(u).pathname), ['/', '/legal']);
    assert.equal(rc.ci.assert.assertions['categories:performance'][0], 'error');
    assert.equal(rc.ci.assert.aggregationMethod, 'median');
  });

  it('has a minimum score for every category and a ceiling for LCP, CLS, TBT, JS, CSS and total weight', () => {
    for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) {
      assert.ok(assertions[`categories:${category}`]?.[1]?.minScore > 0, `categories:${category} saknar minScore`);
    }
    for (const audit of ['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'resource-summary:script:size', 'resource-summary:stylesheet:size', 'resource-summary:total:size']) {
      assert.ok(assertions[audit]?.[1]?.maxNumericValue > 0, `${audit} saknar maxNumericValue`);
    }
  });

  it('is not weakened into warnings: every budget line fails the run', () => {
    for (const [name, [level]] of Object.entries(assertions)) assert.equal(level, 'error', name);
  });
});
