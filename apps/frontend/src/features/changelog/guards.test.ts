import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Feature & Version och "What's new"-popupen: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn),
// 3 (EN guldknapp), 8 (rörelse), 10 (ikoner ur RQIcon, inga emojis) + att CSS-måtten finns i temafilen (index.css OCH docs/design/temafil-forslag.css)
// + att changelog.json har EN läsare och att den gamla patchNotes.ts/changelogHelpers.ts inte har kommit tillbaka.

const sources = import.meta.glob(
  [
    './**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}',
    '../../pages/FeaturesPage.tsx',
    '../onboarding/components/PatchNotesModal.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const everyApp = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const existsOnDisk = (relative: string) => existsSync(fileURLToPath(new URL(relative, import.meta.url)));
const stylesheets = { 'changelog.css': readFromDisk('./changelog.css'), 'whatsNew.css': readFromDisk('../onboarding/whatsNew.css') };

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Feature & Version och "What\'s new" följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(8);
    for (const css of Object.values(stylesheets)) expect(css.length).toBeGreaterThan(500);
  });

  it('ingen lucide-import, inga egna <svg> och ingen shadcn-komponent (RQIcon är enda ikonkällan)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, lucide: /lucide-react/.test(text), svg: /<svg/.test(text), shadcn: /shared\/components\/ui\//.test(text) }).toEqual({ path, lucide: false, svg: false, shadcn: false });
    }
  });

  it('inga emojis i UI-texten (regel 10)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, emoji: stripComments(text).match(/\p{Extended_Pictographic}/gu) ?? [] }).toEqual({ path, emoji: [] });
    }
  });

  it('inga hex, rgba() eller px i klassnamn, inga inline-styles och inga tailwind-klasser', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      const classNames = code.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? [];
      expect({
        path,
        hex: code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
        rgba: code.match(/rgba?\(/g) ?? [],
        pxInClass: classNames.filter((c) => /[\d.]+px/.test(c)),
        inline: code.match(/style=\{/g) ?? [],
        tailwind: classNames.filter((c) => /["' ](?:flex|grid|p[xytblr]?-\d|m[xytblr]?-\d|text-(?:xs|sm|lg|foreground)|bg-|border-\[|w-\d|h-\d|gap-\d|rounded)/.test(c)),
      }).toEqual({ path, hex: [], rgba: [], pxInClass: [], inline: [], tailwind: [] });
    }
  });

  it('engelskt UI: inga toast-anrop och inga Intl-/locale-datumformat (datumen står som text i changelog.json)', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, sonner: /from ['"]sonner['"]/.test(code), toast: /\btoast[.(]/.test(code), locale: /toLocale(Date|Time)?String|Intl\.DateTimeFormat|new Date\(/.test(code) })
        .toEqual({ path, sonner: false, toast: false, locale: false });
    }
  });

  it.each(Object.entries(stylesheets))('%s: bara tokens — px, hex och rgba() finns inte, och inga hörn utom token-radie', (_name, css) => {
    const code = stripComments(css).replace(/@media[^{]*\{/g, '{');
    expect({
      px: code.match(/[\d.]+px/g) ?? [],
      hex: code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
      rgba: code.match(/rgba\(|rgb\(\s*\d/g) ?? [],
      radius: [...code.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((value) => !value.startsWith('var(--rq-radius')),
    }).toEqual({ px: [], hex: [], rgba: [], radius: [] });
  });

  it.each(Object.entries(stylesheets))('%s: inga :root-definitioner; de enda egna custom properties är kantvariablerna och --rq-kind', (_name, css) => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    const declared = new Set([...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const name of declared) expect(['--rq-edge', '--rq-edge-line', '--rq-kind']).toContain(name);
  });

  it.each(Object.entries(stylesheets))('%s: line-height och typsnitt kommer ur tokens, inget har transition', (_name, css) => {
    const code = stripComments(css);
    const lineHeights = [...code.matchAll(/line-height:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(lineHeights.filter((value) => !value.startsWith('var(--rq-lh-'))).toEqual([]);
    const families = [...code.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(families.filter((family) => !family.startsWith('var(--rq-font-'))).toEqual([]);
    expect(code).not.toMatch(/transition\s*:/);
  });

  it('rörelse: ingenting animerar eller loopar i changelog.css (sidan glider in med den delade .rq-rise, popupen står still)', () => {
    for (const css of Object.values(stylesheets)) expect(stripComments(css)).not.toMatch(/animation|@keyframes/);
  });

  it('läsbar text är aldrig --rq-text-5 (dekornivå, WCAG)', () => {
    for (const css of Object.values(stylesheets)) expect(stripComments(css)).not.toMatch(/--rq-text-5/);
  });

  it('popupen har EN guldknapp och ingen annan fylld knapp (regel 3), sidan har ingen alls', () => {
    const modal = stripComments(sources['../onboarding/components/PatchNotesModal.tsx']);
    expect(modal.match(/rq-btn--primary/g) ?? []).toHaveLength(1);
    expect(modal).not.toMatch(/rq-btn--danger-fill|rq-btn--fab/);
    for (const [path, text] of codeFiles) {
      if (path.includes('PatchNotesModal')) continue;
      expect({ path, primary: /rq-btn--primary/.test(stripComments(text)) }).toEqual({ path, primary: false });
    }
  });

  it('varje --rq-changelog-*/--rq-whatsnew-*-mått som css:en läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const pattern = /--rq-(?:changelog|whatsnew)-[a-z0-9-]+/g;
    const used = new Set(Object.values(stylesheets).flatMap((css) => [...css.matchAll(new RegExp(`var\\((${pattern.source})\\)`, 'g'))].map((m) => m[1])));
    expect(used.size).toBeGreaterThan(8);

    const index = readFromDisk('../../index.css');
    const facit = readFromDisk('../../../../../docs/design/temafil-forslag.css');
    const declared = (text: string) => new Set([...text.matchAll(new RegExp(`^\\s*(${pattern.source}):`, 'gm'))].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });

  it('mobil-/desktopvarianterna av de radbrytande måtten finns båda (mobil i :root, desktop i @media)', () => {
    const index = readFromDisk('../../index.css');
    const desktop = index.slice(index.indexOf('@media (min-width: 1024px)'), index.indexOf('3. TOKENS — LJUST BRONS'));
    for (const name of ['grid-cols', 'working-cols', 'release-cols', 'release-areas', 'release-gap', 'change-cols', 'change-areas', 'change-align', 'change-gap']) {
      expect({ name, desktop: desktop.includes(`--rq-changelog-${name}:`) }).toEqual({ name, desktop: true });
    }
  });
});

describe('En källa för det gruppen ser', () => {
  it('bara changelogData läser changelog.json', () => {
    for (const [path, text] of Object.entries(everyApp)) {
      if (path.endsWith('changelogData.ts')) continue;
      expect({ path, reads: /data\/changelog\.json/.test(stripComments(text)) }).toEqual({ path, reads: false });
    }
  });

  it('den gamla patchNotes.ts och changelogHelpers.ts finns inte kvar, och ingen kod refererar PATCH_NOTES', () => {
    expect(existsOnDisk('../onboarding/patchNotes.ts')).toBe(false);
    expect(existsOnDisk('../../shared/utils/changelogHelpers.ts')).toBe(false);
    for (const [path, text] of Object.entries(everyApp)) expect({ path, old: /PATCH_NOTES|changelogHelpers|onboarding\/patchNotes/.test(stripComments(text)) }).toEqual({ path, old: false });
  });

  it('popupen och onboarding-kön härleder sina poster ur announcedNotes (ingen egen lista)', () => {
    const queue = stripComments(everyApp['../onboarding/hooks/useOnboardingQueue.ts']);
    const orchestrator = stripComments(everyApp['../onboarding/components/OnboardingOrchestrator.tsx']);
    expect(queue).toMatch(/announcedNotes\(changelog\.releases\)/);
    expect(orchestrator).toMatch(/announcedNotes\(changelog\.releases\)/);
    expect(queue).not.toMatch(/patch_/);
  });
});
