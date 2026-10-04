import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Profile-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn), 8 (rörelse),
// 10 (ikoner ur RQIcon, inga emojis) + att CSS-måtten finns i temafilen (index.css OCH docs/design/temafil-forslag.css)
// + att det döda toast-flödet (sonner utan monterad Toaster) och det gamla edit/delete-flödet är borta.

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts', '../runs/**/*.{ts,tsx}', '!../runs/**/*.test.{ts,tsx}', '../../pages/ProfilePage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./profile.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Profile-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(14);
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
      const code = stripComments(text);
      expect({ path, literal: code.match(/style=\{\{/g) ?? [] }).toEqual({ path, literal: [] });
      for (const [call] of code.matchAll(/style=\{(?!cssVars\()[^}]*\}/g)) expect({ path, call }).toEqual({ path, call: undefined });
    }
  });

  it('engelskt UI i en-GB: ingen sv-SE, och inga toast-anrop (Toaster är inte monterad — sonner visar ingenting)', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, svSE: /sv-SE/.test(code), sonner: /from ['"]sonner['"]/.test(code), toast: /\btoast[.(]/.test(code) }).toEqual({ path, svSE: false, sonner: false, toast: false });
    }
  });

  it('inga egna Intl-/toLocale-datumformat: månadsnamnen är egna (Intl ger "Sept" i nyare ICU)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, locale: /toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(stripComments(text)) }).toEqual({ path, locale: false });
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

  it('profile.css har inga egna :root-definitioner och deklarerar inga egna custom properties', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    expect([...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])).toEqual([]);
  });

  it('line-height är aldrig ett enhetslöst råvärde (använd var(--rq-lh-*)) och z-index bara det dokumenterade 66 (redigeringsrutan)', () => {
    const code = stripComments(css);
    const lineHeights = [...code.matchAll(/line-height:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(lineHeights.length).toBeGreaterThan(5);
    expect(lineHeights.filter((value) => !value.startsWith('var(--rq-lh-'))).toEqual([]);
    expect([...code.matchAll(/z-index:\s*([^;}]+)/g)].map((m) => m[1].trim())).toEqual(['66']);
  });

  it('typsnitten kommer ur tokens: inga font-family utom var(--rq-font-*)', () => {
    const families = [...stripComments(css).matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(5);
    expect(families.filter((family) => !family.startsWith('var(--rq-font-'))).toEqual([]);
  });

  it('rörelse: bara tre saker animerar — markören (en gång), rutnätets veckor (en gång) och ingenting loopar; inga transitions', () => {
    const code = stripComments(css);
    const animations = [...code.matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(animations).toEqual([
      'rqProfileKnob var(--rq-dur-bar) var(--rq-ease-bar) both',
      'rqGrowY var(--rq-dur-grow) var(--rq-ease-bar) both',
    ]);
    expect(animations.filter((value) => /infinite/.test(value))).toEqual([]);
    expect(code).not.toMatch(/transition\s*:/);
  });

  it('varje --rq-profile-*-mått som profile.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const used = new Set([...css.matchAll(/var\((--rq-profile-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(12);

    const index = readFromDisk('../../index.css');
    const facit = readFromDisk('../../../../../docs/design/temafil-forslag.css');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-profile-[a-z0-9-]+):/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });
});

describe('Profile bygger på delade definitioner, inte egna kopior', () => {
  it('multiplikatortrappan kommer ur config-endpointen: ingen Profile-fil läser streakConstants eller DEFAULT_STREAK_MULTIPLIERS', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, constants: /streakConstants/.test(code), defaults: /DEFAULT_STREAK_MULTIPLIERS|STREAK_MULTIPLIERS/.test(code) }).toEqual({
        path, constants: false, defaults: false,
      });
    }
  });

  it('nivåring och XP kommer ur shared-matematiken via runnerModel (ADR 004): inga egna nivåformler', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, own: /getXPForLevel|getXPForNextLevel|xpForLevel|levelFromXP/.test(code) }).toEqual({ path, own: false });
    }
  });

  it('PUT/DELETE går genom EN invalideringskedja (features/runs/runEffects) — inga egna invalidateQueries i Profile-hooks för rundor', () => {
    const changes = sources['./hooks/useRunChanges.ts'];
    expect(changes).toMatch(/invalidateAfterRunChange/);
    expect(stripComments(changes)).not.toMatch(/invalidateQueries/);
  });
});
