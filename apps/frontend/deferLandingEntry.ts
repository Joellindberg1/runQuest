// Landningens ingångsmodul och dess förladdningar hämtas först efter första innehållsritningen (RUN-343).
//
// landing.html är förrenderad och syns utan JS, men Vite skriver ett modulskript och en modulepreload-länk per delad chunk i head. Webbläsaren hämtar dem direkt, och
// ~126 kB JS delar då bandbredd med stilmallarna, typsnittet och mobilpostern fram till första ritningen. Lighthouses simulerade 4G räknar in dem i både FCP och LCP:
// mätt lokalt faller mobilens LCP från 2,86 s till 1,96 s och FCP från 2,56 s till 1,50 s när de laddas efter ritningen (docs/performance.md, RUN-343).
//
// Bygget gör ingenting åt stilmallarna: tre länkade, renderingsblockerande filer. Att lägga dem inline gav lägre FCP men högre LCP när JS:et väntar (dokumentet blir
// 130 kB och posterns hämtning dröjer i simuleringen), och kostade en hash i en framtida CSP.
//
// Skriptet som väntar på ritningen är en separat, hashad fil under assets/ och inget inline-skript: ingen CSP-hash, ingen inline-hanterare, och landing.html har kvar
// exakt två inline-skript. Texten kommer ur src/landing-entry/deferredEntry.ts. index.html (hela appen) rörs inte.
import type { Plugin } from 'vite';
import { deferredEntryScript } from './src/landing-entry/deferredEntry';

const LANDING_FILE = 'landing.html';

// Taggarna som Vite skriver, med attributen i valfri ordning. Lookaheads så att ordningen inte spelar roll.
const MODULE_SCRIPT = /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="([^"]+)")[^>]*><\/script>/g;
const MODULE_PRELOAD_LINE = /^[ \t]*<link\b(?=[^>]*\brel="modulepreload")(?=[^>]*\bhref="([^"]+)")[^>]*>[ \t]*(?:\r?\n|$)/gm;

export interface LandingEntry {
  entry: string;
  preloads: string[];
}

/** Ingångsmodulens adress och modulepreload-länkarnas adresser, i dokumentets ordning. Faller om det inte finns exakt ett modulskript. */
export function readEntry(html: string, file: string): LandingEntry {
  const scripts = [...html.matchAll(MODULE_SCRIPT)];
  if (scripts.length !== 1) {
    throw new Error(`${file}: förväntade exakt ett module script med src att skjuta upp (landningens ingång), hittade ${scripts.length} module scripts (RUN-343, deferLandingEntry.ts)`);
  }
  return { entry: scripts[0][1], preloads: [...html.matchAll(MODULE_PRELOAD_LINE)].map((match) => match[1]) };
}

/** Byter modulskriptet mot boot-skriptet på samma plats och tar bort modulepreload-länkarna (raderna med, så inga tomma rader blir kvar). */
export function replaceEntry(html: string, bootHref: string): string {
  return html.replace(MODULE_PRELOAD_LINE, '').replace(MODULE_SCRIPT, () => `<script type="module" crossorigin src="${bootHref}"></script>`);
}

export function deferLandingEntry(): Plugin {
  return {
    name: 'rq-defer-landing-entry',
    apply: 'build',
    enforce: 'post',
    // Vites egen HTML-plugin skriver landing.html i sin generateBundle; den här kör efter (order: 'post') och ser filen färdig, med hashade adresser.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = bundle[LANDING_FILE];
        if (!page || page.type !== 'asset') throw new Error(`${LANDING_FILE} finns inte i bygget: kan inte skjuta upp landningens ingång (deferLandingEntry.ts)`);
        const html = typeof page.source === 'string' ? page.source : Buffer.from(page.source).toString('utf8');
        const { entry, preloads } = readEntry(html, LANDING_FILE);
        const assetsAt = entry.indexOf('assets/');
        if (assetsAt < 0) throw new Error(`${LANDING_FILE}: ingångens adress ${entry} ligger inte under assets/ (deferLandingEntry.ts)`);
        const reference = this.emitFile({ type: 'asset', name: 'landing-boot.js', source: deferredEntryScript({ entry, preloads }) });
        page.source = replaceEntry(html, entry.slice(0, assetsAt) + this.getFileName(reference));
      },
    },
  };
}
