/**
 * RUN-218 T3/T5 — statisk kontroll: datumaritmetik och Stockholm-tid finns på ETT ställe (packages/shared/src/calendar.ts).
 *
 * Heuristik, som streakConsumers: textsökning i icke-testkällor under apps/backend, apps/frontend och packages/shared.
 * Den låser att addDays/mondayOf/daysBetween/dayOfWeek, MS_DAY och Stockholm-offseten inte växer egna kopior igen
 * (före sammanslagningen fanns de i 4–7 versioner som läste "idag" olika: UTC, processens tidszon och Stockholm).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const CALENDAR = 'packages/shared/src/calendar.ts';
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec|fixture)\.tsx?$/.test(name) ? [full] : [];
  });
}

const relative = (file: string) => file.slice(repoRoot.length).replaceAll('\\', '/');
const SOURCES = ['apps/backend/src', 'apps/frontend/src', 'packages/shared/src']
  .flatMap((dir) => walk(join(repoRoot, dir)))
  .map((file) => ({ path: relative(file), code: stripComments(readFileSync(file, 'utf8')) }))
  .filter(({ path }) => path !== CALENDAR);

const DAY_MS_LITERAL = /\b86_?400_?000\b|\b24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b|\b1000\s*\*\s*60\s*\*\s*60\s*\*\s*24\b/;
const DAY_MS_CONSTANT = /\b(?:const|let|var)\s+(?:MS_DAY|MS_PER_DAY|DAY_MS|DAY_IN_MS|ONE_DAY\w*|MS_IN_DAY)\b/;
const CALENDAR_FUNCTIONS =
  /\b(?:function\s+|(?:const|let|var)\s+)(addDays|addDaysTo\w*|mondayOf\w*|getMondayKey|daysBetween|daysApart|calendarDaysBetween|dayOfWeek|utcMinutes|wallClockMinutes|atStockholm|stockholmOffsetMs|offsetMsAt|stockholmDay|toUtcNoon)\b/;
const INTL_STOCKHOLM = /\btimeZone\s*:\s*['"`]Europe\/Stockholm['"`]|\btimeZone\s*:\s*STOCKHOLM\w*/;
const UTC_TODAY = /new Date\(\s*(?:Date\.now\(\))?\s*\)\s*\.toISOString\(\)\s*\.\s*(?:split|slice)\s*\(/;

// Datumaritmetik via Date-muterare/-läsare (setDate(getDate() - 7), getUTCMonth() + 1, setHours(0,0,0,0)). De läser processens
// tidszon eller UTC-dagen i stället för Stockholm-dagen; kalenderaritmetik hör hemma i calendar.ts (addDays, stockholmDay, ...).
// `state.setDate` är formulärtillståndets setter i RunForm (React-state, inte Date) och undantas via lookbehind; en riktig Date
// som heter `state` skulle alltså slinka igenom.
//
// KÄNDA LUCKOR (heuristik, inte bevis): vakten ser inte `getFullYear`/`setFullYear`, `getDay`, `getHours`/`getMinutes`
// (visning av lokal enhetstid, t.ex. settingsModel) eller `getTime() + n * MS_DAY` (dygnsaritmetik på ögonblick). Sådant
// fångas bara i granskning tills en träffsäkrare regel finns. Lokala midnattstolkningar (`new Date(`${day}T00:00:00`)`) fångas
// av LOCAL_WALL_CLOCK_TEMPLATE nedan.
const DATE_ARITHMETIC_SOURCE =
  '(?<!\\bstate)\\.(?:setDate|getDate|setUTCDate|getUTCDate|setMonth|getMonth|setUTCMonth|getUTCMonth|setHours|setUTCHours)\\(';

// Undantagen gäller EXAKT antal träffar per fil, inte hela filen: en ny träff i en undantagen fil fäller testet, och en
// träff som försvinner gör undantaget inaktuellt (sänk eller ta bort det).
const DATE_ARITHMETIC_EXCEPTIONS: Record<string, { hits: number; reason: string }> = {};

const hitCount = (code: string) => code.match(new RegExp(DATE_ARITHMETIC_SOURCE, 'g'))?.length ?? 0;
const dateArithmeticDeviations = (files = SOURCES) =>
  files.flatMap(({ path, code }) => {
    const found = hitCount(code);
    const allowed = DATE_ARITHMETIC_EXCEPTIONS[path]?.hits ?? 0;
    return found === allowed ? [] : [{ path, found, allowed }];
  });

// En mallsträng som bygger ett klockslag på en kalenderdag utan Z eller offset — `${day}T00:00:00` — tolkas av `new Date(...)` i
// processens/webbläsarens tidszon, inte i gruppens (duellfönstret räknades så i rightNowItems). Ett klockslag på en kalenderdag
// ska gå via stockholmWallClockToInstant/groupNextMidnight; mallsträngar med Z (`${day}T00:00:00Z`, UTC) är något annat.
const LOCAL_WALL_CLOCK_TEMPLATE = /\$\{[^}]*\}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?`/;

const offenders = (pattern: RegExp, files = SOURCES) => files.filter(({ code }) => pattern.test(code)).map(({ path }) => path);

describe('datumaritmetik och Stockholm-tid finns bara i calendar.ts', () => {
  it('inga egna dygnskonstanter (86400000, 24*60*60*1000, MS_DAY/DAY_MS-definitioner) utanför calendar.ts', () => {
    expect(offenders(DAY_MS_LITERAL, SOURCES)).toEqual([]);
    expect(offenders(DAY_MS_CONSTANT, SOURCES)).toEqual([]);
  });

  it('inga egna addDays/mondayOf/daysBetween/dayOfWeek/stockholmDay/offset-funktioner utanför calendar.ts', () => {
    expect(offenders(CALENDAR_FUNCTIONS)).toEqual([]);
  });

  it('ingen Intl-formaterare med Europe/Stockholm utanför calendar.ts (cron-optionen `timezone` är något annat)', () => {
    expect(offenders(INTL_STOCKHOLM)).toEqual([]);
  });

  it('ingen "idag" ur UTC-dagen: new Date().toISOString().split/slice', () => {
    expect(offenders(UTC_TODAY, SOURCES)).toEqual([]);
  });

  it('ingen datumaritmetik med setDate/getDate/setUTCDate/getUTCMonth/setHours utanför calendar.ts (utom listade undantag)', () => {
    // Fler träffar än tillåtet fäller (även i undantagna filer); färre betyder att undantaget är inaktuellt.
    expect(dateArithmeticDeviations()).toEqual([]);
    expect(Object.keys(DATE_ARITHMETIC_EXCEPTIONS).filter((path) => !SOURCES.some((s) => s.path === path))).toEqual([]);
  });

  it('ingen mallsträng `${dag}T00:00:00` utan Z/offset (webbläsarens midnatt i stället för gruppens)', () => {
    expect(offenders(LOCAL_WALL_CLOCK_TEMPLATE)).toEqual([]);
  });

  it('vakten för lokala klockslag träffar den gamla duellformen men inte UTC-mallar med Z', () => {
    expect(LOCAL_WALL_CLOCK_TEMPLATE.test('new Date(`${duel.startDate}T00:00:00`)')).toBe(true);
    expect(LOCAL_WALL_CLOCK_TEMPLATE.test('new Date(`${day} 07:30`)')).toBe(true);
    expect(LOCAL_WALL_CLOCK_TEMPLATE.test('`${day}T00:00:00.000`')).toBe(true);
    expect(LOCAL_WALL_CLOCK_TEMPLATE.test('`${day}T00:00:00Z`')).toBe(false);
    expect(LOCAL_WALL_CLOCK_TEMPLATE.test('`${addDays(asOf, -14)}T00:00:00Z`')).toBe(false);
    expect(LOCAL_WALL_CLOCK_TEMPLATE.test('`${start}T00:00:00+02:00`')).toBe(false);
  });

  it('konsumenterna importerar calendar-funktionerna från @runquest/shared', () => {
    const importsFromShared = (path: string) => {
      const source = SOURCES.find((s) => s.path === path)!;
      return [...source.code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@runquest\/shared'/g)]
        .flatMap((m) => m[1].split(',').map((name) => name.trim().replace(/^type\s+/, '')).filter(Boolean));
    };
    const expected: Record<string, string[]> = {
      'apps/backend/src/utils/dateUtils.ts': ['addDays', 'mondayOf', 'stockholmDay'],
      'apps/backend/src/scheduler/eventScheduler.ts': ['addDays', 'stockholmWallClockToInstant'],
      'apps/backend/src/routes/challenges.ts': ['groupNextMidnight'],
      'apps/frontend/src/app-shell/rightNowItems.ts': ['addDays', 'stockholmWallClockToInstant'],
      'apps/backend/src/titleEngines/maxRunsOneWeek.ts': ['mondayOf'],
      'apps/backend/src/titleEngines/earlyRunCount.ts': ['wallClockMinutes'],
      'apps/frontend/src/features/leaderboard/boardFormat.ts': ['daysBetween', 'stockholmClock'],
      'apps/frontend/src/features/news/newsModel.ts': ['daysBetween', 'mondayOf', 'stockholmClock'],
      'apps/frontend/src/features/profile/heatmapModel.ts': ['addDays', 'mondayOf'],
    };
    for (const [path, symbols] of Object.entries(expected)) {
      const imported = importsFromShared(path);
      for (const symbol of symbols) expect({ path, symbol, imported: imported.includes(symbol) }).toEqual({ path, symbol, imported: true });
    }
  });
});

describe('todayStockholm och streakschedulern (T5)', () => {
  const source = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

  it('todayStockholm/toStockholmDate i backend delegerar till stockholmDay: ingen egen Intl-formaterare', () => {
    const dateUtils = stripComments(source('apps/backend/src/utils/dateUtils.ts'));
    expect(dateUtils).toMatch(/export function todayStockholm\(\): string \{\s*return stockholmDay\(new Date\(\)\);\s*\}/);
    expect(dateUtils).toMatch(/export function toStockholmDate\(isoString: string\): string \{\s*return stockholmDay\(new Date\(isoString\)\);\s*\}/);
    expect(dateUtils).not.toMatch(/Intl\./);
  });

  it('streakScheduler-kommentaren påstår inte längre att StreakService jämför UTC-dagar', () => {
    const header = source('apps/backend/src/scheduler/streakScheduler.ts').split('\n').slice(0, 12).join('\n');
    expect(header).not.toMatch(/UTC-baserad|UTC-datumet/);
    expect(header).toMatch(/Stockholm-dagen/);
  });
});
