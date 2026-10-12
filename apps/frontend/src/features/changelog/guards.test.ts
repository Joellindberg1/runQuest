import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Designreglerna för Feature & Version och "What's new"-popupen (tokens, skarpa hörn, ikoner, inga emojis, rörelse, inga tailwind-klasser,
// att CSS-måtten finns i temafilen) vaktas av lint: eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts.
// En guldknapp per vy prövas i PatchNotesModal.test och FeaturesPage.test. changelog.json har EN läsare, och det vaktas av ESLint.

const everyApp = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('Feature & Version — temats radbrytande mått', () => {
  it('mobil-/desktopvarianterna av de radbrytande måtten finns båda (mobil i :root, desktop i @media)', () => {
    const index = readFromDisk('../../index.css');
    const desktop = index.slice(index.indexOf('@media (min-width: 1024px)'), index.indexOf('3. TOKENS — LJUST BRONS'));
    for (const name of ['grid-cols', 'working-cols', 'release-cols', 'release-areas', 'release-gap', 'change-cols', 'change-areas', 'change-align', 'change-gap']) {
      expect({ name, desktop: desktop.includes(`--rq-changelog-${name}:`) }).toEqual({ name, desktop: true });
    }
  });
});

describe('En källa för det gruppen ser', () => {
  // Att bara changelogData läser changelog.json vaktas av ESLint (CHANGELOG_JSON i eslint.config.js). Att den gamla patchNotes.ts/
  // changelogHelpers.ts inte är tillbaka fäller tsc: en import av en saknad modul eller en odeklarerad PATCH_NOTES kompilerar inte.

  it('popupen och onboarding-kön härleder sina poster ur announcedNotes (ingen egen lista)', () => {
    const queue = stripComments(everyApp['../onboarding/hooks/useOnboardingQueue.ts']);
    const orchestrator = stripComments(everyApp['../onboarding/components/OnboardingOrchestrator.tsx']);
    expect(queue).toMatch(/announcedNotes\(changelog\.releases\)/);
    expect(orchestrator).toMatch(/announcedNotes\(changelog\.releases\)/);
    expect(queue).not.toMatch(/patch_/);
  });
});
