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

// Ranks är en egen blå kategori (ägarbeslut 3, undantag från designregel 10): tokens ur temafilen, strikt skilda från minor-nivåns blå och badge-serierna.
// Temafilen finns i två exemplar; synktestet kräver identiska rader, den här vakten kräver att rank-tokenarna finns och är egna värden.
const THEME_PATHS = { 'index.css': '../../index.css', 'temafil-forslag.css': '../../../../../docs/design/temafil-forslag.css' };

/** Färgen som "r g b" så att en hex, en triplett och rgb(r g b / a) kan jämföras: samma blå under två namn är det vakten förbjuder. */
function colorKey(value: string): string | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(' ');
  const triplet = value.trim().match(/^(?:rgb\()?(\d{1,3}) (\d{1,3}) (\d{1,3})(?:\s*\/[^)]*)?\)?$/);
  return triplet ? `${triplet[1]} ${triplet[2]} ${triplet[3]}` : null;
}

function darkTokens(theme: string): Map<string, string> {
  const found = new Map<string, string>();
  postcss.parse(theme).walkDecls((decl) => {
    const inLight = decl.parent?.type === 'rule' && (decl.parent as Rule).selector.includes('light');
    const inMedia = decl.parent?.parent?.type === 'atrule';
    if (decl.prop.startsWith('--rq-') && !inLight && !inMedia) found.set(decl.prop, decl.value.replace(/\s+/g, ' ').trim());
  });
  return found;
}

describe('Pack News — Ranks-färgen', () => {
  it('rank-tokenarna (--rq-news-rank*) finns i både index.css och temafil-forslag.css och återanvänder inte tier- eller badge-tokens', () => {
    const perFile = Object.entries(THEME_PATHS).map(([file, path]) => ({ file, tokens: darkTokens(readFromDisk(path)) }));
    for (const { file, tokens } of perFile) {
      const rank = [...tokens].filter(([name]) => name.startsWith('--rq-news-rank'));
      expect({ file, names: rank.map(([name]) => name).sort() }).toEqual({ file, names: ['--rq-news-rank-ink', '--rq-news-rank-rgb'] });

      // Ingen alias (var(--rq-tier-…), var(--rq-badge-…)) och inget värde som minor-nivåns eller en badge-serie har: egna värden, egen roll.
      const reserved = new Set([...tokens].filter(([name]) => /^--rq-(tier-minor|badge-)/.test(name)).flatMap(([, value]) => colorKey(value) ?? []));
      expect(reserved.size).toBeGreaterThan(3); // en tom jämförelse vore ett tyst godkännande
      for (const [name, value] of rank) {
        expect({ file, name, alias: /var\(\s*--rq-(tier|badge)/.test(value) }).toEqual({ file, name, alias: false });
        expect({ file, name, key: colorKey(value) }).toEqual({ file, name, key: expect.any(String) });
        expect({ file, name, delasMedTierEllerBadge: reserved.has(colorKey(value) ?? '') }).toEqual({ file, name, delasMedTierEllerBadge: false });
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
