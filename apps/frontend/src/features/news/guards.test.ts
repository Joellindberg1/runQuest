import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Designreglerna för Pack News (tokens, skarpa hörn, ikoner, inga emojis, rörelse, aldrig --rq-text-5, att CSS-måtten finns i temafilen)
// vaktas av lint: eslint.config.js, stylelint.config.js och src/test/themeTokens.sync.test.ts. Kvar här är det lint inte kan uttrycka:
// vilken text som ska ha vilken färg, den positionerade scrollcontainern, och att flödet har EN query-definition med typerna ur
// @runquest/shared (aldrig speglade).

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts', '../../app-shell/NotificationsPopover.tsx', '../../pages/NewsPage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// CSS läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så en glob ger tomma strängar och tysta godkännanden.
const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readFromDisk('./news.css');

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Pack News — läsbar text och scrollcontainer', () => {
  it('tidsklasserna använder --rq-text-4 (≥ 4.5:1) och dagrubriken, som är en eyebrow, följer --rq-text-eyebrow (ägarexperiment 2026-10-06)', () => {
    const code = stripComments(css);
    for (const selector of ['.rq-news-row__time', '.rq-news-pop__time']) {
      const rule = code.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect({ selector, color: rule.match(/color:\s*([^;]+)/)?.[1].trim() }).toEqual({ selector, color: 'var(--rq-text-4)' });
    }
    expect(code.match(/\.rq-news-day__label\s*\{([^}]*)\}/)?.[1]).toMatch(/color:\s*var\(--rq-text-eyebrow\)/);
  });

  it('chip-raden behåller position relative (sju chips scrollar inte sidan)', () => {
    // Chip-radens scrollcontainer är positionerad: sr-only-spans (position:absolute) läcker annars ut och ger sidled scroll på mobil.
    const rule = stripComments(css).match(/\.rq-news-filter__list\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/overflow-x:\s*auto/);
  });
});

/// Ranks är en egen blå kategori (ägarbeslut 3, undantag från designregel 10): tokens ur temafilen, strikt skilda från minor-nivåns blå och badge-serierna.
// Temafilen finns i två exemplar; synktestet kräver identiska rader, den här vakten kräver att rank-tokenarna finns och är egna värden i BÅDA teman.
const THEME_PATHS = { 'index.css': '../../index.css', 'temafil-forslag.css': '../../../../../docs/design/temafil-forslag.css' };

/** Färgen som "r g b" så att en hex, en triplett och rgb(r g b / a) kan jämföras: samma blå under två namn är det vakten förbjuder. */
function colorKey(value: string): string | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(' ');
  const triplet = value.trim().match(/^(?:rgb\()?(\d{1,3}) (\d{1,3}) (\d{1,3})(?:\s*\/[^)]*)?\)?$/);
  return triplet ? `${triplet[1]} ${triplet[2]} ${triplet[3]}` : null;
}

/** Temafilens tokens per tema: mörkt = :root utanför @media, ljust = [data-theme="light"]. Desktop-blocken (@media) är mått, inga färger. */
function themeTokens(theme: string): { dark: Map<string, string>; light: Map<string, string> } {
  const dark = new Map<string, string>();
  const light = new Map<string, string>();
  postcss.parse(theme).walkDecls((decl) => {
    if (!decl.prop.startsWith('--rq-') || decl.parent?.parent?.type === 'atrule') return;
    const inLight = decl.parent?.type === 'rule' && (decl.parent as Rule).selector.includes('light');
    (inLight ? light : dark).set(decl.prop, decl.value.replace(/\s+/g, ' ').trim());
  });
  return { dark, light };
}

/** Deklarationerna i den regel på toppnivå (utanför @media) i news.css vars selektor är exakt `selector`. */
function topRuleOf(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  postcss.parse(css).each((node) => {
    if (node.type !== 'rule' || (node as Rule).selector.replace(/\s+/g, ' ') !== selector) return;
    (node as Rule).walkDecls((decl) => { found[decl.prop] = decl.value.replace(/\s+/g, ' ').trim(); });
  });
  expect({ selector, deklarationer: Object.keys(found).length > 0 }).toEqual({ selector, deklarationer: true });
  return found;
}

// WCAG 2.x-kontrast räknad ur tokens: kanten (alfa ur --rq-news-edge-alpha) över kortet och över det valda chipet, texten mot samma ytor.
const NON_TEXT_CONTRAST = 3;
const TEXT_CONTRAST = 4.5;
type Rgb = [number, number, number];
function colorOf(value: string): { rgb: Rgb; alpha: number } {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return { rgb: [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as Rgb, alpha: 1 };
  const rgba = value.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  const triplet = value.match(/^(\d+) (\d+) (\d+)$/);
  if (triplet) return { rgb: [Number(triplet[1]), Number(triplet[2]), Number(triplet[3])], alpha: 1 };
  throw new Error(`färgen går inte att räkna: ${value}`);
}
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((channel, at) => channel * alpha + bg[at] * (1 - alpha)) as Rgb;
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

describe('Pack News — Ranks-färgen', () => {
  it('rank-tokenarna (--rq-news-rank*) finns i både index.css och temafil-forslag.css och återanvänder inte tier- eller badge-tokens', () => {
    for (const [file, path] of Object.entries(THEME_PATHS)) {
      const { dark, light } = themeTokens(readFromDisk(path));
      // Reserverade värden: minor-nivåns och badge-seriernas färger i BÅDA temana. Ett rank-värde i något tema får inte vara ett av dem.
      const reserved = new Set([...dark, ...light].filter(([name]) => /^--rq-(tier-minor|badge-)/.test(name)).flatMap(([, value]) => colorKey(value) ?? []));
      expect(reserved.size).toBeGreaterThan(3); // en tom jämförelse vore ett tyst godkännande

      for (const [theme, tokens] of [['mörkt', dark], ['ljust', light]] as const) {
        const rank = [...tokens].filter(([name]) => name.startsWith('--rq-news-rank'));
        expect({ file, theme, names: rank.map(([name]) => name).sort() }).toEqual({ file, theme, names: ['--rq-news-rank-ink', '--rq-news-rank-rgb'] });
        for (const [name, value] of rank) {
          // Ingen alias (var(--rq-tier-…), var(--rq-badge-…)) och inget delat värde: egna värden, egen roll.
          expect({ file, theme, name, alias: /var\(\s*--rq-(tier|badge)/.test(value) }).toEqual({ file, theme, name, alias: false });
          expect({ file, theme, name, key: colorKey(value) }).toEqual({ file, theme, name, key: expect.any(String) });
          expect({ file, theme, name, delasMedTierEllerBadge: reserved.has(colorKey(value) ?? '') }).toEqual({ file, theme, name, delasMedTierEllerBadge: false });
        }
      }
    }
  });

  it('rank-kanten når 3:1 mot kortet och det valda chipet, och texten 4.5:1, i mörkt och ljust tema', () => {
    for (const [file, path] of Object.entries(THEME_PATHS)) {
      const { dark, light } = themeTokens(readFromDisk(path));
      for (const [theme, overrides] of [['mörkt', new Map()], ['ljust', light]] as const) {
        const token = (name: string) => (overrides.get(name) ?? dark.get(name)) as string;
        const page = colorOf(token('--rq-bg-page')).rgb;
        const panel = colorOf(token('--rq-panel'));
        const card = over(panel.rgb, panel.alpha, page);
        const edge = colorOf(token('--rq-news-rank-rgb')).rgb;
        const ink = colorOf(token('--rq-news-rank-ink')).rgb;
        const selected = over(edge, Number(token('--rq-tint-selected')), card);
        const edgeAlpha = Number(token('--rq-news-edge-alpha'));
        const measured = {
          file, theme,
          kantMotKort: contrast(over(edge, edgeAlpha, card), card) >= NON_TEXT_CONTRAST,
          kantMotValtChip: contrast(over(edge, edgeAlpha, selected), selected) >= NON_TEXT_CONTRAST,
          textMotKort: contrast(ink, card) >= TEXT_CONTRAST,
          textMotValtChip: contrast(ink, selected) >= TEXT_CONTRAST,
        };
        expect(measured).toEqual({ file, theme, kantMotKort: true, kantMotValtChip: true, textMotKort: true, textMotValtChip: true });
      }
    }
  });

  it('kategorin rank i news.css läser rank-tokenarna: kanten och tinten ur -rgb, texten, ikonen och pricken ur -ink', () => {
    const rule = stripComments(css).match(/\[data-category="rank"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/--rq-c:\s*var\(--rq-news-rank-rgb\)/);
    expect(rule).toMatch(/--rq-c-edge:\s*var\(--rq-news-rank-rgb\)/);
    expect(rule).toMatch(/--rq-c-solid:\s*var\(--rq-news-rank-ink\)/);
  });
});

describe('Pack News — en oläst rank-rad väger inte tyngre än andra olästa rader (ägarbeslut 3)', () => {
  it('ingen oläst-regel nämner rank eller placeringsbrickan, och brickan har fast vikt 400', () => {
    // Allt som gör en rad "oläst" (data-unread, --unread, olästpricken) är gemensamt för alla kategorier: en regel som nämner rank eller brickan
    // tillsammans med olästläget skulle göra en oläst passering tyngre än en oläst titel.
    const unreadSelectors: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      for (const selector of rule.selectors) if (/unread/.test(selector)) unreadSelectors.push(selector.replace(/\s+/g, ' '));
    });
    expect(unreadSelectors.length).toBeGreaterThan(5); // en tom jämförelse vore ett tyst godkännande
    expect(unreadSelectors.filter((selector) => /rank|rq-news-place/.test(selector))).toEqual([]);

    // Brickan har en egen, fast vikt: texten runt blir 500 när raden är oläst, brickan blir det aldrig.
    expect(topRuleOf('.rq-news-place')['font-weight']).toBe('400');
    // Kategorin rank sätter bara kategorins färgvariabler: ingen vikt, bakgrund eller annan betoning.
    const rank = topRuleOf('[data-category="rank"]');
    expect(Object.keys(rank).filter((property) => !property.startsWith('--rq-c'))).toEqual([]);
  });
});

describe('Pack News — chip-radens träffyta och fokusring', () => {
  it('chipet är minst 44 px högt på mobil och fokusringen ritas innanför chipet', () => {
    for (const [file, path] of Object.entries(THEME_PATHS)) {
      expect({ file, hit: themeTokens(readFromDisk(path)).dark.get('--rq-news-filter-hit') }).toEqual({ file, hit: '44px' });
    }
    expect(topRuleOf('.rq-news-filter__item')['min-height']).toBe('var(--rq-news-filter-hit)');
    // Den scrollande raden klipper en ring utanför chipet: ringen ligger innanför, som i raderna.
    expect(topRuleOf('.rq-news-filter__item:focus-visible')['outline-offset']).toBe('var(--rq-focus-inset)');
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
