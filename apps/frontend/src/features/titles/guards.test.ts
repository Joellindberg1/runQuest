import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Titles-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn),
// 10 (ikoner ur RQIcon, inga emojis) + att CSS-måtten finns i temafilen och att titelnamn aldrig hårdkodas (ägarbeslut 3).

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/TitlesPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./titles.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Titles-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(10);
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

  it('inga inline-styles', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, inline: stripComments(text).match(/style=\{\{/g) ?? [] }).toEqual({ path, inline: [] });
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

  it('titles.css har inga egna :root-definitioner och deklarerar inga nya custom properties (bara kortets --rq-edge)', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    const declared = [...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect([...new Set(declared)]).toEqual(['--rq-edge']);
  });

  it('varje --rq-titles-*-mått som titles.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const used = new Set([...css.matchAll(/var\((--rq-titles-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(3);

    const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const facit = readFileSync(resolve(process.cwd(), '../../docs/design/temafil-forslag.css'), 'utf8');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-titles-[a-z0-9-]+):/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });
});

describe('titlar kommer ur databasen (ägarbeslut 3)', () => {
  it('ingen källfil hårdkodar ett titelnamn (designens påhittade eller dagens)', () => {
    const names = ['Batman', 'Rooster', 'Lunch Breaker', 'Hamster', 'Commuter', 'Weekend Destroyer', 'Double Trouble', 'Goggins', 'Kipchoge', 'Ultra Man', 'Phoenix'];
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, names: names.filter((name) => code.includes(name)) }).toEqual({ path, names: [] });
    }
  });
});
