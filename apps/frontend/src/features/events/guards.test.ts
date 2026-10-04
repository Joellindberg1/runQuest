import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Events-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn), 8 (rörelse),
// 10 (ikoner ur RQIcon, inga emojis) + att CSS-måtten finns i temafilen (index.css OCH docs/design/temafil-forslag.css).

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts', '../../pages/EventsPage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./events.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Events-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(12);
    expect(css.length).toBeGreaterThan(500);
  });

  it('ingen lucide-import och inga egna <svg> (RQIcon är enda ikonkällan)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, lucide: /lucide-react/.test(text), svg: /<svg/.test(text) }).toEqual({ path, lucide: false, svg: false });
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

  it('inga inline-styles: dynamiska värden går bara via cssVars() (CSS-variabler)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, inline: stripComments(text).match(/style=\{\{/g) ?? [] }).toEqual({ path, inline: [] });
      // style={…} får bara bära cssVars(…) — aldrig en färg, ett mått eller en typsnittsegenskap.
      const styles = stripComments(text).match(/style=\{[^}]*\}\}?/g) ?? [];
      expect({ path, bad: styles.filter((style) => !/^style=\{cssVars\(/.test(style)) }).toEqual({ path, bad: [] });
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

  it('events.css har inga egna :root-definitioner och deklarerar bara kortets accent-/kantvariabler och de delade chip-/ring-recepten', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    const declared = [...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual(
      ['--rq-c', '--rq-c-solid', '--rq-edge', '--rq-edge-line', '--rq-events-accent', '--rq-events-accent-rgb', '--rq-events-week', '--rq-ring-c'].sort(),
    );
  });

  it('line-height är aldrig ett enhetslöst råvärde (använd var(--rq-lh-*)) och inget z-index', () => {
    const code = stripComments(css);
    const lineHeights = [...code.matchAll(/line-height:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(lineHeights.length).toBeGreaterThan(5);
    expect(lineHeights.filter((value) => !value.startsWith('var(--rq-lh-'))).toEqual([]);
    expect([...code.matchAll(/z-index:\s*([^;}]+)/g)].map((m) => m[1].trim())).toEqual([]);
  });

  it('typsnitten kommer ur tokens: inga font-family utom var(--rq-font-*)', () => {
    const families = [...stripComments(css).matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(5);
    expect(families.filter((family) => !family.startsWith('var(--rq-font-'))).toEqual([]);
  });

  it('rörelse: bara live-saker loopar (sweep, prick) — inga hover-animationer och inga andra infinite-animationer', () => {
    const code = stripComments(css);
    const animations = [...code.matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(animations).toEqual(['rqSweep 5s linear infinite']);
    expect(code).not.toMatch(/transition\s*:/);
  });

  it('varje --rq-events-*-mått som events.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const local = /^--rq-events-(accent|accent-rgb|week)$/; // sätts lokalt per kort i events.css
    const used = new Set([...css.matchAll(/var\((--rq-events-[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((name) => !local.test(name)));
    expect(used.size).toBeGreaterThan(8);

    const index = readFromDisk('../../index.css');
    const facit = readFromDisk('../../../../../docs/design/temafil-forslag.css');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-events-[a-z0-9-]+):/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });
});
