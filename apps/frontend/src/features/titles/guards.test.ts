import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Titles (tokens, skarpa hörn, ikoner, inga emojis, att CSS-måtten finns i temafilen) vaktas av lint: eslint.config.js,
// stylelint.config.js och src/test/themeTokens.sync.test.ts. Kvar här är att titelnamn aldrig hårdkodas (ägarbeslut 3), som läser designfiler.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/TitlesPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('titlar kommer ur databasen (ägarbeslut 3)', () => {
  // Namnen härleds ur prototypfilerna (name: 'The …'), så nya designnamn fångas automatiskt. "The " tas bort så att
  // varianter ("Lunch Breaker") också träffas.
  const prototypes = ['RunQuest App Prototype.dc.html', 'RunQuest Web Prototype.dc.html'].map((file) =>
    readFromDisk(`../../../../../docs/design/claude-design/${file}`),
  );
  const names = [...new Set(prototypes.flatMap((html) => [...html.matchAll(/name: '(The [^']+)'/g)].map((m) => m[1].replace(/^The /, ''))))];

  it('hittar designnamnen i prototyperna', () => {
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain('Hamster');
  });

  it('ingen källfil hårdkodar ett titelnamn (designens påhittade eller dagens)', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, names: names.filter((name) => code.includes(name)) }).toEqual({ path, names: [] });
    }
  });
});
