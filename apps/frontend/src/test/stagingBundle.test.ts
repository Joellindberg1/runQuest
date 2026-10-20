import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Prodbundlen får aldrig bära stagingbannern (landningens Lighthouse-budget): bygget av hela appen utan VITE_APP_ENV ska sakna bannerns kod och CSS,
// och stagingbygget ska ha dem (annars bevisar tomma sökträffar ingenting). Samma konfiguration som `npm run build`; public/ hoppas över (filmen är stor).

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const FRONTEND_DIR = '../..';
const frontend = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const BUILD_TIMEOUT_MS = 120_000;
// Tokenen --rq-staging-banner-h finns med flit i prodens CSS (värdet 0), så markörerna är bannerns text och dess klasser, aldrig tokenens namn.
const BANNER_MARKERS = /Staging environment|rq-staging-banner__|\.rq-staging-banner[{\s,]/;

let workDir: string;

async function buildApp(name: string, appEnv: string | undefined): Promise<string> {
  if (appEnv !== undefined) vi.stubEnv('VITE_APP_ENV', appEnv);
  else vi.stubEnv('VITE_APP_ENV', '');
  const outDir = join(workDir, name);
  await build({ root: frontend, logLevel: 'silent', publicDir: false, build: { outDir, emptyOutDir: true } });
  return outDir;
}

/** Namnen på de byggda filer vars innehåll bär någon av markörerna. */
function filesWithBanner(dir: string): string[] {
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((file) => /\.(js|css|html)$/.test(file));
  return files.filter((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    return BANNER_MARKERS.test(text);
  });
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rq-staging-bundle-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('the staging banner in the built bundle', () => {
  it('a production build contains no banner code and no banner styles', async () => {
    const dist = await buildApp('prod', undefined);
    expect(filesWithBanner(dist)).toEqual([]);
  }, BUILD_TIMEOUT_MS);

  it('a staging build ships the banner code and its styles', async () => {
    const dist = await buildApp('staging', 'staging');
    const found = filesWithBanner(dist);
    expect(found.some((file) => file.endsWith('.js'))).toBe(true);
    expect(found.some((file) => file.endsWith('.css'))).toBe(true);
  }, BUILD_TIMEOUT_MS);
});
