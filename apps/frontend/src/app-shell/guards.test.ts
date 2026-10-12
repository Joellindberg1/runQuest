import { describe, expect, it } from 'vitest';

// Vakttester över källkoden (ADR 006 beslut 8). Designreglerna för skalet (inga lucide, inga råvärden, bara tokens i app-shell.css) och de
// kända trasiga variablerna (hsl(var(--sidebar)), var(--rq-foreground), Silkscreen) vaktas av lint: eslint.config.js och stylelint.config.js.

const rawSources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
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
