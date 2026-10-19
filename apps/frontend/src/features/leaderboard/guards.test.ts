import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Board (tokens, skarpa hörn, inga lucide, inga inline-styles, att CSS-måtten finns i temafilen, sköldens path och den
// gamla namnraden borta) vaktas av lint: eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts. Att multiplikatortrappan
// kommer ur config-endpointen (ingen streakConstants, ingen DEFAULT_STREAK_MULTIPLIERS) vaktas av ESLint. Kvar här är det lint inte uttrycker.

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
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./board.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Board — hjälpare för dynamiska värden', () => {
  it('cssVars tar bara variabelnamn (--x), aldrig egenskaper som color/width/height', () => {
    expect(sources['./cssVars.ts']).toMatch(/Record<`--\$\{string\}`, string>/);
  });
});

describe('podiets minis och vimpeln (F12/F13)', () => {
  it('podiets minis är högerställda via --rq-board-minis-inset (28 px mobil, 46 px desktop), identiskt i båda temafilerna', () => {
    expect(css).toMatch(/\.rq-board-podium \.rq-badge-minis\s*\{[^}]*margin-left:\s*auto;[^}]*margin-right:\s*var\(--rq-board-minis-inset\)/);
    for (const file of ['../../index.css', '../../../../../docs/design/temafil-forslag.css']) {
      const text = readFromDisk(file);
      const declarations = [...text.matchAll(/^\s*--rq-board-minis-inset:\s*([^;]+);/gm)].map((m) => m[1]);
      expect({ file, declarations }).toEqual({ file, declarations: ['28px', '46px'] });
      // desktopvärdet ligger i min-width: 1024px-blocket, efter mobilvärdet
      const desktopBlock = text.slice(text.indexOf('@media (min-width: 1024px)'));
      expect(desktopBlock).toMatch(/--rq-board-minis-inset:\s*46px/);
    }
  });

  it('vimpelns path importeras ur shared/components/challengeMark och ritas bara i BoardParts', () => {
    const drawn = codeFiles.filter(([, text]) => /<path\b/.test(stripComments(text))).map(([path]) => path);
    expect(drawn).toEqual(['./components/BoardParts.tsx']);
    expect(sources['./components/BoardParts.tsx']).toContain("from '@/shared/components/challengeMark'");
  });
});
