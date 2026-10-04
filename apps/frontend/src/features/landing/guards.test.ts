import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Landing-filerna: designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn), 3 (en guldknapp),
// 8 (rörelse), 10 (ikoner, inga emojis) + ägarbeslut 4 (hårdskriven data: inga anrop) + att CSS-måtten finns i temafilen
// (index.css OCH docs/design/temafil-forslag.css).

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/LandingPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const indexPage = import.meta.glob('../../pages/Index.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./landing.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Landing-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(5);
    expect(css.length).toBeGreaterThan(500);
  });

  it('ingen lucide-import; <svg> finns bara i arena-banan (RQLogo/RQIcon är ikonkällan)', () => {
    for (const [path, text] of codeFiles) {
      expect({ path, lucide: /lucide-react/.test(text) }).toEqual({ path, lucide: false });
      if (!path.endsWith('ArenaTrack.tsx')) expect({ path, svg: /<svg/.test(text) }).toEqual({ path, svg: false });
    }
    expect(sources['./components/ArenaTrack.tsx']).toMatch(/aria-hidden="true"/);
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

  it('engelskt UI i en-GB: ingen sv-SE, inga toast-anrop, inga egna Intl-/toLocale-format', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({
        path,
        svSE: /sv-SE/.test(code),
        sonner: /from ['"]sonner['"]/.test(code),
        toast: /\btoast[.(]/.test(code),
        locale: /toLocale(Date|Time)?String|Intl\.(DateTimeFormat|NumberFormat)/.test(code),
      }).toEqual({ path, svSE: false, sonner: false, toast: false, locale: false });
    }
  });

  it('EN guldknapp per vy (regel 3): rq-btn--primary förekommer en gång i hela featuren', () => {
    const count = codeFiles.reduce((sum, [, text]) => sum + (stripComments(text).match(/rq-btn--primary/g) ?? []).length, 0);
    expect(count).toBe(1);
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

  it('landing.css har inga egna :root-definitioner och deklarerar inga egna custom properties', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    expect([...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])).toEqual([]);
  });

  it('line-height är aldrig ett enhetslöst råvärde (använd var(--rq-lh-*)) och inget z-index (inga lager)', () => {
    const code = stripComments(css);
    const lineHeights = [...code.matchAll(/line-height:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(lineHeights.length).toBeGreaterThan(1);
    expect(lineHeights.filter((value) => !value.startsWith('var(--rq-lh-'))).toEqual([]);
    expect(code).not.toMatch(/z-index/);
  });

  it('typsnitten kommer ur tokens: inga font-family utom var(--rq-font-*)', () => {
    const families = [...stripComments(css).matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(3);
    expect(families.filter((family) => !family.startsWith('var(--rq-font-'))).toEqual([]);
  });

  it('rörelse (regel 8): bara levande saker loopar — löparna, "+50 XP"-poppen, kortets guldring och sweep; inga transitions', () => {
    const code = stripComments(css);
    const animations = [...code.matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(animations).toEqual([
      'rqOrbit var(--rq-landing-lap-1) linear infinite',
      'rqOrbit var(--rq-landing-lap-2) linear infinite',
      'rqOrbit var(--rq-landing-lap-3) linear infinite',
      'rqLandingPop var(--rq-landing-lap-1) linear infinite',
      'rqRing var(--rq-landing-pulse) ease-in-out infinite',
      'rqSweep var(--rq-landing-sweep) linear infinite',
    ]);
    expect(code).not.toMatch(/transition\s*:/);
  });

  it('reducerad rörelse hanteras av temafilens globala regel — landing.css sätter ingen egen animation-duration/!important', () => {
    expect(readFromDisk('../../index.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-iteration-count: 1 !important/);
    const code = stripComments(css);
    expect(code).not.toMatch(/animation-duration|!important/);
  });

  it('varje --rq-landing-*-mått som landing.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const used = new Set([...css.matchAll(/var\((--rq-landing-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(20);

    const index = readFromDisk('../../index.css');
    const facit = readFromDisk('../../../../../docs/design/temafil-forslag.css');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-landing-[a-z0-9-]+):/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });
});

describe('Landing är publik och gör inga anrop (ägarbeslut 4)', () => {
  it('ingen fil hämtar data: inga fetch-anrop, backendApi, react-query, supabase eller datahooks', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({
        path,
        fetch: /\bfetch\(/.test(code),
        api: /backendApi|services\/|react-query|supabase|axios/.test(code),
        hooks: /useUsersWithRuns|useXpConfig|useGroupName|useQuery|useMutation|useAuth/.test(code),
      }).toEqual({ path, fetch: false, api: false, hooks: false });
    }
  });

  it('exempeldatan är EN delad definition (features/leaderboard/previewUsers) — featuren skriver inga egna löpare', () => {
    expect(sources['./components/LandingScreen.tsx']).toMatch(/leaderboard\/previewUsers/);
    for (const [path, text] of codeFiles) expect({ path, ownUsers: /total_xp\s*:/.test(stripComments(text)) }).toEqual({ path, ownUsers: false });
  });

  it('XP- och streak-siffrorna i texten kommer ur shared-definitionerna, inte ur en egen kopia (ADR 004)', () => {
    const model = sources['./landingModel.ts'];
    expect(model).toMatch(/DEFAULT_ADMIN_SETTINGS/);
    expect(model).toMatch(/DEFAULT_STREAK_MULTIPLIERS/);
    for (const [path, text] of codeFiles) expect({ path, constants: /streakConstants/.test(stripComments(text)) }).toEqual({ path, constants: false });
  });
});

describe('Routing (ADR 006)', () => {
  it('Index visar Landing för utloggade — LoginPage nås via /login, inte via /', () => {
    const [source] = Object.values(indexPage);
    expect(source).toMatch(/LandingPage/);
    expect(source).not.toMatch(/LoginPage/);
  });

  it('sidan är tunn: LandingPage monterar bara LandingScreen', () => {
    const page = stripComments(sources['../../pages/LandingPage.tsx']);
    expect(page).toMatch(/<LandingScreen \/>/);
    expect(page.split('\n').length).toBeLessThan(12);
  });
});
