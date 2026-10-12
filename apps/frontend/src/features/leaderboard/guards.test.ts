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

describe('podiets minis och vimpeln (RUN-147, spec F12/F13)', () => {
  const [, css] = cssFiles.find(([path]) => path.endsWith('board.css'))!;

  it('podiets minis är högerställda via --rq-board-minis-inset (28 px mobil, 46 px desktop), identiskt i båda temafilerna', () => {
    expect(css).toMatch(/\.rq-board-podium \.rq-badge-minis\s*\{[^}]*margin-left:\s*auto;[^}]*margin-right:\s*var\(--rq-board-minis-inset\)/);
    for (const file of ['src/index.css', '../../docs/design/temafil-forslag.css']) {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      const declarations = [...text.matchAll(/^\s*--rq-board-minis-inset:\s*([^;]+);/gm)].map((m) => m[1]);
      expect({ file, declarations }).toEqual({ file, declarations: ['28px', '46px'] });
      // desktopvärdet ligger i min-width: 1024px-blocket, efter mobilvärdet
      const desktopBlock = text.slice(text.indexOf('@media (min-width: 1024px)'));
      expect(desktopBlock).toMatch(/--rq-board-minis-inset:\s*46px/);
    }
  });

  it('sköldens path finns inte kvar i Board-koden; vimpelns path importeras ur shared/components/challengeMark', () => {
    const drawn = codeFiles.filter(([, text]) => /<path\b/.test(stripComments(text))).map(([path]) => path);
    expect(drawn).toEqual(['./components/BoardParts.tsx']);
    for (const [path, text] of codeFiles) expect({ path, shield: text.includes('V21 L13') }).toEqual({ path, shield: false });
    expect(sources['./components/BoardParts.tsx']).toContain("from '@/shared/components/challengeMark'");
  });

  it('den gamla namnraden för tabellen (.rq-board-namerow) är borta', () => {
    expect(css).not.toContain('rq-board-namerow');
    expect(sources['./components/SeasonRest.tsx']).not.toContain('rq-board-namerow');
  });
});

// Att multiplikatortrappan kommer ur config-endpointen (ingen streakConstants, ingen DEFAULT_STREAK_MULTIPLIERS) vaktas av ESLint, se eslint.config.js.
