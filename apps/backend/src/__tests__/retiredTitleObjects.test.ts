/**
 * Inget i koden läser eller anropar objekten som contract-migration 058 släpper (ADR 012 beslut 8): omslagsfunktionerna
 * update_title_leaderboard(uuid) och update_all_title_leaderboards(), rebuild-triggern och shim-triggern på user_titles med sina funktioner,
 * och kolumnerna titles.current_holder_id/current_value. Läser källfilerna som text (inte databasen): backend, frontend, delade paketet och
 * repots skript, utom testerna (som får nämna namnen för att bevisa att de är borta) och migrationerna (historia).
 *
 * Rankingen skrivs av EN väg i appen: update_group_title_leaderboards(grupp) via rebuildGroupTitleRanking. Det enskilda
 * update_group_title_leaderboard(grupp, titel) är bara databasens inre byggsten och anropas inte av appen.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOTS = ['apps/backend/src', 'apps/frontend/src', 'packages/shared/src', 'scripts'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__', '.git']);
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Filer som får nämna namnen och varför. schemaFingerprint.ts har en TILLFÄLLIG regel (RUN-326) som beskriver 056:s fyra funktioner som data
 * för schemajämförelsen mellan staging och prod; den läser inte funktionerna och tas bort av Lead när 056 är applicerad i båda (den är det i prod
 * sedan 2026-10-19).
 */
const ALLOWED = new Set(['apps/backend/src/scripts/staging/schemaFingerprint.ts']);

const RETIRED = [
  'update_title_leaderboard',
  'update_all_title_leaderboards',
  'trigger_update_title_leaderboard',
  'user_titles_fill_group_id',
  'user_titles_group_id_shim',
  'title_leaderboard_update_trigger',
  'current_holder_id',
  'current_value',
];
const RETIRED_RE = new RegExp(`\\b(${RETIRED.join('|')})\\b`);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : sources(path);
    return EXTENSIONS.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name) ? [path] : [];
  });
}

const files = ROOTS.flatMap((root) => sources(join(REPO, root))).map((path) => ({ rel: relative(REPO, path).split(sep).join('/'), path }));

describe('objekt som migration 058 släpper', () => {
  it('scannar backend, frontend, shared och skripten (inte en tom lista)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === 'apps/backend/src/services/enhancedTitleService.ts')).toBe(true);
    expect(files.some((f) => f.rel.startsWith('apps/frontend/src/'))).toBe(true);
    expect(files.some((f) => f.rel.startsWith('packages/shared/src/'))).toBe(true);
  });

  it('inget i koden nämner omslagsfunktionerna, triggrarna, shim-funktionen eller kolumnerna current_holder_id/current_value', () => {
    const hits = files
      .filter((f) => !ALLOWED.has(f.rel))
      .flatMap((f) => readFileSync(f.path, 'utf8').split(/\r?\n/).flatMap((line, i) => (RETIRED_RE.test(line) ? [`${f.rel}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])));
    expect(hits).toEqual([]);
  });

  it('undantaget är fortfarande ett undantag: schemaFingerprint.ts nämner namnen bara som data i den tillfälliga regeln', () => {
    const text = readFileSync(join(REPO, 'apps/backend/src/scripts/staging/schemaFingerprint.ts'), 'utf8');
    expect(text).toContain('temporary-056-client-execute-in-prod');
    const lines = text.split(/\r?\n/).filter((l) => RETIRED_RE.test(l));
    expect(lines.every((l) => /public\.(trigger_update_title_leaderboard|update_all_title_leaderboards|update_title_leaderboard)\(/.test(l) || /056|migration/i.test(l))).toBe(true);
  });

  it('appen anropar bara update_group_title_leaderboards (hela gruppen), aldrig det enskilda update_group_title_leaderboard', () => {
    const rpcNames = new Set<string>();
    for (const f of files.filter((x) => x.rel.startsWith('apps/backend/src/'))) {
      for (const m of readFileSync(f.path, 'utf8').matchAll(/\.rpc\(\s*'(update_[a-z_]*title_leaderboards?)'/g)) rpcNames.add(`${m[1]} i ${f.rel}`);
    }
    expect([...rpcNames]).toEqual(['update_group_title_leaderboards i apps/backend/src/services/groupRanking.ts']);
  });
});
