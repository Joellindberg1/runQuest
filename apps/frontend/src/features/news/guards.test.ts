import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('chip-radens scrollcontainer är positionerad: sr-only-spans (position:absolute) annars läcker ut och ger sidled scroll på mobil', () => {
    const rule = stripComments(css).match(/\.rq-news-filter__list\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/overflow-x:\s*auto/);
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
