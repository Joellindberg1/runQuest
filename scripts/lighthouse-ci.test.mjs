// Test av Lighthouse-verktygen: det falska API:et, medianraden och felraderna i sammanfattningen, skriptets vakter och att budgeten är fäst.
// Körs med `node --test scripts/lighthouse-ci.test.mjs`. CI: frontend-jobbets egna steg "Lighthouse tooling" (en namngiven fil, inga
// beroenden, före npm ci); frontend-jobbet kör inte scripts/*.test.mjs som helhet.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockApi, MOCK_STATS } from './lighthouse/mock-api.mjs';
import { formatFailures, formatTable, median, summarizeLhrs, toAnnotation } from './lighthouse/summarize.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Ett skript som hänger sig ska fälla testet, inte blockera det för alltid; gränsen är så rymlig att last inte fäller ett friskt skript.
const SPAWN_TIMEOUT_MS = 120_000;

/** En port som är ledig just nu (bindningen släpps direkt). */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

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

const lhr = (url, { perf, fcp = 1000, lcp, cls = 0, tbt = 0, script, style, image = 0, total }) => ({
  finalDisplayedUrl: url,
  categories: {
    performance: { score: perf },
    accessibility: { score: 1 },
    'best-practices': { score: 1 },
    seo: { score: 1 },
  },
  audits: {
    'first-contentful-paint': { numericValue: fcp },
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
    lhr('http://127.0.0.1:18090/', { perf: 0.8, fcp: 1500, lcp: 3000, script: 100, style: 10, total: 500 }),
    lhr('http://127.0.0.1:18090/', { perf: 0.9, fcp: 2500, lcp: 4000, script: 300, style: 30, total: 900 }),
    lhr('http://127.0.0.1:18090/', { perf: 0.7, fcp: 6000, lcp: 9000, script: 200, style: 20, total: 700 }),
    lhr('http://127.0.0.1:18090/legal', { perf: 1, lcp: 1000, script: 50, style: 5, total: 100 }),
  ];

  it('takes the median per metric and page, so one slow run does not decide', () => {
    const [landing] = summarizeLhrs(runs);
    assert.equal(landing.url, 'http://127.0.0.1:18090/');
    assert.equal(landing.runs, 3);
    assert.equal(landing.categories.performance, 0.8);
    assert.equal(landing.fcp, 2500);
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
    assert.match(table, /\| Page \| Runs \| Perf \| A11y \| BP \| SEO \| FCP \(ms\) \| LCP \(ms\) \| CLS \| TBT \(ms\) \| JS \(kB\) \| CSS \(kB\) \| Total \(kB\) \|/);
    assert.match(table, /\/legal/);
  });

  it('shows the median first-contentful-paint of each page in the table', () => {
    const [landingLine] = formatTable(summarizeLhrs(runs)).split('\n').filter((l) => l.startsWith('| / |'));
    assert.match(landingLine, /\| 2500 \| 4000 \|/);
  });
});

describe('lighthouserc budget', () => {
  const rc = JSON.parse(readFileSync(join(here, 'lighthouse', 'lighthouserc.json'), 'utf8'));
  const { assertMatrix } = rc.ci.assert;
  const urlOf = (pathname) => rc.ci.collect.url.find((u) => new URL(u).pathname === pathname);
  const rowsFor = (pathname) => assertMatrix.filter((entry) => new RegExp(entry.matchingUrlPattern).test(urlOf(pathname)));

  // Tre räknade körningar per sida; uppvärmningen (run.sh, se "warms up ..." nedan) ligger utanför numberOfRuns och räknas inte. Medianen av ett udda antal är en verklig körning.
  it('measures the landing and /legal, three runs each', () => {
    assert.equal(rc.ci.collect.numberOfRuns, 3);
    assert.deepEqual(rc.ci.collect.url.map((u) => new URL(u).pathname), ['/', '/legal']);
  });

  // lhci vägrar blanda assertMatrix med assertions/aggregationMethod på toppnivån, och en sida som ingen rad matchar prövas inte alls.
  it('judges every page on the median, with exactly one rule set per page so no page escapes the budget', () => {
    assert.equal(rc.ci.assert.assertions, undefined);
    assert.equal(rc.ci.assert.aggregationMethod, undefined);
    for (const entry of assertMatrix) assert.equal(entry.aggregationMethod, 'median', entry.matchingUrlPattern);
    for (const url of rc.ci.collect.url) assert.equal(rowsFor(new URL(url).pathname).length, 1, `${url} ska matchas av exakt en regelrad`);
  });

  // BUDGETEN ÄR FÄST HÄR, per sida. Golven och taken nedan är budgeten (docs/release.md, "Lighthouse-budget"); lighthouserc.json får vara
  // lika med eller strängare, aldrig lättare. Det här testet får därför BARA ändras när budgeten SKÄRPS (högre golv, lägre tak).
  // Att lätta en gräns, ta bort en rad eller höja ett tak kräver ägarens uttryckliga ok, och ska stå i PR-beskrivningen.
  // Landningen (/) skärptes efter CI-mätningen i S7 (ADR 006 punkt 10); /legal delar inte landningens vikt och behåller sina rader,
  // utom LCP som fick taket uppmätt × 1,1.
  const PINNED = {
    '/': {
      floors: {
        'categories:performance': 0.9,
        'categories:accessibility': 0.95,
        'categories:best-practices': 0.9,
        'categories:seo': 0.95,
      },
      ceilings: {
        'largest-contentful-paint': 2500,
        'first-contentful-paint': 1950,
        'cumulative-layout-shift': 0.02,
        'total-blocking-time': 150,
        'resource-summary:script:size': 150000,
        'resource-summary:stylesheet:size': 30000,
        'resource-summary:total:size': 355000,
      },
    },
    '/legal': {
      floors: {
        'categories:performance': 0.75,
        'categories:accessibility': 0.95,
        'categories:best-practices': 0.9,
        'categories:seo': 0.95,
      },
      ceilings: {
        'largest-contentful-paint': 3600,
        'cumulative-layout-shift': 0.05,
        'total-blocking-time': 200,
        'resource-summary:script:size': 275000,
        'resource-summary:stylesheet:size': 50000,
        'resource-summary:total:size': 500000,
      },
    },
  };

  for (const [pathname, { floors, ceilings }] of Object.entries(PINNED)) {
    describe(`page ${pathname}`, () => {
      const assertions = () => rowsFor(pathname)[0].assertions;

      it('keeps every score floor at or above the pinned minimum', () => {
        for (const [name, floor] of Object.entries(floors)) {
          const minScore = assertions()[name]?.[1]?.minScore;
          assert.ok(typeof minScore === 'number' && minScore >= floor, `${pathname} ${name}: minScore ${minScore} är lättare än ${floor}`);
        }
      });

      it('keeps every ceiling at or below the pinned maximum', () => {
        for (const [name, ceiling] of Object.entries(ceilings)) {
          const max = assertions()[name]?.[1]?.maxNumericValue;
          assert.ok(typeof max === 'number' && max <= ceiling, `${pathname} ${name}: maxNumericValue ${max} är lättare än ${ceiling}`);
        }
      });

      it('has no budget line beyond the pinned ones, so a new line is a conscious change of this test', () => {
        assert.deepEqual(Object.keys(assertions()).sort(), [...Object.keys(floors), ...Object.keys(ceilings)].sort());
      });

      it('is not weakened into warnings: every budget line fails the run', () => {
        for (const [name, [level]] of Object.entries(assertions())) assert.equal(level, 'error', `${pathname} ${name}`);
      });
    });
  }
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

  // 0,0205 mot taket 0,02 ska aldrig se ut som "found 0.02, expected <= 0.02".
  it('keeps enough decimals that a failing value never looks equal to its limit', () => {
    const cls = { url: 'http://127.0.0.1:18090/', auditId: 'cumulative-layout-shift', name: 'maxNumericValue', operator: '<=', expected: 0.02, actual: 0.020512, passed: false };
    assert.deepEqual(formatFailures([cls]), ['/ cumulative-layout-shift maxNumericValue: found 0.0205, expected <= 0.02']);
    assert.deepEqual(formatFailures([{ ...cls, actual: 0.0200004 }]), ['/ cumulative-layout-shift maxNumericValue: found 0.0200004, expected <= 0.02']);
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

  const run = (env) => spawnSync('bash', ['scripts/lighthouse/run.sh'], { cwd: repoRoot, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, env: { ...process.env, ...env } });

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
  // Vakten är ett hårt fel oavsett läge: i blockerande läge (steget fäller jobbet) och i icke-blockerande (steget märks orange).
  for (const blocking of ['true', 'false']) {
    it(`refuses to measure / when the build has no prerendered landing page (LIGHTHOUSE_BLOCKING=${blocking})`, () => {
      const bare = mkdtempSync(join(tmpdir(), 'lh-bare-'));
      try {
        writeFileSync(join(bare, 'index.html'), '<!doctype html>');
        const res = run({ STATS_MODE: 'error', DIST_DIR: bare, LIGHTHOUSE_BLOCKING: blocking });
        assert.equal(res.status, 1);
        assert.match(res.stdout, /landing\.html saknas/);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });
  }

  // spawnSync blockerar händelseslingan, så den upptagna servern måste leva i en egen process medan skriptet kör.
  it('refuses to measure while something else already answers on the API port', async () => {
    const busy = spawn(process.execPath, ['-e', "const s=require('node:http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const port = await new Promise((resolve) => busy.stdout.once('data', (d) => resolve(String(d).trim())));
      // Portkollen väntar normalt 1 s på svar; under last kan även en redan lyssnande server svara senare än så.
      const res = run({ STATS_MODE: 'error', DIST_DIR: dist, API_PORT: port, PORT_PROBE_SECONDS: '15' });
      assert.equal(res.status, 1);
      assert.match(res.stdout, /svarar redan på port/);
    } finally {
      busy.kill();
    }
  });
});

// En Caddy och en lhci som bara finns till för att skriptet ska nå sidhämtningarna och mätstegen: Caddy svarar på /health och låter / eller /legal fela
// (felmeddelandet kan provas utan riktig Caddy), och lhci skriver falska rapporter och loggar sina anrop i calls.log (ordningen mellan uppvärmning och
// mätning kan provas utan Chrome).
describe('run.sh against a fake Caddy and a fake lhci', () => {
  const repoRoot = join(here, '..');
  const posix = (path) => path.replaceAll('\\', '/');
  let work;
  let dist;
  let ports;
  before(async () => {
    // Lediga portar i stället för 3001 och 18090: en annan process (ett lokalt backend, en samtidig Lighthouse-körning) som håller en av dem
    // fäller annars testet med "något svarar redan på port" fast det som prövas är sidhämtningen.
    ports = { api: await freePort(), serve: await freePort() };
    work = mkdtempSync(join(tmpdir(), 'lh-fetch-'));
    dist = join(work, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(join(dist, 'landing.html'), '<!doctype html>');
    // run.sh hittar lhci och sina grannar via sin egen katalog, så en kopia i work/lighthouse får en låtsas-lhci utan att repots node_modules behövs.
    mkdirSync(join(work, 'lighthouse', 'node_modules', '.bin'), { recursive: true });
    copyFileSync(join(repoRoot, 'scripts', 'lighthouse', 'run.sh'), join(work, 'lighthouse', 'run.sh'));
    copyFileSync(join(repoRoot, 'scripts', 'lighthouse', 'lighthouserc.json'), join(work, 'lighthouse', 'lighthouserc.json'));
    copyFileSync(join(repoRoot, 'scripts', 'lighthouse', 'summarize.mjs'), join(work, 'lighthouse', 'summarize.mjs'));
    // Den första insamlingen är den kalla: dess körningar har en TBT som skulle fälla budgeten om de räknades. Äkta lhci tömmer katalogen vid varje collect; den falska gör inte det,
    // så ett skript som lämnar uppvärmningens rapporter kvar syns i assert-raden.
    writeFileSync(
      join(work, 'lighthouse', 'fake-lhci.mjs'),
      [
        "import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';",
        'const [command, ...args] = process.argv.slice(2);',
        'const option = (name) => {',
        "  const i = args.findIndex((a) => a === '--' + name || a.startsWith('--' + name + '='));",
        '  if (i < 0) return undefined;',
        "  return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];",
        '};',
        "const config = JSON.parse(readFileSync(option('config'), 'utf8')).ci.collect;",
        "const calls = existsSync('calls.log') ? readFileSync('calls.log', 'utf8').split('\\n').filter(Boolean) : [];",
        "if (command === 'collect') {",
        "  const cold = !calls.some((c) => c.startsWith('collect'));",
        "  const runs = Number(option('numberOfRuns') ?? config.numberOfRuns);",
        '  if (cold && process.env.FAKE_WARMUP_FAILS) {',
        "    appendFileSync('calls.log', 'collect runs=' + runs + ' failed\\n');",
        '    process.exit(1);',
        '  }',
        "  mkdirSync('.lighthouseci', { recursive: true });",
        '  config.url.forEach((url, u) => {',
        '    for (let r = 0; r < runs; r++) {',
        "      const audits = { 'total-blocking-time': { numericValue: cold ? 5000 : 20 } };",
        "      const categories = Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map((c) => [c, { score: 1 }]));",
        "      writeFileSync('.lighthouseci/lhr-' + calls.length + '-' + u + '-' + r + '.json', JSON.stringify({ finalDisplayedUrl: url, categories, audits }));",
        '    }',
        '  });',
        "  appendFileSync('calls.log', 'collect runs=' + runs + ' urls=' + config.url.length + '\\n');",
        "} else if (command === 'assert') {",
        "  const lhrs = readdirSync('.lighthouseci').filter((f) => f.startsWith('lhr-')).map((f) => JSON.parse(readFileSync('.lighthouseci/' + f, 'utf8')));",
        "  const maxTbt = Math.max(...lhrs.map((l) => l.audits['total-blocking-time'].numericValue));",
        "  appendFileSync('calls.log', 'assert lhr=' + lhrs.length + ' maxTbt=' + maxTbt + '\\n');",
        '}',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(work, 'lighthouse', 'node_modules', '.bin', 'lhci'),
      `#!/usr/bin/env bash\nexec "${posix(process.execPath)}" "${posix(join(work, 'lighthouse', 'fake-lhci.mjs'))}" "$@"\n`,
    );
    chmodSync(join(work, 'lighthouse', 'node_modules', '.bin', 'lhci'), 0o755);
    copyFileSync(join(repoRoot, 'Caddyfile'), join(work, 'Caddyfile'));
    writeFileSync(
      join(work, 'fake-server.mjs'),
      `import { createServer } from 'node:http';
const pages = { '/health': 'ok', '/': '<h1 id="landing-title">x</h1>', '/legal': '<div class="rq-shell__pending"></div>' };
createServer((req, res) => {
  const failing = { root: '/', legal: '/legal' }[process.env.FAKE_FAILING_PAGE] === req.url;
  res.statusCode = failing || !(req.url in pages) ? 500 : 200;
  res.end(pages[req.url] ?? 'nope');
}).listen(Number(process.env.PORT), '127.0.0.1');
`,
    );
    writeFileSync(
      join(work, 'fake-caddy'),
      // cd /: servern får inte stå i work. På Windows går en katalog inte att radera medan en process har den som arbetskatalog, och servern kan leva en stund efter kill.
      `#!/usr/bin/env bash\nif [[ "$1" == "validate" ]]; then exit 0; fi\ncd /\nexec "${posix(process.execPath)}" "${posix(join(work, 'fake-server.mjs'))}"\n`,
    );
    chmodSync(join(work, 'fake-caddy'), 0o755);
  });
  after(() => rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  const run = (failingPage, extraEnv = {}) =>
    spawnSync('bash', ['lighthouse/run.sh'], {
      cwd: work,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      env: {
        ...process.env,
        STATS_MODE: 'error',
        DIST_DIR: posix(dist),
        CADDY_BIN: posix(join(work, 'fake-caddy')),
        FAKE_FAILING_PAGE: failingPage,
        ...extraEnv,
        API_PORT: String(ports.api),
        LHCI_SERVE_PORT: String(ports.serve),
        // Låtsasservern är en nystartad node-process: under last kan den ta många sekunder, och 50 försök räcker då inte.
        CADDY_WAIT_TRIES: '300',
      },
    });

  it('says that / could not be fetched instead of exiting without a word', () => {
    const res = run('root');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /FAIL .*\/ .*(svarade inte|kunde inte hämtas)/);
  });

  it('says that /legal could not be fetched instead of exiting without a word', () => {
    const res = run('legal');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /FAIL .*\/legal .*(svarade inte|kunde inte hämtas)/);
  });

  // Första körningen av / i jobbet är kall (Chrome och filcachen) och ger ibland TBT och prestanda långt över budgeten. En uppvärmning
  // (en körning av varje sida) tas före mätningen och kasseras, så att ingen kall körning hamnar bland de räknade.
  it('warms up with one uncounted run of every page before the counted runs', () => {
    rmSync(join(work, 'calls.log'), { force: true });
    rmSync(join(work, '.lighthouseci'), { recursive: true, force: true });
    const res = run('none');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(readFileSync(join(work, 'calls.log'), 'utf8').trim().split('\n'), ['collect runs=1 urls=2', 'collect runs=3 urls=2', 'assert lhr=6 maxTbt=20']);
    assert.match(res.stdout, /\| \/ \| 3 \|/);
    assert.match(res.stdout, /\| \/legal \| 3 \|/);
  });

  // Uppvärmningen är bara en bieffekt: ger den fel avgör de räknade körningarna, och felet göms inte.
  it('measures anyway when the warm-up run itself errors, and says so', () => {
    rmSync(join(work, 'calls.log'), { force: true });
    rmSync(join(work, '.lighthouseci'), { recursive: true, force: true });
    const res = run('none', { FAKE_WARMUP_FAILS: '1' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(readFileSync(join(work, 'calls.log'), 'utf8').trim().split('\n'), ['collect runs=1 failed', 'collect runs=3 urls=2', 'assert lhr=6 maxTbt=20']);
    assert.match(res.stdout, /Uppvärmningen gav fel/);
  });
});

describe('install-caddy.sh', () => {
  it('reads the Caddy version from verify-static-serving.sh, so a changed format there fails here', () => {
    const res = spawnSync('bash', ['scripts/lighthouse/install-caddy.sh', '--print-version'], { cwd: join(here, '..'), encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });
});
