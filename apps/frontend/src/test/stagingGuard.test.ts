import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import viteConfig from '../../vite.config';
import { stagingGuard, STAGING_ROBOTS_TXT } from '../../stagingGuard';

// Stagingskyddet vid bygget: noindex-metan och en robots.txt som blockerar allt, bara när miljön är staging. Provet bygger ett litet projekt
// med den riktiga index.html, robots.txt och sitemap.xml som indata, i båda lägena, så att prodbyggets filer visas oförändrade.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const FRONTEND_DIR = '../..';
const frontend = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const sourceIndexHtml = readFileSync(join(frontend, 'index.html'), 'utf8');
const sourceRobotsTxt = readFileSync(join(frontend, 'public', 'robots.txt'), 'utf8');

const NOINDEX = '<meta name="robots" content="noindex, nofollow">';

let workDir: string;

/** Bygger fixturen med skyddet inställt på `appEnv` och returnerar utkatalogen. */
async function buildFixture(name: string, appEnv: string | undefined): Promise<string> {
  const root = join(workDir, name);
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(join(root, 'index.html'), sourceIndexHtml.replace('/src/main.tsx', '/main.js'));
  writeFileSync(join(root, 'main.js'), 'console.log("fixture");\n');
  cpSync(join(frontend, 'public', 'robots.txt'), join(root, 'public', 'robots.txt'));
  cpSync(join(frontend, 'public', 'sitemap.xml'), join(root, 'public', 'sitemap.xml'));
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [stagingGuard(appEnv)],
    build: { outDir: join(root, 'dist'), emptyOutDir: true },
  });
  return join(root, 'dist');
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rq-staging-guard-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('the staging guard at build time', () => {
  it('a staging build tells search engines not to index and blocks every crawler in robots.txt', async () => {
    const dist = await buildFixture('staging', 'staging');
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(html).toContain(NOINDEX);
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toBe(STAGING_ROBOTS_TXT);
    expect(STAGING_ROBOTS_TXT).toMatch(/^User-agent: \*\nDisallow: \/\n$/);
    expect(existsSync(join(dist, 'sitemap.xml'))).toBe(false);
  });

  it.each([
    ['no environment set', undefined],
    ['an empty environment', ''],
    ['production', 'production'],
    ['a value that only resembles staging', 'staging-preview'],
  ])('a build with %s keeps index.html and robots.txt as they are', async (name, appEnv) => {
    const dist = await buildFixture(name.replace(/\W+/g, '-'), appEnv);
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(html).not.toMatch(/noindex/i);
    expect(html).toContain('<link rel="canonical" href="https://www.runquest.dev/" />');
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toBe(sourceRobotsTxt);
    expect(existsSync(join(dist, 'sitemap.xml'))).toBe(true);
  });
});

// Kopplingen: bygget läser VITE_APP_ENV ur miljön och ger både pluginen och den konstant som bannern i App.tsx grenar på.
describe('the build configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const resolveConfig = async (appEnv: string | undefined) => {
    if (appEnv !== undefined) vi.stubEnv('VITE_APP_ENV', appEnv);
    const factory = viteConfig as unknown as (env: { command: string; mode: string }) => Promise<{ define: Record<string, string>; plugins: { name: string; transformIndexHtml?: unknown }[] }>;
    return factory({ command: 'build', mode: 'production' });
  };

  it('a staging environment variable turns on the guard and the banner constant', async () => {
    const config = await resolveConfig('staging');
    expect(config.define['import.meta.env.VITE_APP_ENV']).toBe('"staging"');
    expect(config.plugins.find((plugin) => plugin.name === 'rq-staging-guard')?.transformIndexHtml).toBeDefined();
  });

  it('without the variable the guard does nothing and the banner constant is empty', async () => {
    const config = await resolveConfig(undefined);
    expect(config.define['import.meta.env.VITE_APP_ENV']).toBe('""');
    expect(config.plugins.find((plugin) => plugin.name === 'rq-staging-guard')?.transformIndexHtml).toBeUndefined();
  });
});
