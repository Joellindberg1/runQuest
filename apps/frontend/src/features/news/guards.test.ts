import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester över Pack News-filerna (+ klockpopovern i skalet): designspråkets regel 1 (tokens, inga råvärden), 2 (skarpa hörn),
// 8 (rörelse), 10 (ikoner ur RQIcon, inga emojis) + att CSS-måtten finns i temafilen (index.css OCH docs/design/temafil-forslag.css)
// + att flödet har EN query-definition och att typerna kommer ur @runquest/shared (aldrig speglade).

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts', '../../app-shell/NotificationsPopover.tsx', '../../pages/NewsPage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./news.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Pack News-filerna följer designspråket', () => {
  it('hittar filerna', () => {
    expect(codeFiles.length).toBeGreaterThan(8);
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

  it('inga hex, rgba() eller px i klassnamn, och inga inline-styles', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const rgba = code.match(/rgba?\(/g) ?? [];
      const pxInClass = (code.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? []).filter((c) => /[\d.]+px/.test(c));
      expect({ path, hex, rgba, pxInClass, inline: code.match(/style=\{/g) ?? [] }).toEqual({ path, hex: [], rgba: [], pxInClass: [], inline: [] });
    }
  });

  it('engelskt UI i en-GB: ingen sv-SE, inga toast-anrop (bekräftelser står i role=status, fel i role=alert) och inga Intl-datumformat', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({
        path, svSE: /sv-SE/.test(code), sonner: /from ['"]sonner['"]/.test(code), toast: /\btoast[.(]/.test(code),
        locale: /toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(code),
      }).toEqual({ path, svSE: false, sonner: false, toast: false, locale: false });
    }
  });

  it('CSS: bara tokens — px, hex och rgba() finns inte, och inga hörn utom token-radie', () => {
    const code = stripComments(css).replace(/@media[^{]*\{/g, '{');
    expect({
      px: code.match(/[\d.]+px/g) ?? [],
      hex: code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
      rgba: code.match(/rgba\(|rgb\(\s*\d/g) ?? [],
      radius: [...code.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((value) => !value.startsWith('var(--rq-radius')),
    }).toEqual({ px: [], hex: [], rgba: [], radius: [] });
  });

  it('news.css har inga :root-definitioner; de enda egna custom properties är de delade chip-/kantvariablerna', () => {
    const code = stripComments(css);
    expect(code).not.toMatch(/:root/);
    const declared = new Set([...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    expect([...declared].sort()).toEqual(['--rq-c', '--rq-c-edge', '--rq-c-solid']);
  });

  it('line-height är aldrig ett råvärde (var(--rq-lh-*)), typsnitten kommer ur tokens och inget har z-index eller transition', () => {
    const code = stripComments(css);
    const lineHeights = [...code.matchAll(/line-height:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(lineHeights.length).toBeGreaterThan(3);
    expect(lineHeights.filter((value) => !value.startsWith('var(--rq-lh-'))).toEqual([]);
    const families = [...code.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(3);
    expect(families.filter((family) => !family.startsWith('var(--rq-font-'))).toEqual([]);
    // Popovern ärver z-index 60 från .rq-popover (skalets flytande lager).
    expect(code).not.toMatch(/z-index/);
    expect(code).not.toMatch(/transition\s*:/);
  });

  it('rörelse: ingenting animerar eller loopar i Pack News (rader och räknare står stilla — bara skelettet, som delas, blinkar)', () => {
    expect(stripComments(css)).not.toMatch(/animation|@keyframes/);
  });

  it('varje --rq-news-*-mått som news.css läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom', () => {
    const used = new Set([...css.matchAll(/var\((--rq-news-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);

    const index = readFromDisk('../../index.css');
    const facit = readFromDisk('../../../../../docs/design/temafil-forslag.css');
    const declared = (text: string) => new Set([...text.matchAll(/^\s*(--rq-news-[a-z0-9-]+):/gm)].map((m) => m[1]));
    // Ett mått får läsas av ett annat mått (--rq-news-split-cols → --rq-news-filter-w).
    const readByTokens = new Set([...index.matchAll(/^\s*--rq-news-[a-z0-9-]+:[^;]*var\((--rq-news-[a-z0-9-]+)\)/gm)].map((m) => m[1]));

    for (const name of used) {
      expect({ name, index: declared(index).has(name), facit: declared(facit).has(name) }).toEqual({ name, index: true, facit: true });
    }
    // Ett mått som ingen läser är en kvarglömd token.
    for (const name of declared(index)) expect({ name, used: used.has(name) || readByTokens.has(name) }).toEqual({ name, used: true });
    expect([...declared(index)].sort()).toEqual([...declared(facit)].sort());
  });
});

describe('Pack News bygger på delade definitioner, inte egna kopior', () => {
  it('typerna kommer ur @runquest/shared: ingen egen NewsItem/NewsMeta/ActivityType-deklaration', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, own: /^\s*(export\s+)?(interface|type)\s+(NewsItem|NewsMeta|NewsApiResponse|NewsSeenApiResponse|ActivityType|NewsUserRef)\b/m.test(code) }).toEqual({ path, own: false });
    }
  });

  it('flödet har EN query-definition: bara useNewsQueries anropar backendApi.getNews/markNewsSeen och skriver news-nycklar', () => {
    for (const [path, text] of codeFiles) {
      if (path.endsWith('hooks/useNewsQueries.ts')) continue;
      const code = stripComments(text);
      expect({ path, api: /getNews|markNewsSeen/.test(code), keys: /\[\s*'news'/.test(code) }).toEqual({ path, api: false, keys: false });
    }
  });

  it('klockan och skärmen läser flödet via samma hook (useNewsFeed)', () => {
    expect(sources['../../app-shell/NotificationsPopover.tsx']).toMatch(/useNewsUnreadCount/);
    expect(sources['./components/NewsPopoverPanel.tsx']).toMatch(/useNewsFeed\(null\)/);
    expect(sources['./components/NewsScreen.tsx']).toMatch(/useNewsFeed\(/);
  });

  it('filterkartan mappas i klienten (newsModel) — ingen annan fil räknar upp händelsetyper', () => {
    for (const [path, text] of codeFiles) {
      if (path.endsWith('newsModel.ts')) continue;
      const code = stripComments(text);
      expect({ path, types: /'(title_taken|title_unlocked|level_up|run_milestone|streak_broken|challenge_won)'/.test(code) }).toEqual({ path, types: false });
    }
  });

  it('mutationerna för "Mark all read" optimistiska med återställning: onMutate, onError och invalidering finns', () => {
    const hooks = stripComments(sources['./hooks/useNewsQueries.ts']);
    expect(hooks).toMatch(/onMutate/);
    expect(hooks).toMatch(/onError/);
    expect(hooks).toMatch(/invalidateQueries/);
  });
});
