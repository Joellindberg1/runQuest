// Förrenderingen (ADR 006, addendum 2026-10-19, punkt 2 och 11). Körs efter `vite build` (npm run build) och fyller två markörer i dist/:
//   - landing.html:  <div id="root"><!--app-landing--></div>  ->  landningen, renderad med react-dom/server i Node
//   - landing.html:  <!--app-session-hint--> i <head>         ->  sessionstipset (punkt 4): ett litet inline-skript som skickar en inloggad besökare vidare till appen
//                    innan första ritning. Texten kommer ur landing-entry/sessionHint.ts, aldrig handskriven i HTML.
//   - index.html:    <div id="root"><!--app-loader--></div>   ->  appens laddningsvy (RoutePending), så en sidladdning aldrig visar en tom sida
//
// Ingen webbläsare och inget nytt beroende: landing-ssr.tsx byggs med `vite build --ssr` till en tillfällig katalog UTANFÖR dist/, importeras en gång,
// anropas och raderas. Inget serverkod når dist/ och därmed inte produktion. Bygget faller (kastar) om en markör saknas eller inte ligger i #root, om en
// modul rör `window` på modulnivå eller om renderingen kastar, så ett trasigt förrendat bygge når aldrig prod. Markörerna kontrolleras FÖRE SSR-bygget
// (snabbt fel) och filerna skrivs först när båda renderingarna lyckats (ingen halvfärdig dist).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

export const LANDING_MARKER = '<!--app-landing-->';
export const LOADER_MARKER = '<!--app-loader-->';
export const SESSION_HINT_MARKER = '<!--app-session-hint-->';

const DEFAULT_SSR_ENTRY = 'src/landing-ssr.tsx';
const SSR_BUNDLE = 'landing-ssr.mjs';

/** `<div id="root">MARKÖR</div>`: markören ska stå ensam i #root, en gång. Vite behåller kommentaren i kroppen. */
const rootWith = (marker) => `<div id="root">${marker}</div>`;

function assertMarker(html, marker, file) {
  const occurrences = html.split(rootWith(marker)).length - 1;
  if (occurrences !== 1 || html.split(marker).length - 1 !== 1) {
    throw new Error(`${file}: förväntade exakt en ${marker} och den ska stå ensam i <div id="root">, hittade ${occurrences} där (se ADR 006, addendum 2026-10-19)`);
  }
}

/** Sessionstipsets markör ska stå exakt en gång och i <head>: ett tips i kroppen körs först efter att landningen målats. */
function assertHintMarker(html, file) {
  const occurrences = html.split(SESSION_HINT_MARKER).length - 1;
  const head = /<head[\s>][\s\S]*?<\/head>/.exec(html)?.[0] ?? '';
  if (occurrences !== 1 || head.split(SESSION_HINT_MARKER).length - 1 !== 1) {
    throw new Error(`${file}: förväntade exakt en ${SESSION_HINT_MARKER} och den ska stå i <head> (före stilar och skript), hittade ${occurrences} (se ADR 006, addendum 2026-10-19, punkt 4)`);
  }
}

const fill = (html, marker, markup) => html.replace(rootWith(marker), () => rootWith(markup));
const fillHint = (html, script) => html.replace(SESSION_HINT_MARKER, () => `<script>${script}</script>`);

/** Läget ur kommandoraden (`--mode x`, `--mode=x`, `-m x`), samma flaggor som `vite build`; undefined om inget anges. */
export function modeFromArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode' || arg === '-m') return argv[i + 1];
    if (arg.startsWith('--mode=')) return arg.slice('--mode='.length);
  }
  return undefined;
}

/**
 * Fyller landing.html och index.html i `distDir`.
 * @param {{ root: string, distDir: string, ssrEntry?: string, mode?: string }} options `root` är frontend-katalogen (vite.config.ts), `ssrEntry` relativt `root`.
 *   `mode` är läget klientbygget kördes i: SSR-bygget läser då samma .env.<mode>-filer och förrenderingen kan inte skilja sig från klienten.
 */
export async function prerenderLanding({ root, distDir, ssrEntry = DEFAULT_SSR_ENTRY, mode }) {
  const landingPath = join(distDir, 'landing.html');
  const indexPath = join(distDir, 'index.html');
  const landingHtml = readFileSync(landingPath, 'utf8');
  const indexHtml = readFileSync(indexPath, 'utf8');
  assertMarker(landingHtml, LANDING_MARKER, 'landing.html');
  assertHintMarker(landingHtml, 'landing.html');
  assertMarker(indexHtml, LOADER_MARKER, 'index.html');

  // Inne i node_modules/.cache: bundlen importerar react, react-router-dom m.fl. som externa paket och hittar dem uppåt från sin egen katalog.
  const cacheDir = join(root, 'node_modules', '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const workDir = mkdtempSync(join(cacheDir, 'rq-prerender-'));
  try {
    await build({
      root,
      mode,
      logLevel: 'warn',
      publicDir: false,
      build: {
        ssr: ssrEntry,
        outDir: workDir,
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: { output: { entryFileNames: SSR_BUNDLE } },
      },
    });
    const server = await import(pathToFileURL(join(workDir, SSR_BUNDLE)).href);
    const landingMarkup = server.renderLanding();
    const loaderMarkup = server.renderLoader();
    const sessionHint = server.renderSessionHint();
    writeFileSync(landingPath, fillHint(fill(landingHtml, LANDING_MARKER, landingMarkup), sessionHint));
    writeFileSync(indexPath, fill(indexHtml, LOADER_MARKER, loaderMarkup));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const isCommandLine = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCommandLine) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await prerenderLanding({ root, distDir: join(root, 'dist'), mode: modeFromArgs(process.argv.slice(2)) });
    console.log('prerender-landing: dist/landing.html har landningen och dist/index.html laddningsvyn i #root');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
