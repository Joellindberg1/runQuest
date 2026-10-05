import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vakttester över källkoden (ADR 006 beslut 8 + designspråkets regel 1 och 10).

const rawSources = import.meta.glob(['../**/*.{ts,tsx,css}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Vite normaliserar filer i samma mapp som testet till './X'; ge dem sin riktiga mapp igen.
const sources: Record<string, string> = Object.fromEntries(
  Object.entries(rawSources).map(([path, text]) => [path.startsWith('./') ? `../app-shell/${path.slice(2)}` : path, text]),
);

const byPath = (matcher: RegExp) => Object.entries(sources).filter(([path]) => matcher.test(path));

describe('tour-ankarvakten: varje data-tour i turerna finns i en komponentkälla', () => {
  const TOUR_FILES = /onboarding\/(featureTourSteps|onboardingSteps)\.ts$/;

  const tourAnchors = byPath(TOUR_FILES).flatMap(([, text]) =>
    Array.from(text.matchAll(/data-tour="([^"]+)"/g), (m) => m[1]),
  );

  // Komponentkällor = allt utom turfilerna själva. Ankaret ska stå som en strängliteral i en fil
  // som sätter data-tour/tourAnchor (skalet skriver `data-tour="…"`, Leaderboard skickar namnet vidare).
  const componentSources = Object.entries(sources).filter(
    ([path, text]) => !TOUR_FILES.test(path) && /\.tsx?$/.test(path) && /data-tour|tourAnchor/.test(text),
  );

  it('hittar turfilerna och deras ankare', () => {
    expect(byPath(TOUR_FILES)).toHaveLength(2);
    expect(tourAnchors.length).toBeGreaterThan(10);
  });

  it.each([...new Set(tourAnchors)])('ankaret %s finns i en komponent', (anchor) => {
    const declared = componentSources.some(([, text]) => text.includes(`'${anchor}'`) || text.includes(`"${anchor}"`));
    expect(declared).toBe(true);
  });

  it('onboarding_v1 pekar på skalets ankare, inte på det gamla sidebar-*', () => {
    const [, onboarding] = byPath(/onboardingSteps\.ts$/)[0];
    expect(onboarding).not.toMatch(/data-tour="sidebar-/);
    for (const anchor of ['nav-ranks', 'nav-titles', 'nav-duels', 'nav-new', 'nav-you', 'right-now-strava', 'header-events', 'nav-events']) {
      expect(onboarding).toContain(`data-tour="${anchor}"`);
    }
  });
});

describe('nya skal-filer följer designspråket', () => {
  const shellFiles = Object.entries(sources).filter(
    ([path]) => /\/app-shell\/[^/]+\.(tsx?|css)$/.test(path) || /\/(paths|routes)\.tsx?$/.test(path) || /pages\/(NewsPage|NotFound|Index|RunnerPage).tsx$/.test(path) || /shared\/components\/EmptyState\.tsx$/.test(path),
  );

  it('hittar skal-filerna', () => {
    expect(shellFiles.length).toBeGreaterThan(15);
  });

  it('ingen lucide-import i nya skal-filer (RQIcon är enda ikonkällan, regel 10)', () => {
    for (const [path, text] of shellFiles) {
      expect({ path, lucide: /lucide-react/.test(text) }).toEqual({ path, lucide: false });
    }
  });

  it('inga råvärden: hex, rgba(), px i klassnamn eller inline-styles i skalets komponenter (regel 1)', () => {
    for (const [path, text] of shellFiles) {
      const hex = text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const rgba = text.match(/rgba?\(/g) ?? [];
      const inlineStyle = text.match(/style=\{\{/g) ?? [];
      const pxInClass = (text.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? []).filter((c) => /[\d.]+px/.test(c));
      expect({ path, hex, rgba, inlineStyle, pxInClass }).toEqual({ path, hex: [], rgba: [], inlineStyle: [], pxInClass: [] });
    }
  });

  it('skalets CSS använder bara tokens: inga px-mått, hex eller rgba()', () => {
    // Läses från disk: vitest (css: false) tömmer ?raw-importer av .css, så globben ger en tom sträng.
    const css = readFileSync(resolve(process.cwd(), 'src/app-shell/app-shell.css'), 'utf8');
    expect(css.length).toBeGreaterThan(200);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments.match(/[\d.]+px/g) ?? []).toEqual([]);
    expect(withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    // rgb(var(--rq-…-rgb) / alfa) är det sanktionerade alfa-receptet; bokstavliga rgb()/rgba() är det inte.
    expect(withoutComments.match(/rgba\(|rgb\(\s*\d/g) ?? []).toEqual([]);
    expect(withoutComments.match(/border-radius:\s*(?!0|var\(--rq-radius)/g) ?? []).toEqual([]);
  });
});

describe('kända trasiga variabler är borta', () => {
  it('ingen hsl(var(--sidebar)) eller var(--rq-foreground) kvar i källan', () => {
    for (const [path, text] of Object.entries(sources)) {
      expect({ path, sidebar: /hsl\(var\(--sidebar\)\)/.test(text) }).toEqual({ path, sidebar: false });
      expect({ path, foreground: /var\(--rq-foreground\)/.test(text) }).toEqual({ path, foreground: false });
    }
  });

  it('inga Silkscreen-rester', () => {
    for (const [path, text] of Object.entries(sources)) {
      expect({ path, silkscreen: /silkscreen/i.test(text) }).toEqual({ path, silkscreen: false });
    }
  });
});
