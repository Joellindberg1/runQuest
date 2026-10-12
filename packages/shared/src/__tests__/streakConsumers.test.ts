/**
 * RUN-216 T3 — statisk kontroll: streak räknas på ETT ställe (packages/shared/src/streak.ts).
 *
 * Låser att konsumenterna importerar den delade implementationen och inte växer egna dagsloopar/"idag"-härledningar
 * igen (fem egna kopior, varav en läste UTC-dagen som "idag", var orsaken till midnattsbuggen).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

interface Consumer {
  file: string;
  /** Symboler ur @runquest/shared som filen ska importera (hela streak-räkningen går genom dem). */
  uses: string[];
}

const CONSUMERS: Consumer[] = [
  { file: 'apps/backend/src/services/streakService.ts', uses: ['currentStreak', 'longestStreak', 'streakDayForRun', 'stockholmDay'] },
  { file: 'apps/backend/src/routes/runs.ts', uses: ['advanceStreakDay'] },
  { file: 'apps/frontend/src/features/log/logModel.ts', uses: ['advanceStreakDay', 'isNextDay'] },
  { file: 'apps/frontend/src/app-shell/rightNowItems.ts', uses: ['streakStatus', 'stockholmDay'] },
];

/** Mönster som avslöjar en handskriven streak-loop eller en egen "idag"-härledning. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['egen dagsdifferens (daysDiff)', /\bdaysDiff\b/],
  ['millisekunder-per-dygn-aritmetik (1000 * 60 * 60 * 24)', /1000\s*\*\s*60\s*\*\s*60\s*\*\s*24/],
  ['"idag" från processens tidszon (setHours)', /\.setHours\s*\(\s*0/],
  ['egen föregående-dag-hjälpare', /\bpreviousDay\b|\byesterdayStr\b|\btodayStr\b/],
  ['egna räknare för aktuell streak', /\bcalculateCurrentStreak\b|\bcalculateLongestStreak\b|\bcalculateStreakDayForSpecificRun\b|\bcurrentStreakCount\b/],
];

describe('all streak consumers use the shared implementation', () => {
  it.each(CONSUMERS)('$file importerar streak-räkningen från @runquest/shared', ({ file, uses }) => {
    const source = stripComments(read(file));
    const shared = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@runquest\/shared'/g)].map((m) => m[1]).join(',');
    const imported = shared.split(',').map((name) => name.trim().replace(/^type\s+/, '')).filter(Boolean);
    for (const symbol of uses) expect({ file, symbol, imported: imported.includes(symbol) }).toEqual({ file, symbol, imported: true });
  });

  it.each(CONSUMERS)('$file har inga egna streak-loopar eller "idag"-härledningar', ({ file }) => {
    const source = stripComments(read(file));
    for (const [what, pattern] of FORBIDDEN) expect({ file, what, found: pattern.test(source) }).toEqual({ file, what, found: false });
  });

  it('inga andra icke-testfiler i backend/frontend definierar streak-loopar (daysDiff / calculate*Streak)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (name === 'node_modules' || name === 'dist' || name === '__tests__') return [];
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [full] : [];
      });
    const offenders = [...walk(join(repoRoot, 'apps/backend/src')), ...walk(join(repoRoot, 'apps/frontend/src'))]
      .filter((file) => /\bdaysDiff\b|\bcalculate(Current|Longest)Streak\b|\bcalculateStreakDayForSpecificRun\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(repoRoot.length).replaceAll('\\', '/'));
    expect(offenders).toEqual([]);
  });

  it('streak.ts återanvänder streakSegments i stället för en egen följdloop', () => {
    const source = stripComments(read('packages/shared/src/streak.ts'));
    expect(source).toMatch(/import \{ streakSegments \} from '\.\/activityBackfill\.js'/);
    expect(source).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
  });
});
