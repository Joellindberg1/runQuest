import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vakt över kodsplittringen (ADR 006 beslut 11, RUN-219). Att lazy-sidorna och OnboardingOrchestrator aldrig importeras statiskt
// vaktas av ESLint (no-restricted-imports i eslint.config.js); här ligger det som lint inte kan se.

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8');
const routes = read('routes.tsx');

const staticImports = (text: string) =>
  Array.from(text.matchAll(/^import\s[^;]*?(?:from\s+)?['"]([^'"]+)['"];?\s*$/gm), (m) => m[1]);

describe('routes.tsx: statisk CSS', () => {
  it('app-shell.css är den enda statiska feature-CSS:en', () => {
    expect(staticImports(routes).filter((path) => path.endsWith('.css'))).toEqual(['@/app-shell/app-shell.css']);
  });
});

describe('lazy-gränser', () => {
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
