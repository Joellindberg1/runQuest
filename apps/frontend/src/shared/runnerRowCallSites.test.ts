import { describe, expect, it } from 'vitest';

// Fokus tillbaka till löparens rad (ADR 006) hittar raden via data-runner-id. En anropsplats som glöms tappar fokusåtergången
// tyst, så platserna är listade här med filerna som ritar raderna: en ny fil som importerar useOpenRunner måste föras in med sina
// radfiler, och varje radfil måste sätta attributet. Det riktiga skyddet är beteendetesterna per vy; det här fångar den glömda platsen.

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HOOK_FILE = '/src/shared/hooks/useOpenRunner.ts';

/** Filen som anropar öppnaren → filerna som ritar elementen som öppnar löparen. */
const CALL_SITES: Record<string, string[]> = {
  '/src/features/challenges/components/DuelsScreen.tsx': [
    '/src/features/challenges/components/HistoryList.tsx',
    '/src/features/challenges/components/LiveSection.tsx',
    '/src/features/challenges/components/OfferCards.tsx',
    '/src/features/challenges/components/StandingsTable.tsx',
  ],
  '/src/features/leaderboard/components/SeasonBoard.tsx': ['/src/features/leaderboard/components/BoardParts.tsx'],
  '/src/features/leaderboard/components/StreaksView.tsx': ['/src/features/leaderboard/components/BoardParts.tsx'],
  '/src/features/leaderboard/components/WeekView.tsx': ['/src/features/leaderboard/components/BoardParts.tsx'],
  '/src/features/log/components/LogScreen.tsx': ['/src/features/log/components/GroupHistory.tsx'],
  '/src/pages/preview/ActiveChallengeWidget.tsx': ['/src/pages/preview/ActiveChallengeWidget.tsx'],
};

/** Importerar filen `useOpenRunner` ur hooken, också under ett annat namn (`as useOpen`) eller som namnrymd (`* as hooks`)? */
function importsOpener(text: string): boolean {
  const imports = text.matchAll(/import\s+([^'"]+?)\s+from\s+['"][^'"]*\/useOpenRunner['"]/g);
  return [...imports].some(([, clause]) => /\buseOpenRunner\b/.test(clause!) || /\*\s*as\s/.test(clause!));
}

describe('runner row call sites', () => {
  it('lists every file that imports useOpenRunner, so a new call site cannot be added unnoticed', () => {
    const found = Object.entries(sources)
      .filter(([path, text]) => path !== HOOK_FILE && importsOpener(text))
      .map(([path]) => path)
      .sort();

    expect(found).toEqual(Object.keys(CALL_SITES).sort());
  });

  it('recognises an aliased or namespace import of the hook', () => {
    expect(importsOpener("import { useOpenRunner as useOpen } from '@/shared/hooks/useOpenRunner';")).toBe(true);
    expect(importsOpener("import * as hooks from '@/shared/hooks/useOpenRunner';")).toBe(true);
    expect(importsOpener("import { useCloseRunner } from '@/shared/hooks/useOpenRunner';")).toBe(false);
  });

  it.each(Object.entries(CALL_SITES))('%s names the files that render its runner rows', (_callSite, rowFiles) => {
    expect(rowFiles.length).toBeGreaterThan(0);
    for (const file of rowFiles) expect(sources[file], `${file} exists`).toBeDefined();
  });

  it.each([...new Set(Object.values(CALL_SITES).flat())].sort())('%s sets data-runner-id on the elements that open a runner', (path) => {
    expect(sources[path]).toContain('data-runner-id');
  });
});
