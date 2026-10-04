import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Board-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn) och
// 10 (ikoner ur RQIcon, inga lucide) + uppdragets krav att trappan aldrig hämtas ur konstanter.

const sources = import.meta.glob(
  [
    './**/*.{ts,tsx}',
    '!./**/*.test.{ts,tsx}',
    '../../pages/BoardPage.tsx',
    '../../shared/components/ViewTabs.tsx',
    '../../shared/components/ErrorState.tsx',
    '../../shared/hooks/useViewParam.ts',
    '../../shared/hooks/useXpConfig.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar
// och tysta godkännanden.
const readCss = (relative: string): [string, string] => [relative, readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')];

const codeFiles = Object.entries(sources);
const cssFiles = [readCss('./board.css'), readCss('../../shared/components/error-state.css')];

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Board-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(15);
    // en tom CSS-läsning vore ett tyst godkännande
    for (const [path, text] of cssFiles) expect({ path, length: text.length > 200 }).toEqual({ path, length: true });
  });

  it('ingen lucide-import (RQIcon är enda ikonkällan)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, lucide: /lucide-react/.test(text) }).toEqual({ path, lucide: false });
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
    // cssVars tar bara variabelnamn (--x), aldrig egenskaper som color/width/height.
    const helper = sources['./cssVars.ts'];
    expect(helper).toMatch(/Record<`--\$\{string\}`, string>/);
  });

  it('CSS: bara tokens — px, hex och rgba() finns endast i token-blocket (--rq-board-*: …) och media-villkor', () => {
    for (const [path, text] of cssFiles) {
      const withoutTokenDeclarations = stripComments(text)
        .replace(/^\s*--rq-[a-z0-9-]+:[^;]*;\s*$/gm, '')
        .replace(/@media[^{]*\{/g, '{');
      const raw = {
        px: withoutTokenDeclarations.match(/[\d.]+px/g) ?? [],
        hex: withoutTokenDeclarations.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
        // rgb(var(--rq-…-rgb) / alfa) är det sanktionerade alfa-receptet; bokstavliga rgb()/rgba() är det inte.
        rgba: withoutTokenDeclarations.match(/rgba\(|rgb\(\s*\d/g) ?? [],
        radius: withoutTokenDeclarations.match(/border-radius:\s*(?!0|var\(--rq-radius)/g) ?? [],
      };
      expect({ path, ...raw }).toEqual({ path, px: [], hex: [], rgba: [], radius: [] });
    }
  });

  it('board.css har inga egna :root-definitioner; lokala variabler pekar bara på andra tokens', () => {
    const [, css] = cssFiles.find(([path]) => path.endsWith('board.css'))!;
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    const declared = [...code.matchAll(/^s*(--rq-[a-z0-9-]+):/gm)].map((m) => m[1]);
    for (const name of declared.filter((n) => !n.startsWith('--rq-board-plinth'))) {
      expect(name).toMatch(/^--rq-(rank-solid|rank-edge|rank-subtle|ring-c|tier-rgb|tier-stroke|tier-fg|acc|acc-edge|edge|edge-line)$/);
    }
  });

  it('varje --rq-board-*-mått som board.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css', () => {
    const [, css] = cssFiles.find(([path]) => path.endsWith('board.css'))!;
    const used = new Set([...css.matchAll(/var\((--rq-board-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    used.delete('--rq-board-plinth'); // sätts lokalt per rank i board.css
    expect(used.size).toBeGreaterThan(8);
    const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const facit = readFileSync(resolve(process.cwd(), '../../docs/design/temafil-forslag.css'), 'utf8');
    for (const name of used) {
      const declaration = new RegExp(`^\\s*${name}:`, 'm');
      expect({ name, index: declaration.test(index) }).toEqual({ name, index: true });
      expect({ name, facit: declaration.test(facit) }).toEqual({ name, facit: true });
    }
  });
});

describe('multiplikatortrappan kommer ur config-endpointen', () => {
  it('ingen Board-fil importerar constants/streakConstants eller läser DEFAULT_STREAK_MULTIPLIERS', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, constants: /streakConstants/.test(code), defaults: /DEFAULT_STREAK_MULTIPLIERS|STREAK_MULTIPLIERS/.test(code) }).toEqual({
        path, constants: false, defaults: false,
      });
    }
  });
});
