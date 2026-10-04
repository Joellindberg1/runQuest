import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Duels-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn), 10 (ikoner ur RQIcon,
// inga emojis) + att CSS-måtten finns i temafilen och att inget i featuren förlitar sig på en Toaster som inte är monterad.

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts', '../../pages/DuelsPage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./duels.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Duels-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(15);
    expect(css.length).toBeGreaterThan(500);
  });

  it('ingen lucide-import; <svg> bara i TierRibbon (skölden är en egen form, inte en ikon)', () => {
    for (const [path, text] of codeFiles) {
      const svgAllowed = path.endsWith('/TierRibbon.tsx');
      expect({ path, lucide: /lucide-react/.test(text), svg: !svgAllowed && /<svg/.test(text) }).toEqual({ path, lucide: false, svg: false });
    }
  });

  it('inga emojis i UI-texten (regel 10)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, emoji: stripComments(text).match(/\p{Extended_Pictographic}/gu) ?? [] }).toEqual({ path, emoji: [] });
    }
  });

  it('inga hex, rgba() eller px i klassnamn', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const rgba = code.match(/rgba?\(/g) ?? [];
      const pxInClass = (code.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? []).filter((c) => /[\d.]+px/.test(c));
      expect({ path, hex, rgba, pxInClass }).toEqual({ path, hex: [], rgba: [], pxInClass: [] });
    }
  });

  it('inga inline-styles', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, inline: stripComments(text).match(/style=\{\{/g) ?? [] }).toEqual({ path, inline: [] });
    }
  });

  it('engelskt UI i en-GB: ingen sv-SE och inga Toaster-beroende toasts (Toaster är inte monterad)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, svSE: /sv-SE/.test(text), toast: /from ['"]sonner['"]/.test(text) }).toEqual({ path, svSE: false, toast: false });
    }
  });

  it('CSS: bara tokens — px, hex och rgba() finns inte, och inga hörn utom radie 0 / token', () => {
    const code = stripComments(css).replace(/@media[^{]*\{/g, '{');
    expect({
      px: code.match(/[\d.]+px/g) ?? [],
      hex: code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
      // rgb(var(--rq-…-rgb) / alfa) är det sanktionerade alfa-receptet; bokstavliga rgb()/rgba() är det inte.
      rgba: code.match(/rgba\(|rgb\(\s*\d/g) ?? [],
      radius: [...code.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((value) => value !== '0' && !value.startsWith('var(--rq-radius')),
    }).toEqual({ px: [], hex: [], rgba: [], radius: [] });
  });

  it('duels.css har inga egna :root-definitioner och deklarerar bara nivåfärgerna och kortets kantvariabler', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    const declared = [...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual(
      ['--rq-duels-tier', '--rq-duels-tier-fg', '--rq-duels-tier-rgb', '--rq-duels-tier-stroke', '--rq-edge', '--rq-edge-line'].sort(),
    );
  });

  it('line-height är aldrig ett enhetslöst råvärde (använd var(--rq-lh-*)) och z-index bara det dokumenterade 66', () => {
    const code = stripComments(css);
    const lineHeights = [...code.matchAll(/line-height:s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(lineHeights.length).toBeGreaterThan(5);
    expect(lineHeights.filter((value) => !value.startsWith('var(--rq-lh-'))).toEqual([]);
    expect([...code.matchAll(/z-index:s*([^;}]+)/g)].map((m) => m[1].trim())).toEqual(['66']);
  });

  it('typsnitten kommer ur tokens: inga font-family utom var(--rq-font-*)', () => {
    const families = [...stripComments(css).matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(5);
    expect(families.filter((family) => !family.startsWith('var(--rq-font-'))).toEqual([]);
  });

  it('varje --rq-duels-*-mått som duels.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const local = /^--rq-duels-tier/; // sätts lokalt per nivå i duels.css
    const used = new Set([...css.matchAll(/var\((--rq-duels-[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((name) => !local.test(name)));
    expect(used.size).toBeGreaterThan(10);

    const index = readFromDisk('../../index.css');
    const facit = readFromDisk('../../../../../docs/design/temafil-forslag.css');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-duels-[a-z0-9-]+):/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });

  it('skölden återanvänder Boards mått, och de finns i temafilen', () => {
    const index = readFromDisk('../../index.css');
    for (const name of ['--rq-board-ribbon-w', '--rq-board-ribbon-h', '--rq-board-ribbon-font']) {
      expect({ name, used: css.includes(`var(${name})`), declared: new RegExp(`^\\s*${name}:`, 'm').test(index) }).toEqual({ name, used: true, declared: true });
    }
  });

  it('nivåfärgerna kommer ur tier-tokens (minor/major/legendary), inte egna färger', () => {
    for (const tier of ['minor', 'major', 'legendary']) {
      for (const part of ['', '-rgb', '-fg', '-stroke']) {
        expect(css).toContain(`var(--rq-tier-${tier}${part})`);
      }
    }
  });
});
