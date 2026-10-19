// Test av Lighthouse-verktygen: det falska API:et, medianraden och felraderna i sammanfattningen, skriptets vakter och att budgeten är fäst.
// Körs med `node --test scripts/lighthouse-ci.test.mjs`. CI: frontend-jobbets egna steg "Lighthouse tooling" (en namngiven fil, inga
// beroenden, före npm ci); frontend-jobbet kör inte scripts/*.test.mjs som helhet.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockApi, MOCK_STATS } from './lighthouse/mock-api.mjs';
import { formatFailures, formatTable, median, summarizeLhrs, toAnnotation } from './lighthouse/summarize.mjs';

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

  // BUDGETEN ÄR FÄST HÄR. Golven och taken nedan är ägarens budget (docs/release.md, "Lighthouse-budget"); lighthouserc.json får vara
  // lika med eller strängare, aldrig lättare. Det här testet får därför BARA ändras när budgeten SKÄRPS (högre golv, lägre tak).
  // Att lätta en gräns, ta bort en rad eller höja ett tak kräver ägarens uttryckliga ok, och ska stå i PR-beskrivningen.
  const FLOORS = {
    'categories:performance': 0.75,
    'categories:accessibility': 0.95,
    'categories:best-practices': 0.9,
    'categories:seo': 0.95,
  };
  const CEILINGS = {
    'largest-contentful-paint': 5000,
    'cumulative-layout-shift': 0.05,
    'total-blocking-time': 200,
    'resource-summary:script:size': 275000,
    'resource-summary:stylesheet:size': 50000,
    'resource-summary:total:size': 500000,
  };

  it('keeps every score floor at or above the owner-approved minimum', () => {
    for (const [name, floor] of Object.entries(FLOORS)) {
      const minScore = assertions[name]?.[1]?.minScore;
      assert.ok(typeof minScore === 'number' && minScore >= floor, `${name}: minScore ${minScore} är lättare än ${floor}`);
    }
  });

  it('keeps every ceiling at or below the owner-approved maximum', () => {
    for (const [name, ceiling] of Object.entries(CEILINGS)) {
      const max = assertions[name]?.[1]?.maxNumericValue;
      assert.ok(typeof max === 'number' && max <= ceiling, `${name}: maxNumericValue ${max} är lättare än ${ceiling}`);
    }
  });

  it('has no budget line beyond the pinned ones, so a new line is a conscious change of this test', () => {
    assert.deepEqual(Object.keys(assertions).sort(), [...Object.keys(FLOORS), ...Object.keys(CEILINGS)].sort());
  });

  it('is not weakened into warnings: every budget line fails the run', () => {
    for (const [name, [level]] of Object.entries(assertions)) assert.equal(level, 'error', name);
  });
});

describe('formatFailures', () => {
  const results = [
    { url: 'http://127.0.0.1:18090/', auditId: 'categories', auditProperty: 'performance', name: 'minScore', operator: '>=', expected: 0.75, actual: 0.6, passed: false },
    { url: 'http://127.0.0.1:18090/', auditId: 'cumulative-layout-shift', name: 'maxNumericValue', operator: '<=', expected: 0.05, actual: 0.01, passed: true },
    { url: 'http://127.0.0.1:18090/legal', auditId: 'largest-contentful-paint', name: 'maxNumericValue', operator: '<=', expected: 5000, actual: 6925.6415, passed: false },
  ];

  it('names the page, the failing line, the found value and the limit, and skips lines that held', () => {
    assert.deepEqual(formatFailures(results), [
      '/ categories.performance minScore: found 0.6, expected >= 0.75',
      '/legal largest-contentful-paint maxNumericValue: found 6925.642, expected <= 5000',
    ]);
  });

  it('has nothing to report when every line held', () => {
    assert.deepEqual(formatFailures([results[1]]), []);
    assert.deepEqual(formatFailures([]), []);
  });

  it('turns a line into a GitHub annotation at the given level, on one line', () => {
    assert.equal(toAnnotation('warning', 'a\nb'), '::warning title=Lighthouse budget::a b');
    assert.equal(toAnnotation('error', 'x'), '::error title=Lighthouse budget::x');
  });
});

describe('run.sh guards', () => {
  const repoRoot = join(here, '..');
  let dist;
  before(() => {
    dist = mkdtempSync(join(tmpdir(), 'lh-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(join(dist, 'landing.html'), '<!doctype html>');
  });
  after(() => rmSync(dist, { recursive: true, force: true }));

  const run = (env) => spawnSync('bash', ['scripts/lighthouse/run.sh'], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } });

  it('refuses an unknown STATS_MODE', () => {
    const res = run({ STATS_MODE: 'bogus', DIST_DIR: dist });
    assert.equal(res.status, 1);
    assert.match(res.stdout, /STATS_MODE ska vara error eller mock/);
  });

  it('refuses to run without a built dist', () => {
    const res = run({ STATS_MODE: 'error', DIST_DIR: join(dist, 'saknas') });
    assert.equal(res.status, 1);
    assert.match(res.stdout, /index\.html saknas/);
  });

  // Utan landing.html faller / tillbaka på index.html: mätningen skulle då gälla laddningsvyn och inte den förrenderade landningen.
  it('refuses to measure / when the build has no prerendered landing page', () => {
    const bare = mkdtempSync(join(tmpdir(), 'lh-bare-'));
    try {
      writeFileSync(join(bare, 'index.html'), '<!doctype html>');
      const res = run({ STATS_MODE: 'error', DIST_DIR: bare });
      assert.equal(res.status, 1);
      assert.match(res.stdout, /landing\.html saknas/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  // spawnSync blockerar händelseslingan, så den upptagna servern måste leva i en egen process medan skriptet kör.
  it('refuses to measure while something else already answers on the API port', async () => {
    const busy = spawn(process.execPath, ['-e', "const s=require('node:http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const port = await new Promise((resolve) => busy.stdout.once('data', (d) => resolve(String(d).trim())));
      const res = run({ STATS_MODE: 'error', DIST_DIR: dist, API_PORT: port });
      assert.equal(res.status, 1);
      assert.match(res.stdout, /svarar redan på port/);
    } finally {
      busy.kill();
    }
  });
});

describe('install-caddy.sh', () => {
  it('reads the Caddy version from verify-static-serving.sh, so a changed format there fails here', () => {
    const res = spawnSync('bash', ['scripts/lighthouse/install-caddy.sh', '--print-version'], { cwd: join(here, '..'), encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });
});
