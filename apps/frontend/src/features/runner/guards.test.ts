import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Runner card-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn),
// 10 (ikoner ur RQIcon, inga emojis) + att multiplikatortrappan aldrig hämtas ur konstanter.

const sources = import.meta.glob(
  [
    './**/*.{ts,tsx}',
    '!./**/*.test.{ts,tsx}',
    '../profile/frodoModel.ts',
    '../../pages/RunnerPage.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
// (Literalen new URL('./x.css', import.meta.url) skulle skrivas om av Vite till en asset-URL — därför variabeln.)
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./runner.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// RunnerPage hör till skalet (✕ är modalens stängknapp, äldre än Runner card) — emoji-vakten gäller Runner-filerna.
const runnerFiles = codeFiles.filter(([path]) => !path.endsWith('RunnerPage.tsx'));

describe('Runner card-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(10);
    expect(css.length).toBeGreaterThan(200);
  });

  it('ingen lucide-import och inga egna <svg> (RQIcon är enda ikonkällan)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, lucide: /lucide-react/.test(text), svg: /<svg/.test(text) }).toEqual({ path, lucide: false, svg: false });
    }
  });

  it('inga emojis i UI-texten (regel 10)', () => {
    for (const [path, text] of runnerFiles) {
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

  it('runner.css har inga egna :root-definitioner och deklarerar inga egna custom properties', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    expect([...code.matchAll(/^\s*(--rq-[a-z0-9-]+):/gm)].map((m) => m[1])).toEqual([]);
  });

  it('varje --rq-runner-*-mått som runner.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const used = new Set([...css.matchAll(/var\((--rq-runner-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(8);

    const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const facit = readFileSync(resolve(process.cwd(), '../../docs/design/temafil-forslag.css'), 'utf8');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-runner-[a-z0-9-]+):/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });
});

describe('multiplikatortrappan kommer ur config-endpointen', () => {
  it('ingen Runner-fil importerar constants/streakConstants eller läser DEFAULT_STREAK_MULTIPLIERS', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, constants: /streakConstants/.test(code), defaults: /DEFAULT_STREAK_MULTIPLIERS|STREAK_MULTIPLIERS/.test(code) }).toEqual({
        path, constants: false, defaults: false,
      });
    }
  });
});
