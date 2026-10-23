// Sammanfattar Lighthouse-körningarna (median per sida) som en tabell i loggen och i körningens sammanfattning (GITHUB_STEP_SUMMARY).
// Budgeten prövas av `lhci assert`; den här tabellen är till för att se hur långt under taket sidan ligger och för att kalibrera budgeten.
// Körs: node scripts/lighthouse/summarize.mjs [katalog med lhr-*.json]   (standard .lighthouseci)
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const BYTE_TYPES = ['script', 'stylesheet', 'image', 'total'];

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const audit = (lhr, id) => lhr.audits[id]?.numericValue ?? 0;
const bytesOf = (lhr, type) => lhr.audits['resource-summary']?.details?.items?.find((i) => i.resourceType === type)?.transferSize ?? 0;

/** En rad per sida (i den ordning sidorna först förekommer) med medianen av varje mått över körningarna. */
export function summarizeLhrs(lhrs) {
  const byUrl = new Map();
  for (const lhr of lhrs) {
    const url = lhr.finalDisplayedUrl ?? lhr.requestedUrl;
    byUrl.set(url, [...(byUrl.get(url) ?? []), lhr]);
  }
  return [...byUrl].map(([url, runs]) => ({
    url,
    runs: runs.length,
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, median(runs.map((r) => r.categories[c]?.score ?? 0))])),
    fcp: median(runs.map((r) => audit(r, 'first-contentful-paint'))),
    lcp: median(runs.map((r) => audit(r, 'largest-contentful-paint'))),
    cls: median(runs.map((r) => audit(r, 'cumulative-layout-shift'))),
    tbt: median(runs.map((r) => audit(r, 'total-blocking-time'))),
    bytes: Object.fromEntries(BYTE_TYPES.map((t) => [t, median(runs.map((r) => bytesOf(r, t)))])),
  }));
}

const kb = (bytes) => (bytes / 1000).toFixed(1);

export function formatTable(rows) {
  const lines = [
    '| Page | Runs | Perf | A11y | BP | SEO | FCP (ms) | LCP (ms) | CLS | TBT (ms) | JS (kB) | CSS (kB) | Total (kB) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const c = r.categories;
    lines.push(
      `| ${new URL(r.url).pathname} | ${r.runs} | ${c.performance} | ${c.accessibility} | ${c['best-practices']} | ${c.seo} | ${Math.round(r.fcp)} | ${Math.round(r.lcp)} | ${r.cls.toFixed(3)} | ${Math.round(r.tbt)} | ${kb(r.bytes.script)} | ${kb(r.bytes.stylesheet)} | ${kb(r.bytes.total)} |`,
    );
  }
  return lines.join('\n');
}

/** Minst tre decimaler och tre gällande siffror, och fler om avrundningen annars gör ett fällt värde lika med gränsen (CLS 0,0205 mot taket 0,02). */
const roundVisible = (actual, expected) => {
  const significant = actual === 0 ? 3 : 2 - Math.floor(Math.log10(Math.abs(actual)));
  for (let decimals = Math.min(Math.max(3, significant), 7); decimals < 8; decimals++) {
    const rounded = Math.round(actual * 10 ** decimals) / 10 ** decimals;
    if (rounded !== Number(expected)) return rounded;
  }
  return actual;
};

/** En läsbar rad per budgetrad som inte hölls, ur lhci:s assertion-results.json: sida, rad, uppmätt värde och gräns. */
export function formatFailures(results) {
  return results
    .filter((r) => !r.passed)
    .map((r) => {
      const line = r.auditProperty ? `${r.auditId}.${r.auditProperty}` : r.auditId;
      return `${new URL(r.url).pathname} ${line} ${r.name}: found ${roundVisible(r.actual, r.expected)}, expected ${r.operator} ${r.expected}`;
    });
}

/** GitHub Actions-anteckning (syns i PR:en) på en rad. */
export function toAnnotation(level, text) {
  return `::${level} title=Lighthouse budget::${text.replace(/[\r\n]+/g, ' ')}`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

// node summarize.mjs --failures <katalog> <warning|error>: skriver felraderna (som anteckningar i GitHub Actions, annars som vanlig text).
if (isMain && process.argv[2] === '--failures') {
  const [dir, level = 'error'] = process.argv.slice(3);
  const results = JSON.parse(readFileSync(join(dir, 'assertion-results.json'), 'utf8'));
  for (const line of formatFailures(results)) console.log(process.env.GITHUB_ACTIONS === 'true' ? toAnnotation(level, line) : line);
} else if (isMain) {
  const dir = process.argv[2] ?? '.lighthouseci';
  const lhrs = readdirSync(dir)
    .filter((f) => /^lhr-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  if (lhrs.length === 0) {
    console.error(`Inga lhr-*.json i ${dir}`);
    process.exit(1);
  }
  const table = formatTable(summarizeLhrs(lhrs));
  console.log(`Median per sida:\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Lighthouse (median per sida)\n\n${table}\n`);
}
