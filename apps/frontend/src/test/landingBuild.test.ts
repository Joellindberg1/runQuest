import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, type Plugin } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RoutePending } from '@/app-shell/RoutePending';
import { StagingBanner } from '@/app-shell/StagingBanner';
import { sessionHintScript } from '@/landing-entry/sessionHint';
import { forbiddenInLanding } from './landingGraphGuard';
import { LANDING_MARKER, LOADER_MARKER, LOADER_PHASE_MARKER, SESSION_HINT_MARKER, modeFromArgs, prerenderLanding } from '../../scripts/prerender-landing.mjs';

// Bygget av de två HTML-ingångarna (ADR 006, addendum 2026-10-19, punkt 1, 2 och 11): `vite build` följt av prerender-landing, med samma konfiguration som
// `npm run build`, mot en tillfällig utkatalog (public/ hoppas över, filmen är stor). Landningens rubrik, stegen och sifferraden prövas i sin modell och
// komponent; här prövas det som bara bygget kan: vad som hamnar i filerna, vad som inte gör det och när bygget ska falla.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const FRONTEND_DIR = '../..';
const frontend = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const BUILD_TIMEOUT_MS = 240_000;

/** Vad bygget vet om varje chunk: filen, de statiska och dynamiska importerna, CSS-filerna och modulerna den består av. Manifestet saknar modulerna för delade chunkar. */
interface ChunkInfo {
  fileName: string;
  facadeModuleId: string | null;
  imports: string[];
  dynamicImports: string[];
  css: string[];
  moduleIds: string[];
}

let workDir: string;
const chunksByBuild = new Map<string, ChunkInfo[]>();
const builtDists = new Map<string, string>();

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
                  dynamicImports: item.dynamicImports,
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
  builtDists.set(name, distDir);
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

/** Skripten utan `src` i filen, med var de börjar och vad de innehåller. Modulskriptet och andra skript med `src` är inte inline. */
function inlineScripts(html: string): Array<{ index: number; body: string }> {
  return Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))
    .filter((match) => !/\bsrc=/.test(match[1]))
    .map((match) => ({ index: match.index, body: match[2] }));
}

/** Var i filen det första av mönstren dyker upp; -1 om inget gör det. */
const firstIndexOf = (html: string, patterns: RegExp[]) => Math.min(...patterns.map((pattern) => html.search(pattern)).filter((index) => index >= 0));

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

/** Landningens boot-skript: den enda modulskript-taggen i landing.html, och de JS-filer det startar (ingången och dess förladdningar, som adresser i dess text). */
function bootScript(distDir: string, html: string): { file: string; modulesInHtml: number; starts: string[] } {
  const modules = Array.from(html.matchAll(/<script\b(?=[^>]*type="module")[^>]*\bsrc="\/([^"]+)"[^>]*><\/script>/g), (match) => match[1]);
  const file = modules[0] ?? '';
  const starts = file ? Array.from(read(distDir, file).matchAll(/"\/(assets\/[^"]+\.js)"/g), (match) => match[1]) : [];
  return { file, modulesInHtml: modules.length, starts };
}

/** Landningens JS-filer som finns i dist: grafen minus chunkar Vite tar bort (temat är en ren CSS-chunk, dess JS-fil skrivs aldrig). */
const landingScriptFiles = (name: string, distDir: string) =>
  landingClosure(name)
    .map((chunk) => chunk.fileName)
    .filter((file) => existsSync(join(distDir, file)))
    .sort();

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

  it('landing.html has exactly two inline scripts: the session hint in the head, then the theme script from the provider in #root', () => {
    const html = read(dist, 'landing.html');
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(2);
    expect(scripts[0].body).toBe(sessionHintScript());
    expect(scripts[0].index).toBeLessThan(html.indexOf('</head>'));
    expect(scripts[1].index).toBeGreaterThan(html.indexOf('<div id="root">'));
    expect(html).not.toContain(SESSION_HINT_MARKER);
  });

  it('the session hint stands before every stylesheet, preload and module script in landing.html, so it runs before the first paint', () => {
    const html = read(dist, 'landing.html');
    const hint = inlineScripts(html)[0].index;
    const firstResource = firstIndexOf(html, [/<link\b[^>]*rel="(?:stylesheet|modulepreload|preload)"/, /<script\b[^>]*\bsrc=/]);
    expect(firstResource, 'ett första stilmall, förladdning eller modulskript').toBeGreaterThan(-1);
    expect(hint).toBeLessThan(firstResource);
  });

  it('index.html has no session hint: the app itself never redirects away from itself', () => {
    const html = read(dist, 'index.html');
    expect(html).not.toContain(sessionHintScript());
    expect(html).not.toContain(SESSION_HINT_MARKER);
  });

  it('dist holds no server bundle: no SSR entry, no server renderer in any script', () => {
    const files = (readdirSync(dist, { recursive: true }) as string[]).map(normalize);
    expect(files.filter((file) => /ssr/i.test(file) || file.endsWith('.mjs'))).toEqual([]);
    const scripts = files.filter((file) => file.endsWith('.js')).map((file) => ({ file, text: read(dist, file) }));
    expect(scripts.length).toBeGreaterThan(5);
    const serverCode = /renderToString|renderToStaticMarkup|renderLanding|renderLoader/;
    expect(scripts.filter(({ text }) => serverCode.test(text)).map(({ file }) => file)).toEqual([]);
  });

  // Importgrafsvakten (ADR 006, addendum 2026-10-19, S4 punkt 4; utökad i addendum 2026-10-26, punkt 6): vad som inte får finnas ligger som mönster i landingGraphGuard.ts,
  // och landingGraphGuard.test.ts + fixturerna längre ned visar att listan fäller.
  it('the landing entry reaches none of the forbidden modules: the app pages, the tour, the popup, the position charts and view, the read-only badge card', () => {
    const closure = landingClosure('prod');
    const modules = closure.flatMap((chunk) => chunk.moduleIds).map(normalize);
    expect(forbiddenInLanding(modules)).toEqual([]);
    // Och själva landningen finns med, annars bevisar tomma sökträffar ingenting.
    expect(modules.some((id) => id.endsWith('/features/landing/components/LandingScreen.tsx'))).toBe(true);
  });

  // Lazy-gränserna ur bygget (ADR 006, addendum 2026-10-26, punkt 1 och 6): popupen och positionskomponenterna ligger i chunkar som något laddar med import(), och ingen chunk i
  // någon av ingångarnas statiska graf har dem. Landningens boot-skript startar exakt landningens graf (provet ovan), så landningen täcks av samma sak. Manifestet
  // (build.manifest) skrivs inte i dag; bygget läses som i provet ovan, ur Rollups bunt, som ger samma importlistor och dessutom modulerna.
  const LAZY_COMPONENTS = [
    'features/runner/components/RunnerPopup.tsx',
    'features/runner/components/PopupSections.tsx',
    'features/runner/components/PopupBadgesPanel.tsx',
    'features/runner/components/PopupTitlesPanel.tsx',
    'features/runner/components/PopupBanner.tsx',
    'features/runner/components/HeadToHeadBanner.tsx',
    'features/leaderboard/components/PositionView.tsx',
    'features/leaderboard/components/PackPositionChart.tsx',
    'features/leaderboard/components/PositionChartCard.tsx',
    'features/profile/components/PositionPanel.tsx',
    'features/profile/components/PositionChart.tsx',
  ];
  const entryChunks = () => chunksByBuild.get('prod')!.filter((chunk) => /\/(?:index|landing)\.html$/.test(normalize(chunk.facadeModuleId ?? '')));
  const holdersOf = (component: string) => chunksByBuild.get('prod')!.filter((chunk) => chunk.moduleIds.some((id) => normalize(id).endsWith(`/src/${component}`)));

  it('the runner popup and the position components sit in lazy chunks that neither entry loads statically', () => {
    const entries = entryChunks();
    expect(entries, 'ingångschunkarna för index.html och landing.html').toHaveLength(2);
    const loadedByEntries = new Set(entries.flatMap((entry) => staticClosure('prod', entry)).map((chunk) => chunk.fileName));
    const importedLazily = new Set(chunksByBuild.get('prod')!.flatMap((chunk) => chunk.dynamicImports));
    for (const component of LAZY_COMPONENTS) {
      const holders = holdersOf(component);
      expect(holders, `${component} ligger i exakt en chunk`).toHaveLength(1);
      expect(loadedByEntries.has(holders[0].fileName), `${component} (${holders[0].fileName}) har en statisk importör i en ingångs-chunk`).toBe(false);
      expect(importedLazily.has(holders[0].fileName), `${component} (${holders[0].fileName}) laddas inte med import() av någon chunk`).toBe(true);
    }
  });

  it("the position views' stylesheets sit in their lazy chunks: neither entry links them", () => {
    const entryCss = new Set(entryChunks().flatMap((entry) => staticClosure('prod', entry)).flatMap((chunk) => chunk.css));
    const lazyCss = (component: string) => holdersOf(component).flatMap((chunk) => chunk.css);
    for (const [component, marker] of [
      ['features/leaderboard/components/PositionView.tsx', /\.rq-board-position\b/],
      ['features/profile/components/PositionChart.tsx', /\.rq-profile-position\b/],
    ] as const) {
      const own = lazyCss(component);
      expect(own.length, `${component} bär en egen stilmall`).toBeGreaterThan(0);
      expect(own.filter((file) => entryCss.has(file))).toEqual([]);
      expect(own.map((file) => read(dist, file)).join('\n')).toMatch(marker);
      expect([...entryCss].map((file) => read(dist, file)).join('\n')).not.toMatch(marker);
    }
  });

  // Ingångsmodulen och dess förladdningar hämtas först efter första ritningen (RUN-343, deferLandingEntry.ts). HTML-filen bär bara ett litet boot-skript; boot-skriptet
  // ska starta exakt landningens egen graf: tappas en chunk hydreras landningen aldrig, och en extra chunk vore en förladdning utanför grafen.
  it('landing.html has one module script, the boot script, and no modulepreload link; the boot script starts the landing entry and exactly its own graph', () => {
    const html = read(dist, 'landing.html');
    expect(html).not.toMatch(/<link\b[^>]*rel="modulepreload"/);
    const boot = bootScript(dist, html);
    expect(boot.modulesInHtml).toBe(1);
    expect(boot.file).toMatch(/^assets\/landing-boot-[\w-]+\.js$/);

    const closure = landingClosure('prod');
    const entry = closure.find((chunk) => chunk.facadeModuleId?.endsWith('landing.html'))!;
    expect(boot.starts).toContain(entry.fileName);
    expect([...boot.starts].sort()).toEqual(landingScriptFiles('prod', dist));
    for (const file of boot.starts) expect(existsSync(join(dist, file)), `${file} finns i dist`).toBe(true);
  });

  it('index.html keeps its module script and preloads in the HTML: only the landing defers its entry', () => {
    const html = read(dist, 'index.html');
    expect(html).toMatch(/<link\b[^>]*rel="modulepreload"/);
    expect(html).toMatch(/<script\b[^>]*type="module"[^>]*\bsrc="\/assets\/index-[\w-]+\.js"/);
    expect(html).not.toContain('landing-boot');
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

  // Kaskadordningen (RUN-331, integrationskritiken): före S4 låg temat (index.css: Tailwind, tokens, den globala fokusringen) sist i appens enda stilmall, efter
  // vendor- och feature-CSS. Med två HTML-ingångar delas index.css, och Rollup lägger delade moduler i en egen fil som länkas före ingångens egen CSS: då vann
  // driver.js egna `all: unset` över temats `:focus-visible` (lika specificitet, senare regel vinner) och tourens stängknapp tappade sin fokusring. Provet läser
  // byggets länkordning, inte källan: det är ordningen i dist som avgör kaskaden.
  describe('the cascade order of the linked stylesheets', () => {
    const THEME_RULE = /(?:^|[,}])\s*:focus-visible\s*\{[^}]*--rq-focus-ring/;
    const VENDOR_RULE = /\.driver-popover-close-btn\s*\{[^}]*all:\s*unset/;
    const linked = (file: string) => stylesheetHrefs(read(dist, file)).map((href) => ({ href, css: read(dist, href) }));

    it('index.html links the theme stylesheet after the vendor and feature CSS it used to override', () => {
      const sheets = linked('index.html');
      const themeAt = sheets.findIndex((sheet) => THEME_RULE.test(sheet.css));
      const vendorAt = sheets.findIndex((sheet) => VENDOR_RULE.test(sheet.css));
      expect(sheets.filter((sheet) => THEME_RULE.test(sheet.css))).toHaveLength(1);
      expect(vendorAt, 'driver.js CSS ligger i en länkad stilmall').toBeGreaterThanOrEqual(0);
      expect(themeAt).toBe(sheets.length - 1);
      expect(vendorAt).toBeLessThan(themeAt);
    });

    it('landing.html links the theme stylesheet first, before the landing CSS, as the landing has always had it', () => {
      const sheets = linked('landing.html');
      expect(sheets.length).toBeGreaterThan(1);
      expect(THEME_RULE.test(sheets[0].css)).toBe(true);
      expect(sheets.slice(1).filter((sheet) => THEME_RULE.test(sheet.css))).toEqual([]);
    });

    it("the tour's close button gets the theme's focus ring whatever the order, because its own rule is more specific than driver.js's", () => {
      const theme = linked('index.html').find((sheet) => THEME_RULE.test(sheet.css))!.css;
      expect(theme).toMatch(/\.rq-tour-popover \.driver-popover-close-btn:focus-visible\s*\{[^}]*outline:\s*var\(--rq-focus-ring\)/);
    });
  });

  it('index.html has one inline script, the runner phase, in the head before every stylesheet and module script, so it runs before the stylesheet and not after it', () => {
    const html = read(dist, 'index.html');
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(1);
    // Funktionens text är byggets egen omskrivning (inte vitests), så innehållet prövas i grova drag här; skriptets beteende prövas i runnerPhase.test.ts och i webbläsaren (loader-continuity.spec.ts).
    for (const part of ['function alignRunnersWithClock', 'rqOrbit', 'rq-phase-pending', 'MutationObserver', 'performance.timeOrigin', 'DOMContentLoaded']) expect(scripts[0].body).toContain(part);
    expect(scripts[0].body).not.toMatch(/<\/script/i);
    expect(html).not.toContain(LOADER_PHASE_MARKER);
    expect(scripts[0].index).toBeLessThan(html.indexOf('</head>'));
    expect(firstIndexOf(html, [/<link\b[^>]*rel="(?:stylesheet|modulepreload|preload)"/, /<script\b[^>]*\bsrc=/])).toBeGreaterThan(scripts[0].index);
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
  let dist: string;
  beforeAll(async () => {
    dist = await buildApp('staging', 'staging');
  }, BUILD_TIMEOUT_MS);

  it('puts noindex in both files and the banner in the root of both', () => {
    for (const file of ['index.html', 'landing.html']) {
      expect(read(dist, file)).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(rootMarkup(read(dist, file))).toContain('Staging environment');
    }
    expect(inlineScripts(read(dist, 'landing.html'))[0].body).toBe(sessionHintScript());
  });

  it('defers the landing entry here too, and the lazy banner chunk is not part of what the boot script starts', () => {
    const boot = bootScript(dist, read(dist, 'landing.html'));
    expect(boot.modulesInHtml).toBe(1);
    expect(boot.file).toMatch(/^assets\/landing-boot-[\w-]+\.js$/);
    expect([...boot.starts].sort()).toEqual(landingScriptFiles('staging', dist));
    expect(boot.starts.filter((file) => /StagingBanner/.test(file))).toEqual([]);
  });

  it('index.html draws the banner above the loading view before any script runs, so the loader is already where the app will put it', () => {
    const html = read(dist, 'index.html');
    expect(rootMarkup(html)).toBe(renderToStaticMarkup(createElement(Fragment, null, createElement(StagingBanner), createElement(RoutePending))));
    expect(html).not.toContain(LOADER_MARKER);
  });

  it('both files link the stylesheet with the banner and its reserved height, in the same sheets that carry the loading view', () => {
    for (const file of ['index.html', 'landing.html']) {
      const css = stylesheetText(dist, read(dist, file));
      expect(css, file).toContain('.rq-staging-banner');
      expect(css, file).toMatch(/html:root\{--rq-staging-banner-h:\s*calc\(/);
    }
  });

  it('adds no inline script to index.html: the runner phase script is still the only one, byte for byte the production one (same hash)', () => {
    const inIndex = (distDir: string) => inlineScripts(read(distDir, 'index.html')).map((script) => script.body);
    expect(inIndex(dist)).toHaveLength(1);
    expect(inIndex(dist)).toEqual(inIndex(builtDists.get('prod')!));
  });
});

// Webbanalysen laddas av koden (umamiPageviews.ts) när sidan visats, aldrig av en tagg i HTML-filerna: S5:s krav på exakt två inline-skript och tipset före
// allt annat påverkas alltså inte av ett webbplats-id, och ett bygge utan id har varken id eller någon Umami-tagg i filerna.
describe('web analytics in the two HTML files', () => {
  const FAKE_WEBSITE_ID = '00000000-0000-4000-8000-000000000335';
  const scriptsOf = (dist: string) =>
    (readdirSync(dist, { recursive: true }) as string[]).map(normalize).filter((file) => file.endsWith('.js')).map((file) => read(dist, file));

  it('a build without a website id has no Umami tag in either file and no id in any script', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');
    const dist = await buildApp('no-website-id', '');
    for (const file of ['index.html', 'landing.html']) expect(read(dist, file)).not.toMatch(/umami/i);
    expect(scriptsOf(dist).filter((text) => text.includes(FAKE_WEBSITE_ID))).toEqual([]);
  }, BUILD_TIMEOUT_MS);

  it('a build with a website id adds no tag to either file: landing.html keeps its two inline scripts, the hint first, and its id sits in the scripts only', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', FAKE_WEBSITE_ID);
    const dist = await buildApp('with-website-id', '');
    for (const file of ['index.html', 'landing.html']) expect(read(dist, file)).not.toMatch(/umami/i);

    const html = read(dist, 'landing.html');
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(2);
    expect(scripts[0].body).toBe(sessionHintScript());
    expect(firstIndexOf(html, [/<link\b[^>]*rel="(?:stylesheet|modulepreload|preload)"/, /<script\b[^>]*\bsrc=/])).toBeGreaterThan(scripts[0].index);
    expect(scriptsOf(dist).some((text) => text.includes(FAKE_WEBSITE_ID))).toBe(true);
  }, BUILD_TIMEOUT_MS);
});

// Importgrafsvakten mot en syntetisk fixtur: ett litet riktigt Vite-bygge (landing.html → src/landing-entry/main.ts) vars källfiler ligger under samma sökvägar som de förbjudna
// modulerna. Grafen läses som för det riktiga bygget (collectChunks, landingClosure), så vakten fäller på en modul som nås genom flera statiska led och släpper samma modul när
// den bara nås med import().
describe('the landing import graph guard', () => {
  const FIXTURE_HTML = '<!doctype html><html><body><script type="module" src="/src/landing-entry/main.ts"></script></body></html>';
  const ENTRY = "import { shell } from '../features/landing/shell';\ndocument.title = shell;\n";
  const POPUP = 'src/features/runner/components/RunnerPopup.ts';

  /** Bygger fixturen och ger modulerna i landningens statiska graf. `files` ligger under fixturens rot; `shell.ts` är det enda ingången importerar. */
  async function landingModulesOf(name: string, shell: string, files: Record<string, string>): Promise<string[]> {
    const root = join(workDir, `fixture-${name}`);
    const all = { 'landing.html': FIXTURE_HTML, 'src/landing-entry/main.ts': ENTRY, 'src/features/landing/shell.ts': shell, ...files };
    for (const [file, text] of Object.entries(all)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      publicDir: false,
      plugins: [collectChunks(name)],
      build: { outDir: join(root, 'dist'), emptyOutDir: true, rollupOptions: { input: join(root, 'landing.html') } },
    });
    return landingClosure(name).flatMap((chunk) => chunk.moduleIds);
  }
  /** `shell.ts` som importerar `target` statiskt, genom ett mellanled (`helper.ts` i src/shared): en modul nås sällan direkt från landningen. `specifier` är importadressen om den inte är en relativ sökväg (ett paket). */
  const reachesThrough = (target: string, specifier = target.replace(/^src\//, '../').replace(/\.tsx?$/, '')) => ({
    shell: "import { helper } from '../../shared/helper';\nexport const shell = helper;\n",
    files: {
      'src/shared/helper.ts': `import { value } from '${specifier}';\nexport const helper = value;\n`,
      [target]: "export const value = 'forbidden';\n",
    },
  });
  /** Modulens sökväg inom fixturen: allt före fixturens rot bort. */
  const inFixture = (id: string) => normalize(id).replace(/^.*\/fixture-[^/]+\//, '');
  const slug = (target: string) => target.replace(/[^A-Za-z0-9]+/g, '-');

  it('landing import graph guard fails when it reaches the popup', async () => {
    const { shell, files } = reachesThrough(POPUP);
    const modules = await landingModulesOf('guard-popup', shell, files);
    // Fixturen står i grafen, så grönt vore ett fel i vakten och inte ett tomt bygge.
    expect(modules.map(normalize).some((id) => id.endsWith(`/${POPUP}`))).toBe(true);
    expect(forbiddenInLanding(modules).map(({ id, what }) => ({ id: inFixture(id), what }))).toEqual([
      { id: POPUP, what: 'the runner popup or anything it brings in (features/runner)' },
    ]);
  }, BUILD_TIMEOUT_MS);

  it.each([
    ['a module the popup brings in', 'src/features/runner/components/PopupSections.ts'],
    ["the profile's position chart", 'src/features/profile/components/PositionChart.ts'],
    ["the profile's position panel", 'src/features/profile/components/PositionPanel.ts'],
    ["the leaderboard's position chart", 'src/features/leaderboard/components/PackPositionChart.ts'],
    ['the position view', 'src/features/leaderboard/components/PositionView.ts'],
    ['the read-only badge card', 'src/features/badges/components/BadgeSeriesCard.ts'],
    ['the send sheet', 'src/features/challenges/components/SendSheet.ts'],
    ['the duels screen', 'src/features/challenges/components/DuelsScreen.ts'],
    ['an app page', 'src/pages/BoardPage.ts'],
    ['the full app router', 'src/routes.tsx'],
    ['the app shell', 'src/App.tsx'],
  ])('landing import graph guard fails when it reaches %s', async (label, target) => {
    const { shell, files } = reachesThrough(target);
    const modules = await landingModulesOf(`guard-${slug(target)}`, shell, files);
    expect(forbiddenInLanding(modules).map(({ id }) => inFixture(id))).toEqual([target]);
  }, BUILD_TIMEOUT_MS);

  it('landing import graph guard fails when it reaches the tour (driver.js)', async () => {
    const target = 'node_modules/driver.js/index.js';
    const { shell, files } = reachesThrough(target, 'driver.js');
    const modules = await landingModulesOf('guard-driver', shell, { ...files, 'node_modules/driver.js/package.json': '{"name":"driver.js","version":"0.0.0","type":"module","main":"index.js"}\n' });
    expect(forbiddenInLanding(modules).map(({ id }) => inFixture(id))).toEqual([target]);
  }, BUILD_TIMEOUT_MS);

  it('landing import graph guard passes when the popup and the position charts are only imported lazily, and when the graph holds none of them', async () => {
    const lazy = await landingModulesOf(
      'guard-lazy',
      // Tilldelningen till globalThis är en bieffekt, så att bygget behåller import()-anropen.
      "export const shell = 'landing';\n(globalThis as Record<string, unknown>).lazy = [() => import('../runner/components/RunnerPopup'), () => import('../profile/components/PositionChart')];\n",
      { [POPUP]: "export const popup = 'popup';\n", 'src/features/profile/components/PositionChart.ts': "export const chart = 'chart';\n" },
    );
    // Båda finns i bygget, i egna chunkar, men inte i landningens statiska graf.
    const built = chunksByBuild.get('guard-lazy')!.flatMap((chunk) => chunk.moduleIds).map(normalize);
    expect(built.some((id) => id.endsWith(`/${POPUP}`))).toBe(true);
    expect(built.some((id) => id.endsWith('/features/profile/components/PositionChart.ts'))).toBe(true);
    expect(forbiddenInLanding(lazy)).toEqual([]);

    const clean = await landingModulesOf('guard-clean', "export const shell = 'landing';\n", {});
    expect(forbiddenInLanding(clean)).toEqual([]);
  }, BUILD_TIMEOUT_MS);
});

describe('the build guards', () => {
  const page = (root: string, head = '') => `<!doctype html><html lang="en"><head>${head}</head><body>${root}</body></html>`;

  /** En minimal dist med de två filerna; guarden prövas utan ett helt bygge eftersom markörerna kontrolleras före SSR-steget. Landningens head har sessionstipsets markör om inget annat anges. */
  function fakeDist(name: string, files: { index: string; indexHead?: string; indexTail?: string; landing: string; landingHead?: string; landingTail?: string }): string {
    const dist = join(workDir, name);
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), page(files.index + (files.indexTail ?? ''), files.indexHead ?? LOADER_PHASE_MARKER));
    writeFileSync(join(dist, 'landing.html'), page(files.landing + (files.landingTail ?? ''), files.landingHead ?? SESSION_HINT_MARKER));
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

  it('fails when the session hint marker is missing from the head of landing.html', async () => {
    const distDir = fakeDist('no-hint-marker', { index: inRoot(LOADER_MARKER), landing: inRoot(LANDING_MARKER), landingHead: '' });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(SESSION_HINT_MARKER);
  });

  it('fails when the session hint marker is in the body instead of the head, where it would run after the first paint', async () => {
    const distDir = fakeDist('hint-marker-in-body', { index: inRoot(LOADER_MARKER), landing: inRoot(LANDING_MARKER), landingHead: '', landingTail: SESSION_HINT_MARKER });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(SESSION_HINT_MARKER);
  });

  it('fails when the session hint marker appears twice', async () => {
    const distDir = fakeDist('two-hint-markers', { index: inRoot(LOADER_MARKER), landing: inRoot(LANDING_MARKER), landingHead: SESSION_HINT_MARKER + SESSION_HINT_MARKER });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(SESSION_HINT_MARKER);
  });

  it('fails when the loader phase marker is missing from the head of index.html', async () => {
    const distDir = fakeDist('no-phase-marker', { index: inRoot(LOADER_MARKER), indexHead: '', landing: inRoot(LANDING_MARKER) });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(LOADER_PHASE_MARKER);
  });

  it('fails when the loader phase marker is in the body of index.html, where the script would wait for the stylesheet', async () => {
    const distDir = fakeDist('phase-marker-in-body', { index: inRoot(LOADER_MARKER), indexHead: '', indexTail: LOADER_PHASE_MARKER, landing: inRoot(LANDING_MARKER) });
    await expect(prerenderLanding({ root: frontend, distDir })).rejects.toThrow(LOADER_PHASE_MARKER);
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
