import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna är lint (eslint.config.js och stylelint.config.js). Lint som tyst slutat gälla är värre än en vakt som fäller, så det här
// testet prövar omfånget: varje glob i en designgrupp matchar fortfarande filer, och varje feature har en grupp. De gamla vaktfilerna
// fällde på en tom glob ("hittar filerna"); det här tar över den uppgiften. En ny feature kräver en ny designGroup i eslint.config.js.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url).
const FRONTEND_DIR = '../..';
const frontendDir = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const configUrl = (file: string) => pathToFileURL(join(frontendDir, file)).href;

interface DesignGroup { files: string[]; ignores?: string[] }
const eslintConfig = (await import(/* @vite-ignore */ configUrl('eslint.config.js'))) as { DESIGN_GROUPS: DesignGroup[] };
const stylelintConfig = (await import(/* @vite-ignore */ configUrl('stylelint.config.js'))) as { default: { overrides: { files: string[] }[] } };

/** Glob → RegExp för de former configfilerna använder: **, *, {a,b}. Sökvägar är relativa till apps/frontend med snedstreck. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else source += '[^/]*';
    } else if (char === '{') {
      braces += 1;
      source += '(?:';
    } else if (char === '}') {
      braces -= 1;
      source += ')';
    } else if (char === ',' && braces > 0) source += '|';
    else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}
const matches = (globs: string[], file: string) => globs.some((glob) => globToRegExp(glob).test(file));

const sourceFiles = (readdirSync(join(frontendDir, 'src'), { recursive: true }) as string[]).map((file) => `src/${file.replace(/\\/g, '/')}`);
const cssFiles = sourceFiles.filter((file) => file.endsWith('.css'));
const productionCode = (files: string[], ignores: string[] = []) => files.filter((file) => /\.tsx?$/.test(file) && !matches(ignores, file));

describe('omfånget för lint-reglerna', () => {
  it('glob-omvandlingen känner igen mapp-, filändelse- och klammermönster', () => {
    expect(globToRegExp('src/a/**/*.{ts,tsx}').test('src/a/b/c.tsx')).toBe(true);
    expect(globToRegExp('src/a/**/*.{ts,tsx}').test('src/a/c.ts')).toBe(true);
    expect(globToRegExp('src/a/**/*.{ts,tsx}').test('src/a/c.css')).toBe(false);
    expect(globToRegExp('src/a/*.ts').test('src/a/b/c.ts')).toBe(false);
    expect(globToRegExp('**/*.test.{ts,tsx}').test('src/x/y.test.ts')).toBe(true);
  });

  it('varje glob i en ESLint-designgrupp matchar minst en produktionsfil', () => {
    expect(eslintConfig.DESIGN_GROUPS.length).toBeGreaterThan(15);
    const empty = eslintConfig.DESIGN_GROUPS.flatMap(({ files, ignores }) =>
      files.filter((glob) => productionCode(sourceFiles.filter((file) => matches([glob], file)), ignores).length === 0),
    );
    expect(empty).toEqual([]);
  });

  it('varje files-glob i ett Stylelint-override matchar minst en CSS-fil', () => {
    const { overrides } = stylelintConfig.default;
    expect(overrides.length).toBeGreaterThan(10);
    const empty = overrides.flatMap(({ files }) => files.filter((glob) => !cssFiles.some((file) => matches([glob], file))));
    expect(empty).toEqual([]);
  });

  it('varje feature under src/features täcks av minst en ESLint-designgrupp (en ny feature kräver en ny designGroup i eslint.config.js)', () => {
    const features = readdirSync(join(frontendDir, 'src/features'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(features.length).toBeGreaterThan(10);
    const uncovered = features.filter((feature) => {
      const files = productionCode(sourceFiles.filter((file) => file.startsWith(`src/features/${feature}/`)));
      return !files.some((file) => eslintConfig.DESIGN_GROUPS.some(({ files: globs, ignores }) => matches(globs, file) && !matches(ignores ?? [], file)));
    });
    expect(uncovered).toEqual([]);
  });
});
