import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, type Plugin } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RoutePending } from '@/app-shell/RoutePending';
import { LANDING_MARKER, LOADER_MARKER, modeFromArgs, prerenderLanding } from '../../scripts/prerender-landing.mjs';

// Bygget av de två HTML-ingångarna (ADR 006, addendum 2026-10-19, punkt 1, 2 och 11): `vite build` följt av prerender-landing, med samma konfiguration som
// `npm run build`, mot en tillfällig utkatalog (public/ hoppas över, filmen är stor). Landningens rubrik, stegen och sifferraden prövas i sin modell och
// komponent; här prövas det som bara bygget kan: vad som hamnar i filerna, vad som inte gör det och när bygget ska falla.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const FRONTEND_DIR = '../..';
const frontend = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const BUILD_TIMEOUT_MS = 240_000;

/** Vad bygget vet om varje chunk: filen, importerna, CSS-filerna och modulerna den består av. Manifestet saknar modulerna för delade chunkar. */
interface ChunkInfo {
  fileName: string;
  facadeModuleId: string | null;
  imports: string[];
  css: string[];
  moduleIds: string[];
}

let workDir: string;
const chunksByBuild = new Map<string, ChunkInfo[]>();

function collectChunks(name: string): Plugin {
  return {
    name: 'collect-chunks',
    generateBundle(_options, bundle) {
      chunksByBuild.set(
        name,
        Object.values(bundle).flatMap((item) =>
          item.type === 'chunk'
            ? [
                {
                  fileName: item.fileName,
                  facadeModuleId: item.facadeModuleId,
                  imports: item.imports,
                  css: [...(item.viteMetadata?.importedCss ?? [])],
                  moduleIds: Object.keys(item.modules),
                },
              ]
            : [],
        ),
      );
    },
  };
}

async function buildApp(name: string, appEnv: string): Promise<string> {
  vi.stubEnv('VITE_APP_ENV', appEnv);
  const distDir = join(workDir, name);
  await build({ root: frontend, logLevel: 'silent', publicDir: false, plugins: [collectChunks(name)], build: { outDir: distDir, emptyOutDir: true } });
  await prerenderLanding({ root: frontend, distDir });
  return distDir;
}

const read = (distDir: string, file: string) => readFileSync(join(distDir, file), 'utf8');
const normalize = (path: string) => path.replace(/\\/g, '/');

/** Innehållet i `<div id="root">…</div>`: allt fram till den `</div>` som följs av filens slut (Vite lägger modulskripten i head). */
function rootMarkup(html: string): string {
  const start = html.indexOf('<div id="root">');
  expect(start, 'en #root').toBeGreaterThan(-1);
  const inner = html.slice(start + '<div id="root">'.length);
  const end = inner.search(/<\/div>\s*<\/body>/);
  expect(end, 'rotens slut').toBeGreaterThan(-1);
  return inner.slice(0, end);
}

const stylesheetHrefs = (html: string) => Array.from(html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="\/([^"]+)"/g), (match) => match[1]);
const stylesheetText = (dist: string, html: string) => stylesheetHrefs(html).map((href) => read(dist, href)).join('\n');

/** `start` och alla chunkar den laddar statiskt (import, inte import()). */
function staticClosure(name: string, start: ChunkInfo): ChunkInfo[] {
  const byFile = new Map(chunksByBuild.get(name)!.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const queue = [start.fileName];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...byFile.get(file)!.imports);
  }
  return [...seen].map((file) => byFile.get(file)!);
}

/** Landningens ingångschunk och allt den laddar statiskt. */
function landingClosure(name: string): ChunkInfo[] {
  const entry = chunksByBuild.get(name)!.find((chunk) => chunk.facadeModuleId?.endsWith('landing.html'));
  expect(entry, 'landningens ingångschunk').toBeDefined();
  return staticClosure(name, entry!);
}

const cssOf = (dist: string, chunks: ChunkInfo[]) => [...new Set(chunks.flatMap((chunk) => chunk.css))].map((file) => read(dist, file)).join('\n');
// Skalets överlagerregler i minifierad form: scrimmen och modalen är fasta lager. login.css har egna regler på .rq-modal.rq-login-dialog, så markören är grundreglerna.
const SCRIM_RULE = /\.rq-scrim\{[^}]*position:fixed/;
const MODAL_RULE = /\.rq-modal\{[^}]*position:fixed/;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rq-landing-build-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('the production build', () => {
  let dist: string;
  beforeAll(async () => {
    dist = await buildApp('prod', '');
  }, BUILD_TIMEOUT_MS);

  it('landing.html has the headline, the sample pack, four steps and three dashes in #root, and a stylesheet link in the head', () => {
    const html = read(dist, 'landing.html');
    const root = rootMarkup(html);
    // Rubriken bryts med <br> och har ett guldord i en span: läs texten, inte märkningen.
    const headline = /<h1\b[^>]*id="landing-title"[^>]*>([\s\S]*?)<\/h1>/.exec(root)?.[1] ?? '';
    expect(headline.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).toBe('Your group chat deserves a leaderboard');
    expect(root).toContain('Sample pack');
    expect(root.match(/<h3\b[^>]*>(?:Log the run|Earn XP|Keep the streak|Take the title)<\/h3>/g)).toHaveLength(4);
    // Sifferraden: servern har inget svar, så alla tre talen står som tankstreck (previewns "ingen förändring"-pilar är också tankstreck, därför avgränsas raden).
    const stats = /<section class="rq-landing-stats"[\s\S]*?<\/section>/.exec(root)?.[0] ?? '';
    expect(stats.match(/>—</g)).toHaveLength(3);
    expect(root).not.toContain(LANDING_MARKER);
    expect(stylesheetHrefs(html.slice(0, html.indexOf('</head>'))).length).toBeGreaterThan(0);
  });

  it('dist holds no server bundle: no SSR entry, no server renderer in any script', () => {
    const files = (readdirSync(dist, { recursive: true }) as string[]).map(normalize);
    expect(files.filter((file) => /ssr/i.test(file) || file.endsWith('.mjs'))).toEqual([]);
    const scripts = files.filter((file) => file.endsWith('.js')).map((file) => ({ file, text: read(dist, file) }));
    expect(scripts.length).toBeGreaterThan(5);
    const serverCode = /renderToString|renderToStaticMarkup|renderLanding|renderLoader/;
    expect(scripts.filter(({ text }) => serverCode.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it('the landing entry loads neither the app pages nor the tour, and landing.html preloads nothing outside its own graph', () => {
    const closure = landingClosure('prod');
    const modules = closure.flatMap((chunk) => chunk.moduleIds).map(normalize);
    expect(modules.filter((id) => /\/src\/pages\/(?:Board|Titles|Duels|Events|News|Log|Profile|Runner|Badges)Page/.test(id))).toEqual([]);
    expect(modules.filter((id) => id.includes('/node_modules/driver.js/'))).toEqual([]);
    expect(modules.filter((id) => /\/src\/(?:routes|App)\.tsx$/.test(id))).toEqual([]);
    // Och själva landningen finns med, annars bevisar tomma sökträffar ingenting.
    expect(modules.some((id) => id.endsWith('/features/landing/components/LandingScreen.tsx'))).toBe(true);

    const html = read(dist, 'landing.html');
    const preloaded = Array.from(html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="\/([^"]+)"/g), (match) => match[1]);
    const known = new Set(closure.map((chunk) => chunk.fileName));
    expect(preloaded.filter((file) => !known.has(file))).toEqual([]);
  });

  it("landing.html's stylesheets carry the loading view's rule but none of the shell's layout rules", () => {
    const css = stylesheetText(dist, read(dist, 'landing.html'));
    expect(css).toContain('.rq-shell__pending');
    expect(css).not.toContain('.rq-header');
    expect(css).not.toContain('.rq-shell__top');
  });

  it("the lazy sign-in dialog brings the overlay layer (.rq-scrim, .rq-modal) with it; the first visit's CSS does not carry it", () => {
    const dialog = chunksByBuild.get('prod')!.find((chunk) => chunk.moduleIds.some((id) => normalize(id).endsWith('/features/auth/components/LoginDialog.tsx')));
    expect(dialog, 'dialogens chunk').toBeDefined();
    expect(landingClosure('prod').map((chunk) => chunk.fileName)).not.toContain(dialog!.fileName);

    const dialogCss = cssOf(dist, staticClosure('prod', dialog!));
    expect(dialogCss).toMatch(SCRIM_RULE);
    expect(dialogCss).toMatch(MODAL_RULE);
    const firstVisitCss = cssOf(dist, landingClosure('prod'));
    expect(firstVisitCss).not.toMatch(SCRIM_RULE);
    expect(firstVisitCss).not.toMatch(MODAL_RULE);
  });

  it('#root in index.html is exactly the loading view, with no landing text and no marker left', () => {
    const html = read(dist, 'index.html');
    expect(rootMarkup(html)).toBe(renderToStaticMarkup(createElement(RoutePending)));
    expect(html).not.toContain(LOADER_MARKER);
    expect(html).not.toContain('Sample pack');
  });

  it('index.html links the stylesheet that carries the loading view, so it can paint before any script runs', () => {
    expect(stylesheetText(dist, read(dist, 'index.html'))).toContain('.rq-shell__pending');
  });

  it('a production build has no noindex and no staging banner in either file', () => {
    for (const file of ['index.html', 'landing.html']) {
      expect(read(dist, file)).not.toContain('name="robots"');
      expect(read(dist, file)).not.toContain('Staging environment');
    }
  });
});

describe('the staging build', () => {
  it('puts noindex in both files and the banner in landing.html only', async () => {
    const dist = await buildApp('staging', 'staging');
    for (const file of ['index.html', 'landing.html']) {
      expect(read(dist, file)).toContain('<meta name="robots" content="noindex, nofollow">');
    }
    expect(rootMarkup(read(dist, 'landing.html'))).toContain('Staging environment');
    expect(rootMarkup(read(dist, 'index.html'))).not.toContain('Staging environment');
  }, BUILD_TIMEOUT_MS);
});

describe('the build guards', () => {
  const page = (root: string) => `<!doctype html><html lang="en"><head></head><body>${root}</body></html>`;

  /** En minimal dist med de två filerna; guarden prövas utan ett helt bygge eftersom markörerna kontrolleras före SSR-steget. */
  function fakeDist(name: string, files: { index: string; landing: string }): string {
    const dist = join(workDir, name);
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), page(files.index));
    writeFileSync(join(dist, 'landing.html'), page(files.landing));
    return dist;
  }
  const inRoot = (marker: string) => `<div id="root">${marker}</div>`;

  it('fails when the loader marker is missing from index.html', async () => {
    const distDir = fakeDist('no-loader-marker', { index: inRoot(''), landing: inRoot(LANDING_MARKER) });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(LOADER_MARKER);
  });

  it('fails when the landing marker is missing from landing.html', async () => {
    const distDir = fakeDist('no-landing-marker', { index: inRoot(LOADER_MARKER), landing: inRoot('') });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(LANDING_MARKER);
  });

  it('fails when a marker is outside #root', async () => {
    const distDir = fakeDist('marker-outside-root', { index: `${LOADER_MARKER}<div id="root"></div>`, landing: inRoot(LANDING_MARKER) });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(LOADER_MARKER);
  });

  it.each([
    [undefined, 'production'],
    ['development', 'development'],
  ])('builds the server render in the mode it is given (%s), the way the client build was run', async (mode, expected) => {
    const distDir = fakeDist(`mode-${mode ?? 'default'}`, { index: inRoot(LOADER_MARKER), landing: inRoot(LANDING_MARKER) });
    await prerenderLanding({ root: frontend, distDir, ssrEntry: 'src/test/ssrMode.fixture.ts', mode });
    expect(readFileSync(join(distDir, 'landing.html'), 'utf8')).toContain(inRoot(expected));
  }, BUILD_TIMEOUT_MS);

  it.each([
    [['--mode', 'development'], 'development'],
    [['--mode=staging'], 'staging'],
    [['-m', 'development'], 'development'],
    [[], undefined],
    [['--other', 'x'], undefined],
  ])('reads the mode from the command line %j', (argv, expected) => {
    expect(modeFromArgs(argv)).toBe(expected);
  });

  it('fails the build when a landing module touches window at import, and removes its work directory', async () => {
    const distDir = fakeDist('window-at-import', { index: inRoot(LOADER_MARKER), landing: inRoot(LANDING_MARKER) });
    const cache = join(frontend, 'node_modules', '.cache');
    const leftovers = () => (existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith('rq-prerender-')) : []);
    const before = leftovers();

    await expect(prerenderLanding({ root: frontend, distDir, ssrEntry: 'src/test/ssrTouchesWindow.fixture.ts' })).rejects.toThrow(/window/);

    expect(leftovers()).toEqual(before);
    expect(readFileSync(join(distDir, 'landing.html'), 'utf8')).toContain(LANDING_MARKER);
  }, BUILD_TIMEOUT_MS);
});
