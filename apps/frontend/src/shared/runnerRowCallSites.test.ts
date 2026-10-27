import { describe, expect, it } from 'vitest';

// Fokus tillbaka till löparens rad (ADR 006) hittar raden via data-runner-id. En anropsplats som glöms tappar fokusåtergången
// tyst, så platserna är listade här: en ny anropsplats av useOpenRunner måste föras in i listan och bära attributet.

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Filer som anropar `useOpenRunner()` och skickar öppnaren vidare till raderna. */
const CALL_SITES = [
  '/src/features/challenges/components/DuelsScreen.tsx',
  '/src/features/leaderboard/components/SeasonBoard.tsx',
  '/src/features/leaderboard/components/StreaksView.tsx',
  '/src/features/leaderboard/components/WeekView.tsx',
  '/src/features/log/components/LogScreen.tsx',
  '/src/pages/preview/ActiveChallengeWidget.tsx',
];

/** Filerna som ritar elementen som öppnar löparen; var och en måste sätta data-runner-id. */
const ROW_FILES = [
  '/src/features/challenges/components/HistoryList.tsx',
  '/src/features/challenges/components/LiveSection.tsx',
  '/src/features/challenges/components/OfferCards.tsx',
  '/src/features/challenges/components/StandingsTable.tsx',
  '/src/features/leaderboard/components/BoardParts.tsx',
  '/src/features/log/components/GroupHistory.tsx',
  '/src/pages/preview/ActiveChallengeWidget.tsx',
];

describe('runner row call sites', () => {
  it('lists every file that calls useOpenRunner, so a new call site cannot be added unnoticed', () => {
    const found = Object.entries(sources)
      .filter(([path, text]) => path !== '/src/shared/hooks/useOpenRunner.ts' && /\buseOpenRunner\(\)/.test(text))
      .map(([path]) => path)
      .sort();

    expect(found).toEqual([...CALL_SITES].sort());
  });

  it.each(ROW_FILES)('%s sets data-runner-id on the elements that open a runner', (path) => {
    expect(sources[path]).toContain('data-runner-id');
  });
});
