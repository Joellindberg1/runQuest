import { readFileSync } from 'node:fs';
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

  it('token-blocket i board.css definierar bara mått (--rq-board-*), aldrig färger eller typskala', () => {
    const [, css] = cssFiles.find(([path]) => path.endsWith('board.css'))!;
    const declared = [...stripComments(css).matchAll(/^\s*(--rq-[a-z0-9-]+):/gm)].map((m) => m[1]);
    const rootDeclared = declared.filter((name) => name.startsWith('--rq-board-'));
    expect(rootDeclared.length).toBeGreaterThan(5);
    // Allt som inte är --rq-board-* är lokala hjälpvariabler (rank/acc/tier) som bara pekar på andra tokens.
    for (const name of declared.filter((n) => !n.startsWith('--rq-board-'))) {
      expect(name).toMatch(/^--rq-(rank-solid|rank-edge|rank-subtle|ring-c|tier-rgb|tier-stroke|tier-fg|acc|acc-edge|edge|edge-line)$/);
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
