import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vakt över kodsplittringen (ADR 006 beslut 11, RUN-219): vad som är lazy och vad som är eager, läst ur källan.

const rawSources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8');
const routes = read('routes.tsx');

const staticImports = (text: string) =>
  Array.from(text.matchAll(/^import\s[^;]*?(?:from\s+)?['"]([^'"]+)['"];?\s*$/gm), (m) => m[1]);

const LAZY_ONLY = /@\/pages\/(Index|\w+PreviewPage)$|onboarding\/components\/OnboardingOrchestrator$/;

describe('routes.tsx: statisk CSS', () => {
  it('app-shell.css är den enda statiska feature-CSS:en', () => {
    expect(staticImports(routes).filter((path) => path.endsWith('.css'))).toEqual(['@/app-shell/app-shell.css']);
  });
});

describe('lazy-gränser', () => {
  it.each([
    ['@/pages/Index'],
    ['@/pages/LeaderboardPreviewPage'],
    ['@/pages/ChallengesPreviewPage'],
    ['@/pages/BadgesPreviewPage'],
    ['@/pages/AdminPage'],
    ['@/pages/PlaybookPage'],
    ['@/pages/FeaturesPage'],
    ['@/pages/SettingsPage'],
  ])('%s importeras bara via lazy() i routes.tsx', (module) => {
    expect(staticImports(routes)).not.toContain(module);
    expect(routes).toContain(`lazy(() => import('${module}'))`);
  });

  it('landningen, preview-sidorna och OnboardingOrchestrator importeras inte statiskt av någon källfil', () => {
    const offenders = Object.entries(rawSources).flatMap(([path, text]) =>
      staticImports(text)
        .filter((module) => LAZY_ONLY.test(module))
        .map((module) => `${path} -> ${module}`),
    );
    expect(offenders).toEqual([]);
  });

  it('OnboardingOrchestrator laddas via lazy() i App.tsx', () => {
    expect(read('App.tsx')).toMatch(/lazy\(\(\) =>\s*import\('\.\/features\/onboarding\/components\/OnboardingOrchestrator'\)/);
  });

  it('skalet och huvudsidorna är eager', () => {
    const imports = staticImports(routes);
    for (const module of [
      '@/app-shell/AppShell', '@/pages/BoardPage', '@/pages/LogPage', '@/pages/ProfilePage', '@/pages/DuelsPage', '@/pages/TitlesPage',
      '@/pages/EventsPage', '@/pages/RunnerPage', '@/pages/BadgesPage', '@/pages/NewsPage', '@/pages/NotFound',
    ]) {
      expect(imports).toContain(module);
    }
  });
});
