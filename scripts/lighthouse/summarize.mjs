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
    '| Page | Runs | Perf | A11y | BP | SEO | LCP (ms) | CLS | TBT (ms) | JS (kB) | CSS (kB) | Total (kB) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const c = r.categories;
    lines.push(
      `| ${new URL(r.url).pathname} | ${r.runs} | ${c.performance} | ${c.accessibility} | ${c['best-practices']} | ${c.seo} | ${Math.round(r.lcp)} | ${r.cls.toFixed(3)} | ${Math.round(r.tbt)} | ${kb(r.bytes.script)} | ${kb(r.bytes.stylesheet)} | ${kb(r.bytes.total)} |`,
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
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
